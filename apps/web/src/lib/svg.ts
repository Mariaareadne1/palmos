import type { Layer, SceneGraph, Transform } from "@/types/scene";
import { fillToSvg } from "@/lib/fill";

/**
 * Scene graph → standalone SVG. Straightforward because paths already
 * carry SVG `d` strings; transforms map 1:1 (translate → rotate → scale,
 * Konva's application order). Gradient fills emit <defs>; conic falls
 * back to its first stop (no SVG conic support).
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transformAttr(t: Transform): string {
  const parts: string[] = [];
  if (t.x !== 0 || t.y !== 0) parts.push(`translate(${t.x} ${t.y})`);
  if (t.rotation !== 0) parts.push(`rotate(${t.rotation})`);
  if (t.scaleX !== 1 || t.scaleY !== 1) parts.push(`scale(${t.scaleX} ${t.scaleY})`);
  return parts.length ? ` transform="${parts.join(" ")}"` : "";
}

function layerToSvg(layer: Layer, defs: string[]): string {
  if (!layer.visible) return "";
  const common = `${transformAttr(layer.transform)}${
    layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : ""
  }`;
  switch (layer.type) {
    case "path": {
      const f = fillToSvg(layer.fill, `grad-${layer.id}`);
      if (f.defs) defs.push(f.defs);
      const stroke = layer.stroke
        ? ` stroke="${esc(layer.stroke)}" stroke-width="${layer.strokeWidth}"`
        : "";
      return `<path d="${esc(layer.d)}"${f.attr}${stroke}${common}/>`;
    }
    case "text": {
      const anchor =
        layer.align === "center"
          ? "middle"
          : layer.align === "right"
            ? "end"
            : "start";
      const f = fillToSvg(layer.fill, `grad-${layer.id}`);
      if (f.defs) defs.push(f.defs);
      const spacing =
        layer.letterSpacing !== 0
          ? ` letter-spacing="${layer.letterSpacing}"`
          : "";
      const strokeOnly = layer.strokeOnly
        ? ` stroke="${esc(fillFallback(layer))}" fill="none"`
        : f.attr;
      // dominant-baseline hanging ≈ Konva's top-aligned text origin.
      return `<text font-family="${esc(layer.fontFamily)}" font-size="${
        layer.fontSize
      }" font-weight="${layer.fontWeight}"${strokeOnly}${spacing} text-anchor="${anchor}" dominant-baseline="hanging"${common}>${esc(
        layer.text,
      )}</text>`;
    }
    case "image":
      return `<image href="${esc(layer.src)}" width="${layer.width}" height="${
        layer.height
      }"${common}/>`;
    case "group":
      return `<g${common}>${layer.children
        .map((c) => layerToSvg(c, defs))
        .join("")}</g>`;
    case "shader":
      // GPU-only layer — no vector representation; export as a placeholder rect
      return `<rect width="${layer.width}" height="${layer.height}" fill="none"${common}/>`;
  }
}

function fillFallback(layer: { fill: import("@/types/scene").Fill }): string {
  const f = layer.fill;
  if (typeof f === "string") return f;
  if (f && "stops" in f) return f.stops[0]?.color ?? "#000000";
  return "#000000";
}

export function sceneToSvg(scene: SceneGraph): string {
  const defs: string[] = [];
  const body = scene.layers.map((l) => layerToSvg(l, defs)).join("\n");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    `<rect width="${scene.width}" height="${scene.height}" fill="${esc(scene.background)}"/>`,
    body,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n");
}
