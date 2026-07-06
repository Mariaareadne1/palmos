"use client";

import {
  Application,
  Assets,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Text,
} from "pixi.js";
import type { Layer, ModTarget, SceneGraph } from "@/types/scene";
import type { PropertyOffsets } from "@/perform/modulation";

const DEG = Math.PI / 180;

interface BaseTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

interface LayerNode {
  container: Container;
  base: BaseTransform;
  hue: ColorMatrixFilter | null;
  blur: BlurFilter | null;
}

/**
 * Builds the Pixi display tree ONCE per graph change; per frame only
 * ephemeral mod offsets are applied (SPEC §5 step 5). PathLayers parse
 * through Pixi v8's native `Graphics.svg()` — checked against the
 * installed version; the svg-path-parser fallback was not needed.
 */
export class PerformRenderer {
  readonly registry = new Map<string, LayerNode>();
  private root = new Container();
  private stage: Container;

  constructor(
    private app: Application,
    private scene: SceneGraph,
  ) {
    this.stage = app.stage;
    this.build();
  }

  /** Which layers need which filters — attach only where routed. */
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
    this.root.destroy({ children: true });
    this.root = new Container();

    // artboard background
    const bg = new Graphics()
      .rect(0, 0, this.scene.width, this.scene.height)
      .fill(this.scene.background);
    this.root.addChild(bg);

    const filters = this.filterTargets();
    for (const layer of this.scene.layers) {
      const node = this.buildLayer(layer, filters);
      if (node) this.root.addChild(node);
    }
    this.stage.addChild(this.root);
    this.layout(this.app.renderer.width, this.app.renderer.height);
  }

  private buildLayer(
    layer: Layer,
    filterTargets: Map<string, Set<ModTarget>>,
  ): Container | null {
    if (!layer.visible) return null;

    let content: Container;
    switch (layer.type) {
      case "path": {
        const g = new Graphics();
        const fill = layer.fill ? ` fill="${layer.fill}"` : ` fill="none"`;
        const stroke = layer.stroke
          ? ` stroke="${layer.stroke}" stroke-width="${layer.strokeWidth}"`
          : "";
        g.svg(
          `<svg xmlns="http://www.w3.org/2000/svg"><path d="${layer.d}"${fill}${stroke}/></svg>`,
        );
        content = g;
        break;
      }
      case "text": {
        content = new Text({
          text: layer.text,
          style: {
            fontFamily: layer.fontFamily,
            fontSize: layer.fontSize,
            fontWeight: String(
              layer.fontWeight,
            ) as import("pixi.js").TextStyleFontWeight,
            fill: layer.fill,
            align: layer.align,
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

    // wrapper owns the layer transform so offsets compose cleanly
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

    // filters are the perf risk — attach only to routed layers
    const wanted = filterTargets.get(layer.id);
    let hue: ColorMatrixFilter | null = null;
    let blur: BlurFilter | null = null;
    if (wanted) {
      const list = [];
      if (wanted.has("hue")) {
        hue = new ColorMatrixFilter();
        list.push(hue);
      }
      if (wanted.has("blur")) {
        blur = new BlurFilter({ strength: 0 });
        list.push(blur);
      }
      wrapper.filters = list;
    }

    this.registry.set(layer.id, { container: wrapper, base, hue, blur });
    return wrapper;
  }

  /** Letterbox the artboard into the current renderer size. */
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

  /** Apply this frame's offsets; layers without offsets reset to base. */
  applyOffsets(offsets: Map<string, PropertyOffsets>): void {
    for (const [id, node] of this.registry) {
      const o = offsets.get(id);
      const { container, base } = node;
      if (!o) {
        container.position.set(base.x, base.y);
        container.scale.set(base.scaleX, base.scaleY);
        container.rotation = base.rotation * DEG;
        container.alpha = base.opacity;
        if (node.hue) node.hue.reset();
        if (node.blur) node.blur.strength = 0;
        continue;
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
  }

  destroy(): void {
    this.registry.clear();
    this.root.destroy({ children: true });
  }
}
