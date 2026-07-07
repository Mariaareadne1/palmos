import { registerEffect, type ParamDef } from "./registry";

/**
 * Bake effect definitions (SPEC2 §10). Params only — the deterministic
 * implementations live in bake/implementations.ts and run in the worker
 * pool. Output is editable vector layers (or ImageLayers for the two
 * inherently-raster effects: scatter, pixelSort).
 */

const seed: ParamDef = {
  name: "seed",
  label: "seed",
  type: "number",
  min: 0,
  max: 9999,
  step: 1,
  default: 1,
};

registerEffect({
  kind: "halftone",
  name: "halftone",
  class: "bake",
  params: [
    { name: "gridType", label: "grid", type: "select", options: ["regular", "benday", "stagger"], default: "regular" },
    { name: "angle", label: "angle", type: "number", min: 0, max: 90, step: 1, default: 15 },
    { name: "cellSize", label: "cell", type: "number", min: 4, max: 40, step: 1, default: 10 },
    { name: "dotMin", label: "dot min", type: "number", min: 0, max: 1, step: 0.01, default: 0 },
    { name: "dotMax", label: "dot max", type: "number", min: 0, max: 1.5, step: 0.01, default: 1 },
    { name: "shape", label: "shape", type: "select", options: ["circle", "square", "line"], default: "circle" },
  ],
});

registerEffect({
  kind: "stipple",
  name: "stipple",
  class: "bake",
  params: [
    { name: "density", label: "density", type: "number", min: 0.001, max: 0.1, step: 0.001, default: 0.02 },
    { name: "dotSize", label: "dot size", type: "number", min: 0.5, max: 6, step: 0.5, default: 1.5 },
    seed,
  ],
});

registerEffect({
  kind: "edgeTrace",
  name: "edge trace",
  class: "bake",
  params: [
    { name: "threshold", label: "threshold", type: "number", min: 0.02, max: 0.8, step: 0.01, default: 0.2 },
    { name: "simplify", label: "simplify", type: "number", min: 0, max: 5, step: 0.5, default: 1.5 },
  ],
});

registerEffect({
  kind: "asciiGrid",
  name: "ascii grid",
  class: "bake",
  params: [
    { name: "cellSize", label: "cell", type: "number", min: 6, max: 40, step: 1, default: 14 },
    { name: "charset", label: "charset", type: "select", options: ["blocks", "ascii", "dots"], default: "ascii" },
    { name: "font", label: "font", type: "select", options: ["Space Mono", "JetBrains Mono"], default: "Space Mono" },
  ],
});

registerEffect({
  kind: "patternFill",
  name: "pattern fill",
  class: "bake",
  params: [
    { name: "pattern", label: "pattern", type: "select", options: ["lines", "waves", "checker", "contour", "crosshatch"], default: "lines" },
    { name: "spacing", label: "spacing", type: "number", min: 3, max: 30, step: 1, default: 8 },
    { name: "angle", label: "angle", type: "number", min: 0, max: 180, step: 1, default: 45 },
    { name: "weight", label: "weight", type: "number", min: 0.5, max: 6, step: 0.5, default: 1 },
  ],
});

registerEffect({
  kind: "ditherBake",
  name: "dither (bake)",
  class: "bake",
  params: [
    { name: "palette", label: "palette", type: "select", options: ["bw", "scene"], default: "bw" },
    { name: "pixelSize", label: "pixel", type: "number", min: 1, max: 12, step: 1, default: 3 },
  ],
});

registerEffect({
  kind: "scatter",
  name: "scatter",
  class: "bake",
  params: [
    { name: "tileSize", label: "tile", type: "number", min: 8, max: 120, step: 2, default: 40 },
    { name: "jitter", label: "jitter", type: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: "rotationJitter", label: "rot jitter", type: "number", min: 0, max: 180, step: 1, default: 0 },
    seed,
  ],
});

registerEffect({
  kind: "cellularAutomata",
  name: "cellular automata",
  class: "bake",
  params: [
    { name: "rule", label: "rule", type: "select", options: ["life", "maze", "coral"], default: "life" },
    { name: "steps", label: "steps", type: "number", min: 1, max: 30, step: 1, default: 6 },
    { name: "cellSize", label: "cell", type: "number", min: 2, max: 24, step: 1, default: 8 },
    { name: "seedFromImage", label: "seed img", type: "boolean", default: true },
    seed,
  ],
});

registerEffect({
  kind: "pixelSort",
  name: "pixel sort",
  class: "bake",
  params: [
    { name: "threshold", label: "threshold", type: "number", min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: "direction", label: "direction", type: "select", options: ["horizontal", "vertical"], default: "horizontal" },
    { name: "mode", label: "mode", type: "select", options: ["luminance", "hue"], default: "luminance" },
    { name: "intervalJitter", label: "jitter", type: "number", min: 0, max: 1, step: 0.01, default: 0.2 },
    seed,
  ],
});
