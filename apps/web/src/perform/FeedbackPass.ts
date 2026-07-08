"use client";

import {
  Application,
  Container,
  Filter,
  RenderTexture,
  Sprite,
} from "pixi.js";
import type { Effect } from "@/types/scene";
import { gpuContext } from "@/effects/GpuContext";
import { applyEffectParams, getEffectDef, type GpuEffectDef } from "@/effects/registry";

/**
 * The flagship post-fx (SPEC2 §11.1): trails/tunnels/echo via ping-pong
 * render targets. Each frame composites the new frame over the previous
 * accumulation — scaled/rotated/hue-shifted and faded by `decay`:
 *
 *   accum' = decay·transform(accum)  then  draw newFrame on top
 *
 * decay is clamped ≤0.98 and buffers reset on mode switch / context loss
 * so it can't blow out. Two RenderTextures swap roles each frame.
 */
export class FeedbackPass {
  private a: RenderTexture;
  private b: RenderTexture;
  private feedbackFilter: Filter;
  private def: GpuEffectDef;
  private prevSprite = new Sprite();
  private presentSprite = new Sprite(); // reused every frame (no GC churn)
  private scratch = new Container();
  private w = 1;
  private h = 1;

  constructor(
    private app: Application,
    private effect: Effect,
  ) {
    this.def = getEffectDef("feedback") as GpuEffectDef;
    this.feedbackFilter = gpuContext.makeFilter(this.def);
    this.a = RenderTexture.create({ width: 1, height: 1 });
    this.b = RenderTexture.create({ width: 1, height: 1 });
  }

  private ensureSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.a.resize(w, h);
    this.b.resize(w, h);
    this.reset();
  }

  /** clear both accumulation buffers (mode switch / context restore). */
  reset(): void {
    for (const t of [this.a, this.b]) {
      this.app.renderer.render({
        container: new Container(),
        target: t,
        clear: true,
      });
    }
  }

  /**
   * Render `sceneStage` to screen with feedback trails. `offsets` are the
   * modulation offsets for this effect's params (post:feedback:*).
   */
  render(
    sceneStage: Container,
    offsets: Record<string, number>,
    timeSec: number,
  ): void {
    const r = this.app.renderer;
    const w = r.width;
    const h = r.height;
    this.ensureSize(w, h);

    // 1) fade + transform the previous accumulation (a) into b
    applyEffectParams(this.feedbackFilter, this.def, this.effect, offsets, timeSec);
    this.prevSprite.texture = this.a;
    this.prevSprite.filters = [this.feedbackFilter];
    this.scratch.removeChildren();
    this.scratch.addChild(this.prevSprite);
    r.render({ container: this.scratch, target: this.b, clear: true });

    // 2) draw the new scene frame on top of the faded trail (into b)
    r.render({ container: sceneStage, target: this.b, clear: false });

    // 3) present b to the screen (reuse one sprite — no per-frame alloc)
    this.presentSprite.texture = this.b;
    this.scratch.removeChildren();
    this.scratch.addChild(this.presentSprite);
    r.render({ container: this.scratch });

    // 4) swap: b becomes the accumulation for next frame
    const tmp = this.a;
    this.a = this.b;
    this.b = tmp;
  }

  dispose(): void {
    this.a.destroy(true);
    this.b.destroy(true);
    this.feedbackFilter.destroy();
    this.prevSprite.destroy();
    this.presentSprite.destroy();
    this.scratch.destroy({ children: true });
  }
}
