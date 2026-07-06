import type { Layer, SceneGraph, Transform } from "@/types/scene";

/**
 * Scene graph → standalone SVG. Straightforward because paths already
 * carry SVG `d` strings; transforms map 1:1 (translate → rotate → scale,
 * Konva's application order).
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

function layerToSvg(layer: Layer): string {
  if (!layer.visible) return "";
  const common = `${transformAttr(layer.transform)}${
    layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : ""
  }`;
  switch (layer.type) {
    case "path": {
      const fill = layer.fill ? ` fill="${esc(layer.fill)}"` : ` fill="none"`;
      const stroke = layer.stroke
        ? ` stroke="${esc(layer.stroke)}" stroke-width="${layer.strokeWidth}"`
        : "";
      return `<path d="${esc(layer.d)}"${fill}${stroke}${common}/>`;
    }
    case "text": {
      const anchor =
        layer.align === "center"
          ? "middle"
          : layer.align === "right"
            ? "end"
            : "start";
      // dominant-baseline hanging ≈ Konva's top-aligned text origin.
      return `<text font-family="${esc(layer.fontFamily)}" font-size="${
        layer.fontSize
      }" font-weight="${layer.fontWeight}" fill="${esc(layer.fill)}" text-anchor="${anchor}" dominant-baseline="hanging"${common}>${esc(
        layer.text,
      )}</text>`;
    }
    case "image":
      return `<image href="${esc(layer.src)}" width="${layer.width}" height="${
        layer.height
      }"${common}/>`;
    case "group":
      return `<g${common}>${layer.children.map(layerToSvg).join("")}</g>`;
  }
}

export function sceneToSvg(scene: SceneGraph): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
    `<rect width="${scene.width}" height="${scene.height}" fill="${esc(scene.background)}"/>`,
    ...scene.layers.map(layerToSvg),
    `</svg>`,
  ].join("\n");
}
