import { nanoid } from "nanoid";
import type { Layer, PathLayer } from "@/types/scene";
import type { ParamValue } from "@/effects/registry";
import { mulberry32 } from "./prng";
import type { BakeResult, RasterSource } from "./types";

/**
 * Bake implementations: pure functions of (source, params, seed) → Layers
 * (SPEC2 §12.5). No DOM, no shared state, no Math.random — safe to run in
 * a worker and reproducible for golden tests. Step 10 fills in the full
 * suite; each entry is independent.
 */

type Params = Record<string, ParamValue>;
type Impl = (source: RasterSource, params: Params, seed: number) => Layer[];

const num = (p: Params, k: string, d: number): number =>
  typeof p[k] === "number" ? (p[k] as number) : d;
const str = (p: Params, k: string, d: string): string =>
  typeof p[k] === "string" ? (p[k] as string) : d;

function luminance(data: Uint8ClampedArray, i: number): number {
  return (
    (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
  );
}

function hex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function pathLayer(name: string, d: string, fill: string): PathLayer {
  return {
    id: nanoid(),
    name,
    type: "path",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    effects: [],
    d,
    fill,
    stroke: null,
    strokeWidth: 0,
  };
}

/** Merge same-color horizontal runs per luminance band into batched rects. */
function rectRunsForBand(
  source: RasterSource,
  test: (lum: number) => boolean,
): string {
  const { width, height, data } = source;
  const segments: string[] = [];
  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const on = data[i + 3] > 8 && test(luminance(data, i));
      if (on && runStart === -1) runStart = x;
      if ((!on || x === width - 1) && runStart !== -1) {
        const end = on ? x + 1 : x;
        segments.push(
          `M ${runStart} ${y} H ${end} V ${y + 1} H ${runStart} Z`,
        );
        runStart = -1;
      }
    }
  }
  return segments.join(" ");
}

// ---------- posterizeTrace (Step 9 foundational bake) ----------

const posterizeTrace: Impl = (source, params, seed) => {
  const levels = Math.max(2, Math.min(8, Math.round(num(params, "levels", 4))));
  // seed only perturbs band assignment marginally — keeps determinism meaningful
  const rand = mulberry32(seed);
  const jitter = (rand() - 0.5) * 0.001;
  const layers: Layer[] = [];
  for (let l = 0; l < levels; l++) {
    const lo = l / levels + jitter;
    const hi = (l + 1) / levels + jitter;
    const d = rectRunsForBand(
      source,
      (lum) => lum >= lo && (l === levels - 1 ? lum <= 1.001 : lum < hi),
    );
    if (!d) continue;
    const shade = Math.round((l / (levels - 1)) * 255);
    layers.push(
      pathLayer(`posterize ${l + 1}`, d, hex(shade, shade, shade)),
    );
  }
  return layers;
};

const IMPLEMENTATIONS: Record<string, Impl> = {
  posterizeTrace,
};

export function hasBakeImpl(kind: string): boolean {
  return kind in IMPLEMENTATIONS;
}

export function runBake(
  kind: string,
  source: RasterSource,
  params: Params,
  seed: number,
): Omit<BakeResult, "jobId"> {
  const impl = IMPLEMENTATIONS[kind];
  if (!impl) throw new Error(`no bake implementation for "${kind}"`);
  const layers = impl(source, params, seed);
  return { layers };
}

export { pathLayer, luminance, hex, rectRunsForBand, num, str };
export type { Impl, Params };
export { IMPLEMENTATIONS };
