import { nanoid } from "nanoid";
import type { ImageLayer, Layer, PathLayer, TextLayer } from "@/types/scene";
import type { ParamValue } from "@/effects/registry";
import { mulberry32 } from "./prng";
import type { BakeResult, RasterSource } from "./types";

/**
 * Bake implementations: pure functions of (source, params, seed) → Layers
 * (SPEC2 §12.5). No DOM (except OffscreenCanvas for inherently-raster
 * outputs), no shared state, no Math.random — reproducible for golden
 * tests and safe in the worker. Aggressive batching keeps the layers
 * panel usable (§10).
 */

type Params = Record<string, ParamValue>;
type Impl = (
  source: RasterSource,
  params: Params,
  seed: number,
) => Layer[] | Promise<Layer[]>;

const num = (p: Params, k: string, d: number): number =>
  typeof p[k] === "number" ? (p[k] as number) : d;
const str = (p: Params, k: string, d: string): string =>
  typeof p[k] === "string" ? (p[k] as string) : d;
const bool = (p: Params, k: string, d: boolean): boolean =>
  typeof p[k] === "boolean" ? (p[k] as boolean) : d;

function lumAt(data: Uint8ClampedArray, i: number): number {
  return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
}
function hex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function pathLayer(name: string, d: string, fill: string | null, stroke?: string, strokeWidth = 0): PathLayer {
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
    stroke: stroke ?? null,
    strokeWidth,
  };
}

function textLayer(name: string, text: string, x: number, y: number, size: number, fill: string, font: string): TextLayer {
  return {
    id: nanoid(),
    name,
    type: "text",
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    effects: [],
    text,
    fontFamily: font,
    fontSize: size,
    fontWeight: 400,
    fill,
    align: "left",
    letterSpacing: 0,
    strokeOnly: false,
  };
}

function circleSub(cx: number, cy: number, r: number): string {
  if (r <= 0.05) return "";
  return `M ${(cx - r).toFixed(2)} ${cy.toFixed(2)} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(r * 2).toFixed(2)} 0 a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-r * 2).toFixed(2)} 0 Z`;
}
function rectSub(x: number, y: number, w: number, h: number): string {
  return `M ${x.toFixed(2)} ${y.toFixed(2)} h ${w.toFixed(2)} v ${h.toFixed(2)} h ${(-w).toFixed(2)} Z`;
}

// ---------- posterizeTrace (Step 9 foundational) ----------

function rectRunsForBand(source: RasterSource, test: (lum: number) => boolean): string {
  const { width, height, data } = source;
  const seg: string[] = [];
  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const on = data[i + 3] > 8 && test(lumAt(data, i));
      if (on && runStart === -1) runStart = x;
      if ((!on || x === width - 1) && runStart !== -1) {
        const end = on ? x + 1 : x;
        seg.push(rectSub(runStart, y, end - runStart, 1));
        runStart = -1;
      }
    }
  }
  return seg.join(" ");
}

const posterizeTrace: Impl = (source, params, seed) => {
  const levels = Math.max(2, Math.min(8, Math.round(num(params, "levels", 4))));
  const jitter = (mulberry32(seed)() - 0.5) * 0.001;
  const layers: Layer[] = [];
  for (let l = 0; l < levels; l++) {
    const lo = l / levels + jitter;
    const hi = (l + 1) / levels + jitter;
    const d = rectRunsForBand(source, (lum) => lum >= lo && (l === levels - 1 ? lum <= 1.001 : lum < hi));
    if (!d) continue;
    const shade = Math.round((l / (levels - 1)) * 255);
    layers.push(pathLayer(`posterize ${l + 1}`, d, hex(shade, shade, shade)));
  }
  return layers;
};

// ---------- halftone ----------

const halftone: Impl = (source, params) => {
  const { width, height, data } = source;
  const cell = Math.max(4, num(params, "cellSize", 10));
  const angle = (num(params, "angle", 15) * Math.PI) / 180;
  const dotMin = num(params, "dotMin", 0);
  const dotMax = num(params, "dotMax", 1);
  const shape = str(params, "shape", "circle");
  const gridType = str(params, "gridType", "regular");
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = width / 2;
  const cy = height / 2;
  const BUCKETS = 12;
  const buckets: string[][] = Array.from({ length: BUCKETS }, () => []);

  const diag = Math.ceil(Math.hypot(width, height) / cell) + 2;
  for (let gy = -diag; gy <= diag; gy++) {
    for (let gx = -diag; gx <= diag; gx++) {
      const lx = (gx + (gridType === "stagger" && gy % 2 ? 0.5 : 0)) * cell;
      const ly = gy * cell;
      // rotate grid point back into image space
      const px = cx + lx * cos - ly * sin;
      const py = cy + lx * sin + ly * cos;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const i = (Math.floor(py) * width + Math.floor(px)) * 4;
      if (data[i + 3] < 8) continue;
      const darkness = 1 - lumAt(data, i);
      const t = dotMin + darkness * (dotMax - dotMin);
      const r = Math.min(cell * 0.75, (t * cell) / 2);
      if (r <= 0.1) continue;
      const b = Math.min(BUCKETS - 1, Math.floor((r / (cell / 2)) * BUCKETS));
      if (shape === "square") buckets[b].push(rectSub(px - r, py - r, r * 2, r * 2));
      else if (shape === "line") buckets[b].push(rectSub(px - r, py - cell * 0.15, r * 2, cell * 0.3));
      else buckets[b].push(circleSub(px, py, r));
      // benday: a second offset dot for the classic dotted feel
      if (gridType === "benday" && r > cell * 0.2) {
        buckets[b].push(circleSub(px + cell * 0.5, py + cell * 0.5, r * 0.5));
      }
    }
  }
  const layers: Layer[] = [];
  buckets.forEach((subs, i) => {
    if (!subs.length) return;
    layers.push(pathLayer(`halftone ${i + 1}`, subs.join(" "), "#0a0a0a"));
  });
  return layers;
};

// ---------- stipple ----------

const stipple: Impl = (source, params, seed) => {
  const { width, height, data } = source;
  const density = num(params, "density", 0.02);
  const dotSize = num(params, "dotSize", 1.5);
  const rand = mulberry32(seed);
  const candidates = Math.min(200_000, Math.floor(width * height * density * 4));
  const BUCKETS = 8;
  const buckets: string[][] = Array.from({ length: BUCKETS }, () => []);
  for (let n = 0; n < candidates; n++) {
    const x = Math.floor(rand() * width);
    const y = Math.floor(rand() * height);
    const i = (y * width + x) * 4;
    if (data[i + 3] < 8) continue;
    const darkness = 1 - lumAt(data, i);
    if (rand() < darkness) {
      const b = Math.min(BUCKETS - 1, Math.floor(darkness * BUCKETS));
      buckets[b].push(circleSub(x, y, dotSize * (0.5 + darkness * 0.5)));
    }
  }
  const layers: Layer[] = [];
  buckets.forEach((subs, i) => {
    if (subs.length) layers.push(pathLayer(`stipple ${i + 1}`, subs.join(" "), "#0a0a0a"));
  });
  return layers;
};

// ---------- edgeTrace ----------

const edgeTrace: Impl = (source, params) => {
  const { width, height, data } = source;
  const threshold = num(params, "threshold", 0.2);
  const simplify = num(params, "simplify", 1.5);
  const minRun = Math.max(1, Math.round(simplify));
  const sobel = (x: number, y: number): number => {
    const L = (xx: number, yy: number) =>
      lumAt(data, (Math.max(0, Math.min(height - 1, yy)) * width + Math.max(0, Math.min(width - 1, xx))) * 4);
    const gx = L(x - 1, y - 1) + 2 * L(x - 1, y) + L(x - 1, y + 1) - L(x + 1, y - 1) - 2 * L(x + 1, y) - L(x + 1, y + 1);
    const gy = L(x - 1, y - 1) + 2 * L(x, y - 1) + L(x + 1, y - 1) - L(x - 1, y + 1) - 2 * L(x, y + 1) - L(x + 1, y + 1);
    return Math.hypot(gx, gy);
  };
  const segs: string[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x < width; x++) {
      const edge = sobel(x, y) > threshold;
      if (edge && start === -1) start = x;
      if ((!edge || x === width - 1) && start !== -1) {
        const end = edge ? x : x - 1;
        if (end - start >= minRun) segs.push(`M ${start} ${y} H ${end}`);
        start = -1;
      }
    }
  }
  return segs.length ? [pathLayer("edges", segs.join(" "), null, "#0a0a0a", 1)] : [];
};

// ---------- asciiGrid ----------

const RAMPS: Record<string, string> = {
  blocks: " ░▒▓█",
  ascii: " .:-=+*#%@",
  dots: " ·•●",
};

const asciiGrid: Impl = (source, params) => {
  const { width, height, data } = source;
  const cell = Math.max(6, num(params, "cellSize", 14));
  const ramp = RAMPS[str(params, "charset", "ascii")] ?? RAMPS.ascii;
  const font = str(params, "font", "Space Mono");
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const rowStrings: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let count = 0;
      const x0 = c * cell;
      const y0 = r * cell;
      for (let yy = y0; yy < y0 + cell; yy += 2) {
        for (let xx = x0; xx < x0 + cell; xx += 2) {
          const i = (yy * width + xx) * 4;
          if (data[i + 3] > 8) {
            sum += 1 - lumAt(data, i);
            count++;
          }
        }
      }
      const darkness = count ? sum / count : 0;
      line += ramp[Math.min(ramp.length - 1, Math.floor(darkness * ramp.length))];
    }
    rowStrings.push(line);
  }
  // batch rows into ≤20 multi-line TextLayers
  const GROUPS = Math.min(20, rows || 1);
  const perGroup = Math.ceil(rows / GROUPS) || 1;
  const layers: Layer[] = [];
  for (let g = 0; g < rows; g += perGroup) {
    const chunk = rowStrings.slice(g, g + perGroup);
    const t = textLayer(`ascii ${g / perGroup + 1}`, chunk.join("\n"), 0, g * cell, cell, "#0a0a0a", font);
    t.letterSpacing = cell - cell * 0.6; // mono char ≈ 0.6em wide
    layers.push(t);
  }
  return layers;
};

// ---------- patternFill ----------

const patternFill: Impl = (source, params) => {
  const { width, height, data } = source;
  const pattern = str(params, "pattern", "lines");
  const spacing = Math.max(3, num(params, "spacing", 8));
  const angle = (num(params, "angle", 45) * Math.PI) / 180;
  const weight = num(params, "weight", 1);
  const masked = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const i = (Math.floor(y) * width + Math.floor(x)) * 4;
    return data[i + 3] > 8 && lumAt(data, i) < 0.55;
  };
  const segs: string[] = [];
  const emitLine = (angleR: number, offsetStep: number) => {
    const cos = Math.cos(angleR);
    const sin = Math.sin(angleR);
    const diag = Math.hypot(width, height);
    for (let d = -diag; d < diag; d += offsetStep) {
      let run: [number, number] | null = null;
      for (let t = 0; t < diag; t += 2) {
        const x = width / 2 + cos * t - sin * d;
        const y = height / 2 + sin * t + cos * d;
        if (masked(x, y)) {
          if (!run) run = [x, y];
        } else if (run) {
          segs.push(`M ${run[0].toFixed(1)} ${run[1].toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`);
          run = null;
        }
      }
    }
  };
  if (pattern === "lines") emitLine(angle, spacing);
  else if (pattern === "crosshatch") {
    emitLine(angle, spacing);
    emitLine(angle + Math.PI / 2, spacing);
  } else if (pattern === "checker") {
    for (let y = 0; y < height; y += spacing) {
      for (let x = 0; x < width; x += spacing) {
        if (((x / spacing) | 0) % 2 === ((y / spacing) | 0) % 2 && masked(x + spacing / 2, y + spacing / 2)) {
          segs.push(rectSub(x, y, spacing, spacing));
        }
      }
    }
    return segs.length ? [pathLayer("pattern", segs.join(" "), "#0a0a0a")] : [];
  } else if (pattern === "waves") {
    for (let baseY = 0; baseY < height; baseY += spacing) {
      let run: string[] = [];
      for (let x = 0; x < width; x += 2) {
        const y = baseY + Math.sin(x * 0.05) * spacing * 0.4;
        if (masked(x, y)) run.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
        else if (run.length) {
          segs.push(`M ${run.join(" L ")}`);
          run = [];
        }
      }
      if (run.length) segs.push(`M ${run.join(" L ")}`);
    }
  } else {
    // contour: iso-line boundaries between luminance bands
    for (let y = 1; y < height; y += 2) {
      let start = -1;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const on = data[i + 3] > 8 && Math.floor(lumAt(data, i) * 5) !== Math.floor(lumAt(data, i - 4 < 0 ? i : i - 4) * 5);
        if (on && start === -1) start = x;
        else if (!on && start !== -1) {
          segs.push(`M ${start} ${y} H ${x}`);
          start = -1;
        }
      }
    }
  }
  return segs.length ? [pathLayer("pattern", segs.join(" "), null, "#0a0a0a", weight)] : [];
};

// ---------- ditherBake (Floyd–Steinberg) ----------

const ditherBake: Impl = (source, params) => {
  const { width, height, data } = source;
  const pixel = Math.max(1, Math.round(num(params, "pixelSize", 3)));
  const paletteMode = str(params, "palette", "bw");
  const gw = Math.max(1, Math.floor(width / pixel));
  const gh = Math.max(1, Math.floor(height / pixel));
  // downsample to grayscale grid
  const grid = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = (Math.floor((gy + 0.5) * pixel) * width + Math.floor((gx + 0.5) * pixel)) * 4;
      grid[gy * gw + gx] = lumAt(data, i);
    }
  }
  const levels = paletteMode === "scene" ? [0, 0.33, 0.66, 1] : [0, 1];
  const nearest = (v: number) => levels.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), levels[0]);
  // Floyd–Steinberg over the grid (deterministic)
  const out = new Float64Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const idx = y * gw + x;
      const old = grid[idx];
      const q = nearest(old);
      out[idx] = q;
      const err = old - q;
      if (x + 1 < gw) grid[idx + 1] += (err * 7) / 16;
      if (y + 1 < gh) {
        if (x > 0) grid[idx + gw - 1] += (err * 3) / 16;
        grid[idx + gw] += (err * 5) / 16;
        if (x + 1 < gw) grid[idx + gw + 1] += (err * 1) / 16;
      }
    }
  }
  // batch rects by quantized color
  const byColor = new Map<number, string[]>();
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const v = out[y * gw + x];
      const key = Math.round(v * 255);
      if (!byColor.has(key)) byColor.set(key, []);
      byColor.get(key)!.push(rectSub(x * pixel, y * pixel, pixel, pixel));
    }
  }
  const layers: Layer[] = [];
  for (const [key, subs] of [...byColor.entries()].sort((a, b) => a[0] - b[0])) {
    layers.push(pathLayer(`dither ${key}`, subs.join(" "), hex(key, key, key)));
  }
  return layers;
};

// ---------- scatter ----------

const scatter: Impl = (source, params, seed) => {
  const { width, height, data } = source;
  const tile = Math.max(8, num(params, "tileSize", 40));
  const jitter = num(params, "jitter", 0.3);
  const rotJitter = num(params, "rotationJitter", 0);
  const rand = mulberry32(seed);
  const cols = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  const children: Layer[] = [];
  const CAP = 400;
  for (let r = 0; r < rows && children.length < CAP; r++) {
    for (let c = 0; c < cols && children.length < CAP; c++) {
      const x0 = c * tile;
      const y0 = r * tile;
      // mean color of the tile
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let yy = y0; yy < Math.min(y0 + tile, height); yy += 3) {
        for (let xx = x0; xx < Math.min(x0 + tile, width); xx += 3) {
          const i = (yy * width + xx) * 4;
          if (data[i + 3] > 8) {
            sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
          }
        }
      }
      if (!n) continue;
      const jx = (rand() * 2 - 1) * jitter * tile;
      const jy = (rand() * 2 - 1) * jitter * tile;
      const rot = (rand() * 2 - 1) * rotJitter;
      const layer = pathLayer(`tile ${r}.${c}`, rectSub(0, 0, tile, tile), hex(sr / n, sg / n, sb / n));
      layer.transform = { x: x0 + jx, y: y0 + jy, scaleX: 1, scaleY: 1, rotation: rot };
      children.push(layer);
    }
  }
  return children;
};

// ---------- cellularAutomata ----------

const cellularAutomata: Impl = (source, params, seed) => {
  const { width, height, data } = source;
  const cellSize = Math.max(2, Math.round(num(params, "cellSize", 8)));
  const steps = Math.max(1, Math.round(num(params, "steps", 6)));
  const rule = str(params, "rule", "life");
  const seedImg = bool(params, "seedFromImage", true);
  const gw = Math.max(1, Math.floor(width / cellSize));
  const gh = Math.max(1, Math.floor(height / cellSize));
  const rand = mulberry32(seed);
  let grid = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = (Math.floor((y + 0.5) * cellSize) * width + Math.floor((x + 0.5) * cellSize)) * 4;
      const alive = seedImg ? data[i + 3] > 8 && lumAt(data, i) < 0.5 : rand() < 0.3;
      grid[y * gw + x] = alive ? 1 : 0;
    }
  }
  const born: Record<string, number[]> = { life: [3], maze: [3], coral: [3] };
  const survive: Record<string, number[]> = {
    life: [2, 3],
    maze: [1, 2, 3, 4, 5],
    coral: [4, 5, 6, 7, 8],
  };
  const B = born[rule] ?? born.life;
  const S = survive[rule] ?? survive.life;
  const nonEmpty = (g: Uint8Array) => g.some((v) => v === 1);
  let lastNonEmpty = nonEmpty(grid) ? grid.slice() : grid;
  for (let s = 0; s < steps; s++) {
    const next = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < gw && ny >= 0 && ny < gh) n += grid[ny * gw + nx];
          }
        const alive = grid[y * gw + x];
        next[y * gw + x] = alive ? (S.includes(n) ? 1 : 0) : B.includes(n) ? 1 : 0;
      }
    }
    grid = next;
    if (nonEmpty(grid)) lastNonEmpty = grid.slice();
  }
  // never bake to nothing: if the rule died out, keep the last living state
  if (!nonEmpty(grid)) grid = lastNonEmpty;
  const subs: string[] = [];
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      if (grid[y * gw + x]) subs.push(rectSub(x * cellSize, y * cellSize, cellSize, cellSize));
  return subs.length ? [pathLayer(`automata (${rule})`, subs.join(" "), "#0a0a0a")] : [];
};

// ---------- pixelSort (raster output → ImageLayer) ----------

const pixelSort: Impl = async (source, params, seed) => {
  const { width, height } = source;
  const src = new Uint8ClampedArray(source.data); // copy — never mutate input
  const threshold = num(params, "threshold", 0.5);
  const vertical = str(params, "direction", "horizontal") === "vertical";
  const mode = str(params, "mode", "luminance");
  const jitter = num(params, "intervalJitter", 0.2);
  const rand = mulberry32(seed);

  const keyOf = (i: number): number => {
    if (mode === "hue") {
      const r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return 0;
      const dd = max - min;
      let h = 0;
      if (max === r) h = ((g - b) / dd) % 6;
      else if (max === g) h = (b - r) / dd + 2;
      else h = (r - g) / dd + 4;
      return h / 6;
    }
    return (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255;
  };

  const sortLine = (indices: number[]) => {
    let seg: number[] = [];
    const flush = () => {
      if (seg.length > 1) {
        const px = seg.map((i) => [src[i], src[i + 1], src[i + 2], src[i + 3], keyOf(i)] as const);
        px.sort((a, b) => a[4] - b[4]);
        seg.forEach((i, k) => {
          src[i] = px[k][0]; src[i + 1] = px[k][1]; src[i + 2] = px[k][2]; src[i + 3] = px[k][3];
        });
      }
      seg = [];
    };
    const localThresh = threshold + (rand() * 2 - 1) * jitter * 0.3;
    for (const i of indices) {
      if (keyOf(i) > localThresh) seg.push(i);
      else flush();
    }
    flush();
  };

  if (vertical) {
    for (let x = 0; x < width; x++) {
      const col: number[] = [];
      for (let y = 0; y < height; y++) col.push((y * width + x) * 4);
      sortLine(col);
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) row.push((y * width + x) * 4);
      sortLine(row);
    }
  }

  const dataUrl = await rasterToDataUrl(src, width, height);
  const layer: ImageLayer = {
    id: nanoid(),
    name: "pixel sort",
    type: "image",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    effects: [],
    src: dataUrl,
    width,
    height,
  };
  return [layer];
};

/** Encode RGBA → PNG data URL inside the worker (OffscreenCanvas + base64). */
async function rasterToDataUrl(data: Uint8ClampedArray, width: number, height: number): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  // copy into a fresh ArrayBuffer-backed array for ImageData's type
  const buf = new Uint8ClampedArray(width * height * 4);
  buf.set(data);
  ctx.putImageData(new ImageData(buf, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(binary)}`;
}

// ---------- registry ----------

const IMPLEMENTATIONS: Record<string, Impl> = {
  posterizeTrace,
  halftone,
  stipple,
  edgeTrace,
  asciiGrid,
  patternFill,
  ditherBake,
  scatter,
  cellularAutomata,
  pixelSort,
};

export function hasBakeImpl(kind: string): boolean {
  return kind in IMPLEMENTATIONS;
}

export async function runBake(
  kind: string,
  source: RasterSource,
  params: Params,
  seed: number,
): Promise<Omit<BakeResult, "jobId">> {
  const impl = IMPLEMENTATIONS[kind];
  if (!impl) throw new Error(`no bake implementation for "${kind}"`);
  const layers = await impl(source, params, seed);
  return { layers };
}

export { IMPLEMENTATIONS };
export type { Impl, Params };
