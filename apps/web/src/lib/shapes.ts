import { nanoid } from "nanoid";
import type { PathLayer, TextLayer } from "@/types/scene";

/**
 * Creation tools emit PathLayers with generated `d` strings so everything
 * downstream (SVG export, perform renderer, reconstruction output) speaks
 * one vector language.
 */

export function rectPath(w: number, h: number): string {
  return `M 0 0 H ${w} V ${h} H 0 Z`;
}

/** Ellipse as two arcs, origin at the bounding box top-left. */
export function ellipsePath(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M 0 ${ry} A ${rx} ${ry} 0 1 0 ${w} ${ry} A ${rx} ${ry} 0 1 0 0 ${ry} Z`;
}

export function createShapeLayer(
  kind: "rect" | "ellipse",
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  name: string,
): PathLayer {
  return {
    id: nanoid(),
    name,
    type: "path",
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    d: kind === "rect" ? rectPath(w, h) : ellipsePath(w, h),
    fill,
    stroke: null,
    strokeWidth: 0,
  };
}

export function createTextLayer(x: number, y: number, fill: string): TextLayer {
  return {
    id: nanoid(),
    name: "text",
    type: "text",
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    text: "text",
    fontFamily: "Space Mono",
    fontSize: 32,
    fontWeight: 400,
    fill,
    align: "left",
  };
}
