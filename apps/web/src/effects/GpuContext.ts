"use client";

import { Application, Filter, type Renderer } from "pixi.js";
import { gpuEffectDefs, makeGpuFilter, type GpuEffectDef } from "./registry";

/**
 * One shared WebGL context for the whole app (SPEC2 §12.5). Both the
 * edit-mode EffectRenderer and the perform-mode renderer draw through
 * this singleton — never a second context, because browsers cap
 * concurrent WebGL contexts (~8–16) and exhausting them silently breaks
 * unrelated tabs.
 *
 * Also owns: WebGL2 feature detection, context-loss/restore handling,
 * and the startup shader warmup so no effect compiles lazily mid-set.
 */

type Listener = () => void;

class GpuContextManager {
  private app: Application | null = null;
  private initPromise: Promise<void> | null = null;
  private _webgl2 = true;
  private _lost = false;

  /** cached compiled programs, keyed by effect kind (not per-layer) */
  private warmed = new Set<string>();
  private lostListeners = new Set<Listener>();
  private restoreListeners = new Set<Listener>();

  get available(): boolean {
    return this._webgl2;
  }

  get contextLost(): boolean {
    return this._lost;
  }

  /** the single shared Application — null until init() resolves */
  get application(): Application | null {
    return this.app;
  }

  get renderer(): Renderer | null {
    return this.app?.renderer ?? null;
  }

  get canvas(): HTMLCanvasElement | null {
    return (this.app?.canvas as HTMLCanvasElement) ?? null;
  }

  /** Feature-detect WebGL2 before we ever construct a Pixi app. */
  private detectWebgl2(): boolean {
    try {
      const canvas = document.createElement("canvas");
      return !!canvas.getContext("webgl2");
    } catch {
      return false;
    }
  }

  async init(): Promise<Application | null> {
    if (!this.detectWebgl2()) {
      this._webgl2 = false;
      return null;
    }
    if (this.app) return this.app;
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    await this.initPromise;
    return this.app;
  }

  private async doInit(): Promise<void> {
    const app = new Application();
    await app.init({
      width: 1,
      height: 1,
      backgroundAlpha: 0,
      antialias: true,
      preference: "webgl",
      // we drive rendering manually (offscreen composites in edit mode,
      // a scene render loop in perform mode) — never the default stage
      autoStart: false,
    });
    this.app = app;

    const canvas = app.canvas as HTMLCanvasElement;
    canvas.addEventListener("webglcontextlost", this.onLost, false);
    canvas.addEventListener("webglcontextrestored", this.onRestored, false);

    this.warmup();
  }

  /**
   * Compile every registered GPU shader once, now, so the first time a
   * performer enables an effect there's no visible frame hitch. A filter
   * only actually links its program on first use, so we force it by
   * touching each one; GlProgram caches by source thereafter.
   */
  private warmup(): void {
    for (const def of gpuEffectDefs()) {
      if (this.warmed.has(def.kind)) continue;
      try {
        makeGpuFilter(def); // GlProgram.from caches the compiled program
        this.warmed.add(def.kind);
      } catch {
        // a malformed shader must not break startup — it just won't warm
      }
    }
  }

  /** Filter instance for an effect kind (post-warmup: no recompile). */
  makeFilter(def: GpuEffectDef): Filter {
    this.warmed.add(def.kind);
    return makeGpuFilter(def);
  }

  private onLost = (e: Event) => {
    e.preventDefault(); // required so the context can be restored
    this._lost = true;
    this.lostListeners.forEach((fn) => fn());
  };

  private onRestored = () => {
    this._lost = false;
    this.warmed.clear();
    this.warmup(); // recreate compiled programs (Pixi doesn't auto-restore)
    this.restoreListeners.forEach((fn) => fn());
  };

  onContextLost(fn: Listener): () => void {
    this.lostListeners.add(fn);
    return () => this.lostListeners.delete(fn);
  }

  onContextRestored(fn: Listener): () => void {
    this.restoreListeners.add(fn);
    return () => this.restoreListeners.delete(fn);
  }

  /** test hook: force a context loss (SPEC2 §12.5 / §13 manual verify). */
  forceContextLoss(): void {
    const gl = (
      this.app?.canvas as HTMLCanvasElement | undefined
    )?.getContext("webgl2");
    (gl?.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
  }
}

export const gpuContext = new GpuContextManager();
