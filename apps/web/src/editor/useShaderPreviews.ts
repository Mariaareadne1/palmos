"use client";

import { useEffect, useRef, useState } from "react";
import { Container, Graphics, RenderTexture } from "pixi.js";
import type { Filter } from "pixi.js";
import type { SceneGraph, ShaderLayer } from "@/types/scene";
import { gpuContext } from "@/effects/GpuContext";
import { makeShaderFilter } from "@/effects/shaderCompile";
import { getAudioEngine } from "@/perform/audio";
import { useAppStore } from "@/state/store";
import type { Preview } from "./useEffectPreviews";

const FPS = 8; // low-rate in edit mode (SPEC2 §11.2 / §13 perf)
const MAX = 256; // thumbnail resolution cap

/**
 * Edit-mode live thumbnails for custom GLSL layers. Renders each shader
 * to an offscreen texture at ~8fps (not full-rate) via the shared
 * context, reading the live audio frame so it reacts even while editing.
 * Only the selected layer animates; others render once and hold.
 */
export function useShaderPreviews(scene: SceneGraph): Map<string, Preview> {
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map());
  const mode = useAppStore((s) => s.mode);
  const filters = useRef(new Map<string, { filter: Filter; source: string }>());
  const textures = useRef(new Map<string, RenderTexture>());

  const shaderLayers = scene.layers.filter(
    (l): l is ShaderLayer => l.type === "shader",
  );
  const sig = shaderLayers.map((l) => `${l.id}:${l.width}x${l.height}`).join(",");
  const sourceSig = shaderLayers.map((l) => l.fragmentSource).join("§");

  useEffect(() => {
    // perform mode owns the GPU context at 60fps — offscreen readbacks
    // here would stall it (SPEC2 §13 perf); pause previews while performing
    if (mode === "perform") return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startMs = performance.now();
    const engine = getAudioEngine();
    const filterMap = filters.current;
    const textureMap = textures.current;

    void (async () => {
      await gpuContext.init();
      const app = gpuContext.application;
      if (disposed || !app || !gpuContext.available) return;

      const scratch = new Container();

      const tick = () => {
        if (disposed) return;
        const next = new Map<string, Preview>();
        const t = (performance.now() - startMs) / 1000;
        for (const layer of scene.layers) {
          if (layer.type !== "shader") continue;
          // rebuild filter if source changed
          const cached = filterMap.get(layer.id);
          let filter = cached?.filter ?? null;
          if (!cached || cached.source !== layer.fragmentSource) {
            cached?.filter.destroy();
            filter = makeShaderFilter(layer.fragmentSource, layer.customParams);
            if (filter) filterMap.set(layer.id, { filter, source: layer.fragmentSource });
            else filterMap.delete(layer.id);
          }
          if (!filter) continue;

          const w = Math.min(MAX, Math.round(layer.width));
          const h = Math.min(MAX, Math.round(layer.height));
          let rt = textureMap.get(layer.id);
          if (!rt || rt.width !== w || rt.height !== h) {
            rt?.destroy(true);
            rt = RenderTexture.create({ width: w, height: h });
            textureMap.set(layer.id, rt);
          }

          // feed uniforms
          const g = (filter.resources.shaderUniforms as { uniforms: Record<string, unknown> }).uniforms;
          g.u_time = t;
          (g.u_resolution as Float32Array).set([w, h]);
          g.u_rms = engine.frame.rms;
          g.u_low = engine.frame.low;
          g.u_mid = engine.frame.mid;
          g.u_high = engine.frame.high;
          g.u_onset = engine.frame.onset;
          for (const [k, v] of Object.entries(layer.customParams)) g[k] = v;

          const quad = new Graphics().rect(0, 0, w, h).fill(0x000000);
          quad.filters = [filter];
          scratch.removeChildren();
          scratch.addChild(quad);
          app.renderer.render({ container: scratch, target: rt, clear: true });
          const canvas = app.renderer.extract.canvas(rt) as HTMLCanvasElement;
          quad.destroy();
          next.set(layer.id, { image: canvas, x: 0, y: 0, width: layer.width, height: layer.height });
        }
        if (!disposed) setPreviews(next);
      };

      tick();
      timer = setInterval(tick, 1000 / FPS);
    })();

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      filterMap.forEach((f) => f.filter.destroy());
      filterMap.clear();
      textureMap.forEach((t) => t.destroy(true));
      textureMap.clear();
    };
    // re-init when the set of shader layers or their sources/sizes change,
    // or when leaving/entering perform mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, sourceSig, mode]);

  return previews;
}
