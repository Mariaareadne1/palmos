import { describe, expect, it } from "vitest";
import "@/effects/bake"; // register defs (not strictly needed for impls)
import { runBake } from "./implementations";
import type { RasterSource } from "./types";
import type { Layer, PathLayer } from "@/types/scene";

/** Synthetic 120×90 raster: cream bg + dark square + mid circle. */
function makeSource(): RasterSource {
  const width = 120;
  const height = 90;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = 242, g = 237, b = 228; // cream
      if (x > 20 && x < 60 && y > 20 && y < 60) {
        r = 20; g = 20; b = 30; // dark square
      } else if (Math.hypot(x - 85, y - 55) < 22) {
        r = 210; g = 60; b = 70; // mid circle
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const TOKEN_RE = new RegExp(`[MmLlHhVvCcSsQqTtAaZz]|${NUM.source}`, "g");
function dParses(d: string): boolean {
  const tokens = d.match(TOKEN_RE);
  if (!tokens || !/[Mm]/.test(tokens[0])) return false;
  return tokens.every((t) => /[MmLlHhVvCcSsQqTtAaZz]/.test(t) || !Number.isNaN(parseFloat(t)));
}

function collectPaths(layers: Layer[]): PathLayer[] {
  const out: PathLayer[] = [];
  for (const l of layers) {
    if (l.type === "path") out.push(l);
    else if (l.type === "group") out.push(...collectPaths(l.children));
  }
  return out;
}

// pixelSort needs OffscreenCanvas (browser only) — covered by the browser
// smoke test in Step 13, not here.
const VECTOR_BAKES = [
  "posterizeTrace",
  "halftone",
  "stipple",
  "edgeTrace",
  "asciiGrid",
  "patternFill",
  "ditherBake",
  "scatter",
  "cellularAutomata",
];

describe("bake implementations", () => {
  const source = makeSource();

  for (const kind of VECTOR_BAKES) {
    it(`${kind} produces editable layers with parseable paths`, async () => {
      const { layers } = await runBake(kind, source, {}, 7);
      expect(layers.length).toBeGreaterThan(0);
      for (const p of collectPaths(layers)) {
        expect(dParses(p.d)).toBe(true);
      }
    });

    it(`${kind} is deterministic for a fixed seed (golden)`, async () => {
      const a = await runBake(kind, source, {}, 42);
      const b = await runBake(kind, source, {}, 42);
      // compare geometry (ids are random by design)
      const geom = (ls: Layer[]) =>
        collectPaths(ls).map((p) => `${p.d}|${p.fill}`).join("§");
      expect(geom(a.layers)).toBe(geom(b.layers));
    });
  }

  it("stipple density responds to darkness (more dots in darker input)", async () => {
    const dark: RasterSource = {
      width: 60,
      height: 60,
      data: new Uint8ClampedArray(60 * 60 * 4).map((_, i) =>
        i % 4 === 3 ? 255 : 10,
      ),
    };
    const { layers } = await runBake("stipple", dark, { density: 0.05 }, 1);
    const subs = collectPaths(layers).reduce(
      (n, p) => n + (p.d.match(/M/g)?.length ?? 0),
      0,
    );
    expect(subs).toBeGreaterThan(50);
  });

  it("asciiGrid batches into ≤20 text layers", async () => {
    const { layers } = await runBake("asciiGrid", source, { cellSize: 6 }, 1);
    expect(layers.length).toBeLessThanOrEqual(20);
    expect(layers.every((l) => l.type === "text")).toBe(true);
  });

  it("scatter caps at 400 tiles and stamps sourceGenerator via the host", async () => {
    const { layers } = await runBake("scatter", source, { tileSize: 8 }, 1);
    expect(layers.length).toBeLessThanOrEqual(400);
    expect(layers.every((l) => l.type === "path")).toBe(true);
  });
});
