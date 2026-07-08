import { nanoid } from "nanoid";
import type {
  Effect,
  Fill,
  GroupLayer,
  Layer,
  PathLayer,
} from "@/types/scene";
import type { ParamDef, ParamValue } from "@/effects/registry";
import {
  catmullRomClosed,
  catmullRomOpen,
  makeNoise2D,
  mulberry32,
  round2 as r2,
  type Pt,
} from "./geometry";

/**
 * Parametric element generators (SPEC2 §12.1–12.2) for the painterly
 * art-tech aesthetic. Each emits an ordinary GroupLayer of editable
 * PathLayers, stamped with `sourceGenerator` (so motion recipes match)
 * and `generatorParams` (so it stays regenerable until ungrouped). All
 * randomness is seeded → deterministic.
 */

export type GenParams = Record<string, ParamValue>;

export interface GeneratorDef {
  key: string;
  name: string;
  /** which motion recipe matches this generator's output */
  recipeMatch?: string;
  params: ParamDef[];
  generate(params: GenParams, palette: string[]): GroupLayer;
}

const num = (p: GenParams, k: string, d: number) =>
  typeof p[k] === "number" ? (p[k] as number) : d;
const str = (p: GenParams, k: string, d: string) =>
  typeof p[k] === "string" ? (p[k] as string) : d;
const bool = (p: GenParams, k: string, d: boolean) =>
  typeof p[k] === "boolean" ? (p[k] as boolean) : d;

function path(name: string, d: string, fill: Fill, stroke?: string, strokeWidth = 0, effects: Effect[] = []): PathLayer {
  return {
    id: nanoid(),
    name,
    type: "path",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    effects,
    d,
    fill,
    stroke: stroke ?? null,
    strokeWidth,
  };
}

function group(
  name: string,
  children: Layer[],
  sourceGenerator: string,
  generatorParams: GenParams,
  extra: Partial<GroupLayer> = {},
): GroupLayer {
  return {
    id: nanoid(),
    name,
    type: "group",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    effects: [],
    children,
    sourceGenerator,
    generatorParams,
    ...extra,
  };
}

const glow = (color: string, intensity = 1, spread = 8): Effect => ({
  id: nanoid(),
  kind: "glow",
  enabled: true,
  params: { color, intensity, spread, threshold: 0.4 },
});
const grain = (amount = 0.12): Effect => ({
  id: nanoid(),
  kind: "grain",
  enabled: true,
  params: { amount, size: 1.5, animated: false },
});

const seedParam: ParamDef = { name: "seed", label: "seed", type: "number", min: 0, max: 9999, step: 1, default: 1 };

// ---------- soft wash / aura blob (the load-bearing element) ----------

const wash: GeneratorDef = {
  key: "wash",
  name: "soft wash",
  recipeMatch: "wash",
  params: [
    { name: "points", label: "points", type: "number", min: 3, max: 8, step: 1, default: 5 },
    { name: "spread", label: "spread", type: "number", min: 80, max: 400, step: 10, default: 240 },
    { name: "coreColor", label: "core", type: "color", default: "#f6b8dc" },
    { name: "softness", label: "softness", type: "number", min: 0, max: 1, step: 0.05, default: 0.7 },
    { name: "grain", label: "grain", type: "boolean", default: true },
    seedParam,
  ],
  generate(params) {
    const rand = mulberry32(num(params, "seed", 1));
    const n = Math.round(num(params, "points", 5));
    const spread = num(params, "spread", 240);
    const core = str(params, "coreColor", "#f6b8dc");
    const softness = num(params, "softness", 0.7);
    const cx = spread;
    const cy = spread;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = spread * (0.6 + rand() * 0.4);
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    const rgb = hexToRgb(core);
    const fill: Fill = {
      type: "radial",
      stops: [
        { offset: 0, color: core },
        { offset: 0.6, color: `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)` },
        { offset: 1, color: `rgba(${rgb.r},${rgb.g},${rgb.b},0)` },
      ],
      angle: 0,
      cx: 0.5,
      cy: 0.5,
    };
    const fx: Effect[] = [glow(core, 1 + softness, 6 + softness * 10)];
    if (bool(params, "grain", true)) fx.push(grain());
    const blob = path("aura", catmullRomClosed(pts), fill, undefined, 0, fx);
    return group("soft wash", [blob], "wash", params);
  },
};

// ---------- ink splatter ----------

const splatter: GeneratorDef = {
  key: "splatter",
  name: "ink splatter",
  recipeMatch: "splatter",
  params: [
    { name: "drops", label: "drops", type: "number", min: 3, max: 40, step: 1, default: 14 },
    { name: "sizeRange", label: "size", type: "number", min: 4, max: 60, step: 1, default: 24 },
    { name: "energy", label: "energy", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
    { name: "color", label: "color", type: "color", default: "#1b1b3a" },
    seedParam,
  ],
  generate(params) {
    const rand = mulberry32(num(params, "seed", 1));
    const drops = Math.round(num(params, "drops", 14));
    const size = num(params, "sizeRange", 24);
    const energy = num(params, "energy", 0.5);
    const color = str(params, "color", "#1b1b3a");
    const field = 200 + energy * 300;
    const children: Layer[] = [];
    for (let i = 0; i < drops; i++) {
      const cx = field / 2 + (rand() - 0.5) * field * (0.4 + energy);
      const cy = field / 2 + (rand() - 0.5) * field * (0.4 + energy);
      const r = size * (0.2 + rand() * 0.8);
      // perturbed circle + occasional teardrop streak
      const pts: Pt[] = [];
      const segs = 10;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const rr = r * (0.7 + rand() * 0.5);
        pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
      }
      children.push(path(`splat ${i + 1}`, catmullRomClosed(pts), color));
      if (rand() < energy * 0.6) {
        const a = rand() * Math.PI * 2;
        const len = r * (2 + energy * 4);
        const tx = cx + Math.cos(a) * len;
        const ty = cy + Math.sin(a) * len;
        const d = `M ${r2(cx)} ${r2(cy)} Q ${r2(cx + Math.cos(a) * len * 0.5 + r)} ${r2(cy + Math.sin(a) * len * 0.5)} ${r2(tx)} ${r2(ty)} L ${r2(tx + 1)} ${r2(ty + 1)} Z`;
        children.push(path(`streak ${i + 1}`, d, color));
      }
    }
    return group("ink splatter", children, "splatter", params);
  },
};

// ---------- brush stroke ----------

const brush: GeneratorDef = {
  key: "brush",
  name: "brush stroke",
  recipeMatch: "brush",
  params: [
    { name: "width", label: "width", type: "number", min: 4, max: 60, step: 1, default: 24 },
    { name: "wobble", label: "wobble", type: "number", min: 0, max: 1, step: 0.05, default: 0.3 },
    { name: "taper", label: "taper", type: "select", options: ["sumi", "marker", "dry"], default: "sumi" },
    { name: "color", label: "color", type: "color", default: "#1b1b3a" },
    seedParam,
  ],
  generate(params) {
    const rand = mulberry32(num(params, "seed", 1));
    const width = num(params, "width", 24);
    const wobble = num(params, "wobble", 0.3);
    const taper = str(params, "taper", "sumi");
    const color = str(params, "color", "#1b1b3a");
    // spine left→right with vertical wobble
    const steps = 24;
    const spine: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      spine.push({ x: 40 + t * 360, y: 120 + Math.sin(t * 6 + rand()) * wobble * 60 });
    }
    const widthAt = (t: number): number => {
      if (taper === "marker") return width * (0.9 + 0.1 * Math.sin(t * 3));
      if (taper === "dry") return width * (0.5 + rand() * 0.5) * (1 - Math.abs(t - 0.5));
      return width * Math.sin(Math.PI * t) ** 0.6; // sumi: swelling middle
    };
    const top: Pt[] = [];
    const bot: Pt[] = [];
    spine.forEach((p, i) => {
      const t = i / steps;
      const w = widthAt(t) / 2;
      top.push({ x: p.x, y: p.y - w });
      bot.push({ x: p.x, y: p.y + w });
    });
    const d = catmullRomOpen(top) + " " + catmullRomOpen(bot.reverse()).replace("M", "L") + " Z";
    return group("brush stroke", [path("stroke", d, color)], "brush", params);
  },
};

// ---------- dendrite (space colonization, with growth playback) ----------

const dendrite: GeneratorDef = {
  key: "dendrite",
  name: "dendrite",
  recipeMatch: "dendrite",
  params: [
    { name: "density", label: "density", type: "number", min: 20, max: 300, step: 10, default: 120 },
    { name: "spread", label: "spread", type: "number", min: 150, max: 500, step: 10, default: 320 },
    { name: "thickness", label: "thickness", type: "number", min: 0.5, max: 6, step: 0.5, default: 2 },
    { name: "color", label: "color", type: "color", default: "#1b3a5c" },
    seedParam,
  ],
  generate(params) {
    const rand = mulberry32(num(params, "seed", 1));
    const spread = num(params, "spread", 320);
    const nAttractors = Math.round(num(params, "density", 120));
    const thickness = num(params, "thickness", 2);
    const color = str(params, "color", "#1b3a5c");

    // space colonization
    const attractors: Pt[] = [];
    for (let i = 0; i < nAttractors; i++) {
      attractors.push({ x: rand() * spread, y: rand() * spread * 0.9 });
    }
    interface Node { pos: Pt; parent: number }
    const nodes: Node[] = [{ pos: { x: spread / 2, y: spread }, parent: -1 }];
    const step = spread / 30;
    const killDist = step * 0.9;
    const influence = spread / 4;
    const segments: [Pt, Pt][] = [];
    const growthSegments: [Pt, Pt][][] = [];

    for (let iter = 0; iter < 200 && attractors.length; iter++) {
      const pulls = new Map<number, Pt>();
      for (let ai = attractors.length - 1; ai >= 0; ai--) {
        const a = attractors[ai];
        let closest = -1;
        let cd = Infinity;
        for (let ni = 0; ni < nodes.length; ni++) {
          const dd = dist(a, nodes[ni].pos);
          if (dd < cd) { cd = dd; closest = ni; }
        }
        if (cd < killDist) { attractors.splice(ai, 1); continue; }
        if (cd < influence) {
          const dir = norm({ x: a.x - nodes[closest].pos.x, y: a.y - nodes[closest].pos.y });
          const prev = pulls.get(closest) ?? { x: 0, y: 0 };
          pulls.set(closest, { x: prev.x + dir.x, y: prev.y + dir.y });
        }
      }
      if (!pulls.size) break;
      const added: [Pt, Pt][] = [];
      for (const [ni, pull] of pulls) {
        const dir = norm(pull);
        const np: Pt = { x: nodes[ni].pos.x + dir.x * step, y: nodes[ni].pos.y + dir.y * step };
        nodes.push({ pos: np, parent: ni });
        const seg: [Pt, Pt] = [nodes[ni].pos, np];
        segments.push(seg);
        added.push(seg);
      }
      // cumulative snapshot for growth playback
      growthSegments.push(segments.slice());
      void added;
    }

    const toPaths = (segs: [Pt, Pt][]): PathLayer[] => {
      // batch all segments into one stroked path
      const d = segs.map(([a, b]) => `M ${r2(a.x)} ${r2(a.y)} L ${r2(b.x)} ${r2(b.y)}`).join(" ");
      return d ? [path("branches", d, null, color, thickness)] : [];
    };

    const finalPaths = toPaths(segments);
    const g = group("dendrite", finalPaths, "dendrite", params);
    // growthSteps: cumulative path sets for the growthProgress reveal
    g.growthSteps = growthSegments
      .filter((_, i) => i % 3 === 0) // downsample to ~keyframes
      .map((segs) => toPaths(segs));
    if (g.growthSteps.length === 0) g.growthSteps = [finalPaths];
    return g;
  },
};

// ---------- botanical (L-system) ----------

const botanical: GeneratorDef = {
  key: "botanical",
  name: "botanical",
  recipeMatch: "botanical-lsystem",
  params: [
    { name: "grammar", label: "grammar", type: "select", options: ["fern", "branch", "stem"], default: "fern" },
    { name: "iterations", label: "iterations", type: "number", min: 2, max: 6, step: 1, default: 4 },
    { name: "angle", label: "angle", type: "number", min: 10, max: 40, step: 1, default: 22 },
    { name: "thickness", label: "thickness", type: "number", min: 0.5, max: 5, step: 0.5, default: 2 },
    { name: "color", label: "color", type: "color", default: "#1b3a5c" },
    seedParam,
  ],
  generate(params) {
    const grammar = str(params, "grammar", "fern");
    const iterations = Math.round(num(params, "iterations", 4));
    const angle = (num(params, "angle", 22) * Math.PI) / 180;
    const thickness = num(params, "thickness", 2);
    const color = str(params, "color", "#1b3a5c");

    const rules: Record<string, Record<string, string>> = {
      fern: { X: "F+[[X]-X]-F[-FX]+X", F: "FF" },
      branch: { X: "F[+X]F[-X]+X", F: "FF" },
      stem: { X: "F[+X][-X]FX", F: "FF" },
    };
    const rule = rules[grammar] ?? rules.fern;
    let s = "X";
    for (let i = 0; i < iterations; i++) {
      s = s.split("").map((c) => rule[c] ?? c).join("");
    }
    // turtle
    const len = 6;
    let x = 300, y = 600, dir = -Math.PI / 2;
    const stack: [number, number, number][] = [];
    const segs: [Pt, Pt][] = [];
    for (const c of s) {
      if (c === "F") {
        const nx = x + Math.cos(dir) * len;
        const ny = y + Math.sin(dir) * len;
        segs.push([{ x, y }, { x: nx, y: ny }]);
        x = nx; y = ny;
      } else if (c === "+") dir += angle;
      else if (c === "-") dir -= angle;
      else if (c === "[") stack.push([x, y, dir]);
      else if (c === "]") { const st = stack.pop(); if (st) [x, y, dir] = st; }
    }
    // normalize to origin
    const xs = segs.flatMap((s) => [s[0].x, s[1].x]);
    const ys = segs.flatMap((s) => [s[0].y, s[1].y]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const d = segs
      .map(([a, b]) => `M ${r2(a.x - minX)} ${r2(a.y - minY)} L ${r2(b.x - minX)} ${r2(b.y - minY)}`)
      .join(" ");
    const layer = path("plant", d, null, color, thickness);
    const g = group("botanical", [layer], "botanical", params);
    return g;
  },
};

// ---------- scribble structure ----------

const scribble: GeneratorDef = {
  key: "scribble",
  name: "scribble",
  params: [
    { name: "complexity", label: "complexity", type: "number", min: 10, max: 120, step: 5, default: 40 },
    { name: "annotationDensity", label: "annotations", type: "number", min: 0, max: 1, step: 0.05, default: 0.3 },
    { name: "weight", label: "weight", type: "number", min: 0.5, max: 4, step: 0.5, default: 1 },
    { name: "color", label: "color", type: "color", default: "#0a0a0a" },
    seedParam,
  ],
  generate(params) {
    const rand = mulberry32(num(params, "seed", 1));
    const steps = Math.round(num(params, "complexity", 40));
    const annot = num(params, "annotationDensity", 0.3);
    const weight = num(params, "weight", 1);
    const color = str(params, "color", "#0a0a0a");
    const pts: Pt[] = [{ x: 200, y: 200 }];
    for (let i = 0; i < steps; i++) {
      const last = pts[pts.length - 1];
      pts.push({ x: clamp(last.x + (rand() - 0.5) * 90, 0, 400), y: clamp(last.y + (rand() - 0.5) * 90, 0, 400) });
    }
    const children: Layer[] = [path("scribble", catmullRomOpen(pts), null, color, weight)];
    // construction annotations along the path
    for (const p of pts) {
      if (rand() > annot) continue;
      const mark = rand();
      if (mark < 0.4) children.push(path("tick", `M ${r2(p.x - 4)} ${r2(p.y)} L ${r2(p.x + 4)} ${r2(p.y)}`, null, color, weight));
      else if (mark < 0.7) children.push(path("circle", circle(p.x, p.y, 4), null, color, weight));
      else children.push(path("box", `M ${r2(p.x - 4)} ${r2(p.y - 4)} h 8 v 8 h -8 Z`, null, color, weight));
    }
    return group("scribble", children, "scribble", params);
  },
};

// ---------- contour / topo lines ----------

const contour: GeneratorDef = {
  key: "contour",
  name: "contour lines",
  params: [
    { name: "levels", label: "levels", type: "number", min: 3, max: 16, step: 1, default: 8 },
    { name: "scale", label: "scale", type: "number", min: 2, max: 16, step: 1, default: 6 },
    { name: "weight", label: "weight", type: "number", min: 0.5, max: 3, step: 0.5, default: 1 },
    { name: "color", label: "color", type: "color", default: "#1b3a5c" },
    seedParam,
  ],
  generate(params) {
    const levels = Math.round(num(params, "levels", 8));
    const scale = num(params, "scale", 6);
    const weight = num(params, "weight", 1);
    const color = str(params, "color", "#1b3a5c");
    const noise = makeNoise2D(num(params, "seed", 1));
    const size = 400;
    const cell = 8;
    const cols = size / cell;
    const children: Layer[] = [];
    for (let l = 1; l < levels; l++) {
      const iso = l / levels;
      const segs: string[] = [];
      for (let gy = 0; gy < cols; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const x = gx * cell;
          const y = gy * cell;
          const a = noise((gx / cols) * scale, (gy / cols) * scale);
          const b = noise(((gx + 1) / cols) * scale, (gy / cols) * scale);
          // marching-squares-lite: draw a short segment where the iso crosses
          if ((a - iso) * (b - iso) < 0) {
            segs.push(`M ${r2(x)} ${r2(y)} L ${r2(x + cell)} ${r2(y)}`);
          }
        }
      }
      if (segs.length) children.push(path(`level ${l}`, segs.join(" "), null, color, weight));
    }
    return group("contour", children, "contour", params);
  },
};

// ---------- flow field ----------

const flowfield: GeneratorDef = {
  key: "flowfield",
  name: "flow field",
  params: [
    { name: "count", label: "count", type: "number", min: 20, max: 300, step: 10, default: 120 },
    { name: "length", label: "length", type: "number", min: 10, max: 120, step: 5, default: 60 },
    { name: "curl", label: "curl", type: "number", min: 1, max: 12, step: 0.5, default: 5 },
    { name: "weight", label: "weight", type: "number", min: 0.5, max: 3, step: 0.5, default: 1 },
    { name: "color", label: "color", type: "color", default: "#2f4bff" },
    seedParam,
  ],
  generate(params) {
    const rand = mulberry32(num(params, "seed", 1));
    const count = Math.round(num(params, "count", 120));
    const length = num(params, "length", 60);
    const curl = num(params, "curl", 5);
    const weight = num(params, "weight", 1);
    const color = str(params, "color", "#2f4bff");
    const noise = makeNoise2D(num(params, "seed", 1));
    const size = 400;
    const children: Layer[] = [];
    const paths: string[] = [];
    for (let i = 0; i < count; i++) {
      let x = rand() * size;
      let y = rand() * size;
      const pts: Pt[] = [{ x, y }];
      for (let s = 0; s < length / 4; s++) {
        const a = noise((x / size) * curl, (y / size) * curl) * Math.PI * 4;
        x += Math.cos(a) * 4;
        y += Math.sin(a) * 4;
        pts.push({ x, y });
      }
      paths.push(catmullRomOpen(pts));
    }
    children.push(path("traces", paths.join(" "), null, color, weight));
    return group("flow field", children, "flowfield", params);
  },
};

// ---------- annotation marks ----------

const annotation: GeneratorDef = {
  key: "annotation",
  name: "annotation marks",
  params: [
    { name: "mark", label: "mark", type: "select", options: ["crosshair", "circle", "corner", "plus"], default: "crosshair" },
    { name: "size", label: "size", type: "number", min: 6, max: 40, step: 1, default: 14 },
    { name: "color", label: "color", type: "color", default: "#0a0a0a" },
  ],
  generate(params) {
    const mark = str(params, "mark", "crosshair");
    const s = num(params, "size", 14);
    const color = str(params, "color", "#0a0a0a");
    let d = "";
    if (mark === "crosshair") d = `M ${-s} 0 L ${s} 0 M 0 ${-s} L 0 ${s} ${circle(0, 0, s * 0.4)}`;
    else if (mark === "circle") d = circle(0, 0, s);
    else if (mark === "corner") d = `M ${-s} ${-s + 6} L ${-s} ${-s} L ${-s + 6} ${-s} M ${s} ${s - 6} L ${s} ${s} L ${s - 6} ${s}`;
    else d = `M ${-s} 0 L ${s} 0 M 0 ${-s} L 0 ${s}`;
    return group("annotation", [path("mark", d, null, color, 1)], "annotation", params);
  },
};

// ---------- grids (§12.2) ----------

const modularGrid: GeneratorDef = {
  key: "grid",
  name: "modular grid",
  params: [
    { name: "columns", label: "columns", type: "number", min: 1, max: 24, step: 1, default: 6 },
    { name: "rows", label: "rows", type: "number", min: 1, max: 24, step: 1, default: 8 },
    { name: "gutter", label: "gutter", type: "number", min: 0, max: 40, step: 1, default: 12 },
    { name: "margin", label: "margin", type: "number", min: 0, max: 120, step: 2, default: 40 },
    { name: "width", label: "width", type: "number", min: 200, max: 1200, step: 10, default: 600 },
    { name: "height", label: "height", type: "number", min: 200, max: 1600, step: 10, default: 800 },
  ],
  generate(params) {
    const cols = Math.round(num(params, "columns", 6));
    const rows = Math.round(num(params, "rows", 8));
    const gutter = num(params, "gutter", 12);
    const margin = num(params, "margin", 40);
    const W = num(params, "width", 600);
    const H = num(params, "height", 800);
    const cw = (W - margin * 2 - gutter * (cols - 1)) / cols;
    const ch = (H - margin * 2 - gutter * (rows - 1)) / rows;
    const segs: string[] = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = margin + c * (cw + gutter);
        const y = margin + r * (ch + gutter);
        segs.push(`M ${r2(x)} ${r2(y)} h ${r2(cw)} v ${r2(ch)} h ${r2(-cw)} Z`);
      }
    }
    const layer = path("grid", segs.join(" "), null, "rgba(10,10,10,0.35)", 0.5);
    return group("modular grid", [layer], "grid", params, { locked: true });
  },
};

const dotGrid: GeneratorDef = {
  key: "dotgrid",
  name: "dot grid",
  params: [
    { name: "spacing", label: "spacing", type: "number", min: 8, max: 80, step: 2, default: 24 },
    { name: "width", label: "width", type: "number", min: 200, max: 1200, step: 10, default: 600 },
    { name: "height", label: "height", type: "number", min: 200, max: 1600, step: 10, default: 800 },
    { name: "color", label: "color", type: "color", default: "#0a0a0a" },
  ],
  generate(params) {
    const sp = num(params, "spacing", 24);
    const W = num(params, "width", 600);
    const H = num(params, "height", 800);
    const color = str(params, "color", "#0a0a0a");
    const subs: string[] = [];
    for (let y = sp; y < H; y += sp) for (let x = sp; x < W; x += sp) subs.push(circle(x, y, 0.8));
    return group("dot grid", [path("dots", subs.join(" "), color)], "dotgrid", params, { locked: true });
  },
};

// ---------- helpers ----------

function circle(cx: number, cy: number, r: number): string {
  return `M ${r2(cx - r)} ${r2(cy)} a ${r2(r)} ${r2(r)} 0 1 0 ${r2(r * 2)} 0 a ${r2(r)} ${r2(r)} 0 1 0 ${r2(-r * 2)} 0 Z`;
}
function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function norm(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export const GENERATORS: GeneratorDef[] = [
  wash,
  splatter,
  brush,
  dendrite,
  botanical,
  scribble,
  contour,
  flowfield,
  annotation,
  modularGrid,
  dotGrid,
];

export function getGenerator(key: string): GeneratorDef | undefined {
  return GENERATORS.find((g) => g.key === key);
}
