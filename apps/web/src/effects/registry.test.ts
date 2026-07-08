import { describe, expect, it } from "vitest";
import "@/effects/all"; // register the full suite
import {
  allEffectDefs,
  bakeEffectDefs,
  gpuEffectDefs,
  defaultParams,
  paramRange,
} from "@/effects/registry";
import { RECIPES } from "@/audio/recipes";
import { applyModulation, SmootherBank } from "@/perform/modulation";
import type { ModRouting } from "@/types/scene";

describe("effect registry", () => {
  it("registers the full suite (11 gpu + 9 bake + invert + posterize)", () => {
    expect(gpuEffectDefs().length).toBeGreaterThanOrEqual(12); // 11 + invert + post-fx
    expect(bakeEffectDefs().length).toBeGreaterThanOrEqual(10); // 9 + posterizeTrace
  });

  it("every effect has a kind, name, and at least one param", () => {
    for (const def of allEffectDefs()) {
      expect(def.kind).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.params.length).toBeGreaterThan(0);
    }
  });

  it("every numeric param declares a usable min/max range", () => {
    for (const def of allEffectDefs()) {
      for (const p of def.params) {
        if (p.type === "number") {
          const range = paramRange(def.kind, p.name);
          expect(range).not.toBeNull();
          expect(range!.max).toBeGreaterThan(range!.min);
        }
      }
    }
  });

  it("defaultParams covers every declared param", () => {
    for (const def of allEffectDefs()) {
      const dp = defaultParams(def);
      for (const p of def.params) expect(dp[p.name]).toBeDefined();
    }
  });
});

describe("modulation accepts a routing to every numeric effect param", () => {
  it("resolves ±40%-of-range offsets for each numeric gpu/post param", () => {
    const graph = {
      width: 800,
      height: 600,
      layers: [
        {
          id: "L",
          name: "l",
          type: "path" as const,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          opacity: 1,
          visible: true,
          locked: false,
          effects: gpuEffectDefs()
            .filter((d) => d.kind !== "invert")
            .map((d) => ({
              id: `fx-${d.kind}`,
              kind: d.kind,
              enabled: true,
              params: defaultParams(d),
            })),
          d: "M 0 0 H 10 V 10 Z",
          fill: "#000",
          stroke: null,
          strokeWidth: 0,
        },
      ],
      postEffects: [],
    };
    const features = { rms: 1, low: 1, mid: 1, high: 1, onset: 1 };

    // route every numeric param of every effect on layer L
    const routings: ModRouting[] = [];
    for (const def of gpuEffectDefs()) {
      if (def.kind === "invert") continue;
      for (const p of def.params) {
        if (p.type !== "number") continue;
        routings.push({
          id: `r-${def.kind}-${p.name}`,
          layerId: "L",
          target: `effect:fx-${def.kind}:${p.name}`,
          source: "rms",
          amount: 1,
          smoothing: 0,
          invert: false,
          phaseOffset: 0,
          ratchet: false,
        });
      }
    }

    const bank = new SmootherBank();
    const result = applyModulation(graph, features, routings, bank);
    const offsets = result.effects.get("L");
    expect(offsets).toBeDefined();
    // every routed param produced a finite offset
    for (const r of routings) {
      const [, effectId, param] = r.target.split(":");
      const v = offsets![`${effectId}:${param}`];
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("motion recipes", () => {
  const graph = { width: 800, height: 600, layers: [], postEffects: [] };
  const features = { rms: 0.5, low: 0.5, mid: 0.5, high: 0.5, onset: 0.5 };

  it("every shipped recipe applies to a sample layer without error", () => {
    for (const recipe of RECIPES) {
      const routings: ModRouting[] = recipe.routings.map((r, i) => ({
        ...r,
        id: `${recipe.id}-${i}`,
        layerId: "sample",
      }));
      const bank = new SmootherBank();
      expect(() =>
        applyModulation(graph, features, routings, bank),
      ).not.toThrow();
    }
  });

  it("growthProgress with ratchet never decreases across a falling signal", () => {
    const routing: ModRouting = {
      id: "grow",
      layerId: "g",
      target: "growthProgress",
      source: "rms",
      amount: 1,
      smoothing: 0,
      invert: false,
      phaseOffset: 0,
      ratchet: true,
    };
    const bank = new SmootherBank();
    // descending-then-rising rms sequence
    const seq = [0.2, 0.6, 0.9, 0.4, 0.1, 0.7, 0.3];
    let prev = 0;
    for (const rms of seq) {
      const r = applyModulation(graph, { ...features, rms }, [routing], bank);
      const g = r.growth.get("g")!;
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});
