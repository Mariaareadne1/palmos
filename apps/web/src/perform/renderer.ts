"use client";

import {
  Assets,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Filter,
  Graphics,
  Sprite,
  Text,
} from "pixi.js";
import type { Effect, Layer, ModTarget, SceneGraph, ShaderLayer } from "@/types/scene";
import { fillFallbackColor, isGradientFill } from "@/lib/fill";
import { gpuContext } from "@/effects/GpuContext";
import {
  applyEffectParams,
  getEffectDef,
  type GpuEffectDef,
} from "@/effects/registry";
import { makeShaderFilter } from "@/effects/shaderCompile";
import type { FeatureFrame } from "@/perform/features";
import type { ModulationResult, PropertyOffsets } from "@/perform/modulation";

const DEG = Math.PI / 180;

interface BaseTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

interface AttachedEffect {
  effect: Effect;
  def: GpuEffectDef;
  filter: Filter;
}

interface ShaderBinding {
  filter: Filter;
  layer: ShaderLayer;
}

interface LayerNode {
  container: Container;
  base: BaseTransform;
  effects: AttachedEffect[];
  hue: ColorMatrixFilter | null;
  blur: BlurFilter | null;
  /** growth playback: per-step child ranges (SPEC2 §9.3) */
  growth?: { steps: number };
  /** custom GLSL layer binding (SPEC2 §11.2) */
  shader?: ShaderBinding;
}

/**
 * Builds the Pixi display tree ONCE per graph change; per frame only
 * ephemeral offsets are applied (SPEC.md §5 / SPEC2 §9). GPU effect
 * filters are cached per effect instance and their uniforms are pushed
 * each frame (base param + modulation offset). Every Filter/Container it
 * owns is released by destroy() (SPEC2 §12.5).
 */
export class PerformRenderer {
  readonly registry = new Map<string, LayerNode>();
  readonly root = new Container();
  private postFilters: AttachedEffect[] = [];

  constructor(private scene: SceneGraph) {
    this.build();
  }

  private filterTargets(): Map<string, Set<ModTarget>> {
    const map = new Map<string, Set<ModTarget>>();
    for (const r of this.scene.routings) {
      if (r.target === "hue" || r.target === "blur") {
        let set = map.get(r.layerId);
        if (!set) {
          set = new Set();
          map.set(r.layerId, set);
        }
        set.add(r.target);
      }
    }
    return map;
  }

  private build(): void {
    this.registry.clear();
    const bg = new Graphics()
      .rect(0, 0, this.scene.width, this.scene.height)
      .fill(this.scene.background);
    this.root.addChild(bg);

    const filterTargets = this.filterTargets();
    for (const layer of this.scene.layers) {
      const node = this.buildLayer(layer, filterTargets);
      if (node) this.root.addChild(node);
    }

    // document post-fx: cached filters on the root container. `feedback`
    // is excluded here — it needs ping-pong targets (FeedbackPass), driven
    // by PerformOverlay as a final wrapping pass.
    if (gpuContext.available) {
      for (const effect of this.scene.postEffects) {
        if (effect.kind === "feedback") continue;
        const def = getEffectDef(effect.kind);
        if (!def || def.class !== "gpu") continue;
        try {
          const filter = gpuContext.makeFilter(def as GpuEffectDef);
          this.postFilters.push({ effect, def: def as GpuEffectDef, filter });
        } catch {
          // a bad post-fx shader disables only itself
        }
      }
      this.root.filters = this.postFilters
        .filter((f) => f.effect.enabled)
        .map((f) => f.filter);
    }
  }

  private attachGpuEffects(
    container: Container,
    layer: Layer,
  ): AttachedEffect[] {
    if (!gpuContext.available) return [];
    const attached: AttachedEffect[] = [];
    const filters: Filter[] = [];
    for (const effect of layer.effects) {
      const def = getEffectDef(effect.kind);
      if (!def || def.class !== "gpu") continue;
      try {
        const filter = gpuContext.makeFilter(def as GpuEffectDef);
        attached.push({ effect, def: def as GpuEffectDef, filter });
        if (effect.enabled) filters.push(filter);
      } catch {
        // failure isolation: skip this effect only
      }
    }
    if (filters.length) container.filters = filters;
    return attached;
  }

  private buildLayer(
    layer: Layer,
    filterTargets: Map<string, Set<ModTarget>>,
  ): Container | null {
    if (!layer.visible) return null;

    let content: Container;
    let shaderBinding: ShaderBinding | undefined;
    switch (layer.type) {
      case "path": {
        content = this.buildPath(layer);
        break;
      }
      case "text": {
        const solid = fillFallbackColor(layer.fill) ?? "#000000";
        content = new Text({
          text: layer.text,
          style: {
            fontFamily: layer.fontFamily,
            fontSize: layer.fontSize,
            fontWeight: String(
              layer.fontWeight,
            ) as import("pixi.js").TextStyleFontWeight,
            fill: layer.strokeOnly ? undefined : solid,
            stroke: layer.strokeOnly ? { color: solid, width: 1 } : undefined,
            align: layer.align,
            letterSpacing: layer.letterSpacing,
          },
        });
        break;
      }
      case "image": {
        const sprite = new Sprite();
        sprite.width = layer.width;
        sprite.height = layer.height;
        void Assets.load(layer.src).then((texture) => {
          if (!sprite.destroyed) {
            sprite.texture = texture;
            sprite.setSize(layer.width, layer.height);
          }
        });
        content = sprite;
        break;
      }
      case "shader": {
        // custom GLSL quad: an opaque rect the shader filter overwrites.
        // invalid source → no filter → the rect stays (harmless) but we
        // make it transparent so a broken shader is an empty passthrough.
        const filter = gpuContext.available
          ? makeShaderFilter(layer.fragmentSource, layer.customParams)
          : null;
        const quad = new Graphics()
          .rect(0, 0, layer.width, layer.height)
          .fill(filter ? { color: 0x000000, alpha: 1 } : { color: 0x000000, alpha: 0 });
        if (filter) quad.filters = [filter];
        content = quad;
        shaderBinding = filter ? { filter, layer } : undefined;
        break;
      }
      case "group": {
        const group = new Container();
        for (const child of layer.children) {
          const node = this.buildLayer(child, filterTargets);
          if (node) group.addChild(node);
        }
        content = group;
        break;
      }
    }

    const wrapper = new Container();
    wrapper.addChild(content);

    const base: BaseTransform = {
      x: layer.transform.x,
      y: layer.transform.y,
      scaleX: layer.transform.scaleX,
      scaleY: layer.transform.scaleY,
      rotation: layer.transform.rotation,
      opacity: layer.opacity,
    };
    wrapper.position.set(base.x, base.y);
    wrapper.scale.set(base.scaleX, base.scaleY);
    wrapper.rotation = base.rotation * DEG;
    wrapper.alpha = base.opacity;

    const effects = this.attachGpuEffects(wrapper, layer);

    // hue/blur come from core mod targets, not the effect stack — add the
    // built-in filters only where routed
    const wanted = filterTargets.get(layer.id);
    let hue: ColorMatrixFilter | null = null;
    let blur: BlurFilter | null = null;
    if (wanted) {
      const extra: Filter[] = [...(wrapper.filters as Filter[] | undefined ?? [])];
      if (wanted.has("hue")) {
        hue = new ColorMatrixFilter();
        extra.push(hue);
      }
      if (wanted.has("blur")) {
        blur = new BlurFilter({ strength: 0 });
        extra.push(blur);
      }
      wrapper.filters = extra;
    }

    this.registry.set(layer.id, {
      container: wrapper,
      base,
      effects,
      hue,
      blur,
      growth:
        layer.type === "group" && layer.growthSteps
          ? { steps: layer.growthSteps.length }
          : undefined,
      shader: shaderBinding,
    });
    return wrapper;
  }

  private buildPath(layer: import("@/types/scene").PathLayer): Graphics {
    const g = new Graphics();
    const fill = layer.fill;
    const fillStr = isGradientFill(fill)
      ? (fillFallbackColor(fill) ?? "none") // gradient fallback in GPU path
      : (fill ?? "none");
    const stroke = layer.stroke
      ? ` stroke="${layer.stroke}" stroke-width="${layer.strokeWidth}"`
      : "";
    g.svg(
      `<svg xmlns="http://www.w3.org/2000/svg"><path d="${layer.d}" fill="${fillStr}"${stroke}/></svg>`,
    );
    return g;
  }

  layout(width: number, height: number): void {
    const scale = Math.min(
      width / this.scene.width,
      height / this.scene.height,
    );
    this.root.scale.set(scale);
    this.root.position.set(
      (width - this.scene.width * scale) / 2,
      (height - this.scene.height * scale) / 2,
    );
  }

  /** Apply this frame's modulation result + shader time + audio features. */
  applyFrame(mod: ModulationResult, timeSec: number, features?: FeatureFrame): void {
    for (const [id, node] of this.registry) {
      const o = mod.transform.get(id);
      this.applyTransform(node, o);

      // custom GLSL layer uniforms
      if (node.shader && features) {
        this.applyShader(node.shader, mod.shader.get(id), timeSec, features);
      }

      // per-layer GPU effect uniforms (base params + modulation offsets)
      const effectOffsets = mod.effects.get(id);
      for (const att of node.effects) {
        try {
          const offsets: Record<string, number> = {};
          if (effectOffsets) {
            for (const key of Object.keys(effectOffsets)) {
              const [eid, param] = key.split(":");
              if (eid === att.effect.id) offsets[param] = effectOffsets[key];
            }
          }
          applyEffectParams(att.filter, att.def, att.effect, offsets, timeSec);
        } catch {
          // isolate a bad effect: skip its uniform update this frame
        }
      }

      // growth playback reveal
      const growth = mod.growth.get(id);
      if (growth !== undefined && node.growth) {
        this.applyGrowth(node, growth);
      }
    }

    // post-fx uniforms
    for (const att of this.postFilters) {
      try {
        applyEffectParams(
          att.filter,
          att.def,
          att.effect,
          extractPostOffsets(mod.post, att.effect.id),
          timeSec,
        );
      } catch {
        // isolate
      }
    }
  }

  private applyTransform(node: LayerNode, o: PropertyOffsets | undefined): void {
    const { container, base } = node;
    if (!o) {
      container.position.set(base.x, base.y);
      container.scale.set(base.scaleX, base.scaleY);
      container.rotation = base.rotation * DEG;
      container.alpha = base.opacity;
      if (node.hue) node.hue.reset();
      if (node.blur) node.blur.strength = 0;
      return;
    }
    container.position.set(base.x + o.dx, base.y + o.dy);
    container.scale.set(base.scaleX * o.scale, base.scaleY * o.scale);
    container.rotation = (base.rotation + o.rotation) * DEG;
    container.alpha = Math.min(1, Math.max(0, base.opacity + o.opacity));
    if (node.hue) {
      node.hue.reset();
      if (o.hue !== 0) node.hue.hue(o.hue, false);
    }
    if (node.blur) node.blur.strength = o.blur;
  }

  private applyShader(
    binding: ShaderBinding,
    offsets: Record<string, number> | undefined,
    timeSec: number,
    features: FeatureFrame,
  ): void {
    const group = binding.filter.resources.shaderUniforms as
      | { uniforms: Record<string, unknown> }
      | undefined;
    if (!group) return;
    const u = group.uniforms;
    u.u_time = timeSec;
    (u.u_resolution as Float32Array).set([binding.layer.width, binding.layer.height]);
    u.u_rms = features.rms;
    u.u_low = features.low;
    u.u_mid = features.mid;
    u.u_high = features.high;
    u.u_onset = features.onset;
    for (const [k, base] of Object.entries(binding.layer.customParams)) {
      const off = offsets?.[k] ?? 0;
      u[k] = Math.min(1, Math.max(0, base + off));
    }
  }

  private applyGrowth(node: LayerNode, progress: number): void {
    const children = node.container.children[0]?.children;
    if (!children) return;
    const shown = Math.round(progress * children.length);
    children.forEach((c, i) => {
      c.visible = i < shown;
    });
  }

  destroy(): void {
    for (const node of this.registry.values()) {
      node.effects.forEach((a) => a.filter.destroy());
      node.hue?.destroy();
      node.blur?.destroy();
      node.shader?.filter.destroy();
    }
    this.postFilters.forEach((a) => a.filter.destroy());
    this.postFilters = [];
    this.registry.clear();
    this.root.destroy({ children: true });
  }
}

function extractPostOffsets(
  post: Record<string, number>,
  effectId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(post)) {
    const [id, param] = key.split(":");
    if (id === effectId) out[param] = post[key];
  }
  return out;
}
