"use client";

import { nanoid } from "nanoid";
import type { PathLayer, Effect } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { createEmptyScene } from "@/lib/scene";
import {
  gpuEffectDefs,
  bakeEffectDefs,
  defaultParams,
  allEffectDefs,
} from "@/effects/registry";

/**
 * Dev/test-only window hooks for the Playwright GLSL compile test and
 * scripted resource-lifecycle checks (SPEC2 §13). Never installed in a
 * production build.
 */
export function installTestHooks(): void {
  const w = window as unknown as Record<string, unknown>;

  w.__palmos = {
    /** Build a scene whose one layer carries every GPU layer-effect, plus
     *  every GPU post-fx at document level — forces all shaders to link. */
    loadAllEffectsScene() {
      const layerEffects: Effect[] = gpuEffectDefs()
        .filter((d) => d.kind !== "feedback")
        .map((d) => ({
          id: nanoid(),
          kind: d.kind,
          enabled: true,
          params: defaultParams(d),
        }));
      const layer: PathLayer = {
        id: nanoid(),
        name: "all effects",
        type: "path",
        transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        effects: layerEffects,
        d: "M 0 0 H 300 V 300 H 0 Z",
        fill: "#ff5c1f",
        stroke: null,
        strokeWidth: 0,
      };
      const postEffects: Effect[] = gpuEffectDefs()
        .filter((d) => ["bloom", "vignette", "chromaticAberration", "kaleido", "noiseWarp", "feedback"].includes(d.kind))
        .map((d) => ({
          id: nanoid(),
          kind: d.kind,
          enabled: true,
          params: defaultParams(d),
        }));
      const scene = { ...createEmptyScene(), layers: [layer], postEffects };
      useAppStore.getState().setScene(scene);
    },

    /** Build an N-layer scene (a few GPU-effected) for the stress loop. */
    loadStressScene(n: number) {
      const gpu = gpuEffectDefs().filter((d) => d.kind !== "feedback");
      const layers: PathLayer[] = Array.from({ length: n }, (_, i) => ({
        id: nanoid(),
        name: `layer ${i}`,
        type: "path",
        transform: { x: (i % 8) * 90, y: Math.floor(i / 8) * 90, scaleX: 1, scaleY: 1, rotation: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        // ~1 in 7 layers carries a GPU effect (the filter perf risk)
        effects:
          i % 7 === 0
            ? [{ id: nanoid(), kind: gpu[i % gpu.length].kind, enabled: true, params: defaultParams(gpu[i % gpu.length]) }]
            : [],
        d: "M 0 0 H 70 V 70 H 0 Z",
        fill: ["#ff5c1f", "#2f4bff", "#1b1b3a", "#f6b8dc"][i % 4],
        stroke: null,
        strokeWidth: 0,
      }));
      useAppStore.getState().setScene({ ...createEmptyScene(), layers });
    },

    setMode(mode: "edit" | "perform") {
      useAppStore.getState().setMode(mode);
    },

    heapMB(): number | null {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return mem ? Math.round(mem.usedJSHeapSize / 1e6) : null;
    },

    effectKinds: {
      gpu: gpuEffectDefs().map((d) => d.kind),
      bake: bakeEffectDefs().map((d) => d.kind),
      all: allEffectDefs().map((d) => d.kind),
    },
  };
}
