"use client";

import {
  Container,
  Filter,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";
import type { Effect } from "@/types/scene";
import { gpuContext } from "./GpuContext";
import {
  applyEffectParams,
  getEffectDef,
  type GpuEffectDef,
} from "./registry";

const MAX_TEXTURE = 2048; // texture-memory budget (SPEC2 §12.5)

/** Reported when an effect instance throws so the UI can auto-disable it. */
export interface EffectFailure {
  effectId: string;
  message: string;
}

/**
 * Offscreen compositor: takes a rasterized layer + its GPU effect stack
 * and returns a filtered canvas (SPEC2 §9.2 edit-mode preview). The same
 * Filter instances and shader sources drive perform mode — one shader,
 * two hosts, zero drift.
 *
 * Every RenderTexture / Sprite / Filter it owns is tracked and released
 * by dispose() so a long set can't leak GPU memory (SPEC2 §12.5).
 */
export class EffectRenderer {
  private filters = new Map<string, Filter>(); // keyed by effect.id
  private textures = new Set<RenderTexture>();
  private disposed = false;

  /** filter instance for an effect id, compiled once and reused */
  private filterFor(effect: Effect): Filter | null {
    const def = getEffectDef(effect.kind);
    if (!def || def.class !== "gpu") return null;
    let f = this.filters.get(effect.id);
    if (!f) {
      f = gpuContext.makeFilter(def as GpuEffectDef);
      this.filters.set(effect.id, f);
    }
    return f;
  }

  /**
   * Composite `source` through the enabled GPU effects in `stack`.
   * `offsets` maps `${effectId}:${param}` → additive modulation offset.
   * Returns the filtered canvas, or the source unchanged if GPU is off.
   * `onFailure` fires per misbehaving effect (caller disables it).
   */
  render(
    source: HTMLCanvasElement | HTMLImageElement,
    stack: Effect[],
    opts: {
      offsets?: Record<string, number>;
      timeSec?: number;
      onFailure?: (f: EffectFailure) => void;
    } = {},
  ): HTMLCanvasElement | HTMLImageElement {
    const app = this.appOrNull();
    const enabled = stack.filter(
      (e) => e.enabled && getEffectDef(e.kind)?.class === "gpu",
    );
    if (!app || !gpuContext.available || enabled.length === 0) {
      return source;
    }

    const srcW = Math.min(MAX_TEXTURE, (source as HTMLCanvasElement).width || 1);
    const srcH = Math.min(MAX_TEXTURE, (source as HTMLCanvasElement).height || 1);
    if (srcW < 1 || srcH < 1) return source;

    let texture: Texture | null = null;
    let sprite: Sprite | null = null;
    let rt: RenderTexture | null = null;
    try {
      texture = Texture.from(source);
      sprite = new Sprite(texture);

      const filters: Filter[] = [];
      for (const effect of enabled) {
        const def = getEffectDef(effect.kind) as GpuEffectDef;
        try {
          const filter = this.filterFor(effect);
          if (!filter) continue;
          const effectOffsets: Record<string, number> = {};
          if (opts.offsets) {
            for (const key of Object.keys(opts.offsets)) {
              const [id, param] = key.split(":");
              if (id === effect.id) effectOffsets[param] = opts.offsets[key];
            }
          }
          applyEffectParams(filter, def, effect, effectOffsets, opts.timeSec);
          filters.push(filter);
        } catch (err) {
          opts.onFailure?.({
            effectId: effect.id,
            message: err instanceof Error ? err.message : "effect failed",
          });
        }
      }
      sprite.filters = filters;

      rt = RenderTexture.create({ width: srcW, height: srcH });
      this.textures.add(rt);
      app.renderer.render({ container: sprite as unknown as Container, target: rt });
      const canvas = app.renderer.extract.canvas(rt) as HTMLCanvasElement;
      return canvas;
    } catch (err) {
      // whole-chain failure: disable every effect in the stack, keep source
      for (const effect of enabled) {
        opts.onFailure?.({
          effectId: effect.id,
          message: err instanceof Error ? err.message : "render failed",
        });
      }
      return source;
    } finally {
      sprite?.destroy();
      texture?.destroy(true);
      if (rt) {
        this.textures.delete(rt);
        rt.destroy(true);
      }
    }
  }

  private appOrNull() {
    // GpuContext.init() must have resolved before render() is called;
    // callers gate on gpuContext.available.
    return gpuContext.application;
  }

  /** Release this effect's cached filter (on effect delete). */
  disposeEffect(effectId: string): void {
    const f = this.filters.get(effectId);
    if (f) {
      f.destroy();
      this.filters.delete(effectId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.filters.forEach((f) => f.destroy());
    this.filters.clear();
    this.textures.forEach((t) => t.destroy(true));
    this.textures.clear();
  }
}
