import type { Fill, GradientFill } from "@/types/scene";

/** Fill helpers shared by the konva editor, pixi renderer, and SVG export. */

export function isGradientFill(fill: Fill): fill is GradientFill {
  return typeof fill === "object" && fill !== null && "stops" in fill;
}

/** Representative solid color (layer chips, fallbacks, SVG conic). */
export function fillFallbackColor(fill: Fill): string | null {
  if (fill === null) return null;
  if (typeof fill === "string") return fill;
  return fill.stops[0]?.color ?? "#000000";
}

/**
 * Rasterize a gradient to a canvas — used for conic fills (no native
 * support in konva/pixi/svg: "conic may bake to texture — acceptable",
 * SPEC2 §12.3) and for pixi texture fills.
 */
export function gradientToCanvas(
  g: GradientFill,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.ceil(width));
  canvas.height = Math.max(2, Math.ceil(height));
  const ctx = canvas.getContext("2d")!;
  let grad: CanvasGradient;
  if (g.type === "linear") {
    const rad = (g.angle * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.sqrt(width * width + height * height) / 2;
    grad = ctx.createLinearGradient(
      cx - Math.cos(rad) * r,
      cy - Math.sin(rad) * r,
      cx + Math.cos(rad) * r,
      cy + Math.sin(rad) * r,
    );
  } else if (g.type === "radial") {
    const cx = g.cx * width;
    const cy = g.cy * height;
    const r = Math.max(width, height);
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  } else {
    grad = ctx.createConicGradient(
      (g.angle * Math.PI) / 180,
      g.cx * width,
      g.cy * height,
    );
  }
  for (const stop of g.stops) {
    grad.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Konva fill props for a fill within a node's self rect. Linear/radial
 * use konva's native gradient props; conic bakes to a pattern canvas.
 */
export function konvaFillProps(
  fill: Fill,
  rect: Rect,
): Record<string, unknown> {
  if (fill === null) return { fill: undefined };
  if (typeof fill === "string") return { fill };
  const g = fill;
  const stops: (number | string)[] = [];
  for (const s of g.stops) stops.push(s.offset, s.color);
  if (g.type === "linear") {
    const rad = (g.angle * Math.PI) / 180;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const r = Math.sqrt(rect.width ** 2 + rect.height ** 2) / 2;
    return {
      fillPriority: "linear-gradient",
      fillLinearGradientStartPoint: {
        x: cx - Math.cos(rad) * r,
        y: cy - Math.sin(rad) * r,
      },
      fillLinearGradientEndPoint: {
        x: cx + Math.cos(rad) * r,
        y: cy + Math.sin(rad) * r,
      },
      fillLinearGradientColorStops: stops,
    };
  }
  if (g.type === "radial") {
    const cx = rect.x + g.cx * rect.width;
    const cy = rect.y + g.cy * rect.height;
    return {
      fillPriority: "radial-gradient",
      fillRadialGradientStartPoint: { x: cx, y: cy },
      fillRadialGradientEndPoint: { x: cx, y: cy },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: Math.max(rect.width, rect.height),
      fillRadialGradientColorStops: stops,
    };
  }
  // conic → baked pattern
  const canvas = gradientToCanvas(g, rect.width, rect.height);
  return {
    fillPriority: "pattern",
    fillPatternImage: canvas,
    fillPatternOffset: { x: -rect.x, y: -rect.y },
    fillPatternRepeat: "no-repeat",
  };
}

/**
 * SVG export: linear/radial become real <defs> gradients; conic falls
 * back to the first stop (documented limitation).
 */
export function fillToSvg(
  fill: Fill,
  defId: string,
): { defs: string; attr: string } {
  if (fill === null) return { defs: "", attr: ` fill="none"` };
  if (typeof fill === "string") return { defs: "", attr: ` fill="${fill}"` };
  const g = fill;
  if (g.type === "conic") {
    return { defs: "", attr: ` fill="${fillFallbackColor(g)}"` };
  }
  const stops = g.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`)
    .join("");
  if (g.type === "linear") {
    const rad = (g.angle * Math.PI) / 180;
    const x1 = 0.5 - Math.cos(rad) / 2;
    const y1 = 0.5 - Math.sin(rad) / 2;
    const x2 = 0.5 + Math.cos(rad) / 2;
    const y2 = 0.5 + Math.sin(rad) / 2;
    return {
      defs: `<linearGradient id="${defId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
      attr: ` fill="url(#${defId})"`,
    };
  }
  return {
    defs: `<radialGradient id="${defId}" cx="${g.cx}" cy="${g.cy}" r="0.75">${stops}</radialGradient>`,
    attr: ` fill="url(#${defId})"`,
  };
}
