"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import type { Layer, SceneGraph } from "@/types/scene";
import { getEffectDef } from "@/effects/registry";
import { EffectRenderer } from "@/effects/EffectRenderer";
import { gpuContext } from "@/effects/GpuContext";
import { useAppStore } from "@/state/store";
import { toggleEffect } from "@/state/commands";

export interface Preview {
  image: HTMLCanvasElement | HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEBOUNCE_MS = 60; // near-live preview (SPEC2 §9.2)

function hasGpuEffects(layer: Layer): boolean {
  return layer.effects.some(
    (e) => e.enabled && getEffectDef(e.kind)?.class === "gpu",
  );
}

/**
 * Edit-mode GPU-effect previews (SPEC2 §9.2): composites each effected
 * layer offscreen through the shared EffectRenderer and returns a map of
 * canvases the canvas overlays on top of the vector (which still handles
 * hit-testing). Recomputed debounced 60ms and paused while dragging.
 */
export function useEffectPreviews(
  stageRef: React.RefObject<Konva.Stage | null>,
  scene: SceneGraph,
  interacting: boolean,
): Map<string, Preview> {
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map());
  const rendererRef = useRef<EffectRenderer | null>(null);
  const dispatch = useAppStore((s) => s.dispatch);

  useEffect(() => {
    rendererRef.current = new EffectRenderer();
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (interacting) return; // pause previews while dragging (perf)
    let cancelled = false;
    const timer = setTimeout(async () => {
      const stage = stageRef.current;
      const renderer = rendererRef.current;
      if (!stage || !renderer) return;
      await gpuContext.init();
      if (cancelled || !gpuContext.available) return;

      const next = new Map<string, Preview>();
      const failures: { layerId: string; effectId: string }[] = [];

      for (const layer of scene.layers) {
        if (!layer.visible || !hasGpuEffects(layer)) continue;
        const node = stage.findOne(`#${layer.id}:inner`) as
          | Konva.Node
          | undefined;
        const wrapper = stage.findOne(`#${layer.id}`) as Konva.Node | undefined;
        if (!node || !wrapper) continue;
        try {
          const rect = node.getClientRect({ relativeTo: wrapper as Konva.Container });
          if (rect.width < 1 || rect.height < 1) continue;
          const source = node.toCanvas({ pixelRatio: 1 });
          const out = renderer.render(source, layer.effects, {
            onFailure: (f) =>
              failures.push({ layerId: layer.id, effectId: f.effectId }),
          });
          next.set(layer.id, {
            image: out,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          });
        } catch {
          // skip this layer's preview; vector still renders underneath
        }
      }

      if (cancelled) return;
      setPreviews(next);

      // a misbehaving effect disables only itself (SPEC2 §12.5)
      for (const f of failures) {
        dispatch(toggleEffect(f.layerId, f.effectId));
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scene, interacting, stageRef, dispatch]);

  return previews;
}
