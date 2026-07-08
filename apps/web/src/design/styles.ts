import type { Style } from "@/types/scene";

/**
 * Shipped starter styles (SPEC2 §12.4): saved fill+stroke+effects combos
 * matched to the painterly art-tech board. Applied as one undoable
 * command; effect ids are re-scoped per target on apply. Effect `id`s
 * here are templates (applyStyle appends the layer id).
 */
export const SHIPPED_STYLES: Style[] = [
  {
    id: "ink-wash",
    name: "ink wash",
    fill: "#1b1b3a",
    stroke: null,
    strokeWidth: 0,
    effects: [
      { id: "glow", kind: "glow", enabled: true, params: { color: "#2f2f6a", intensity: 0.8, spread: 12, threshold: 0.2 } },
    ],
  },
  {
    id: "cyanotype",
    name: "cyanotype",
    fill: "#0b3d91",
    stroke: null,
    strokeWidth: 0,
    effects: [
      { id: "riso", kind: "riso", enabled: true, params: { inkColor: "#0b3d91", paperColor: "#f5efe0", misregistration: 5, grainAmount: 0.2, layers: 1 } },
    ],
  },
  {
    id: "riso-duotone",
    name: "riso duotone",
    fill: "#d7263d",
    stroke: null,
    strokeWidth: 0,
    effects: [
      { id: "riso", kind: "riso", enabled: true, params: { inkColor: "#e0218a", paperColor: "#f5efe0", misregistration: 8, grainAmount: 0.18, layers: 2 } },
    ],
  },
  {
    id: "soft-focus",
    name: "soft focus",
    fill: {
      type: "radial",
      stops: [
        { offset: 0, color: "#f6b8dc" },
        { offset: 1, color: "#b8c9f6" },
      ],
      angle: 0,
      cx: 0.5,
      cy: 0.5,
    },
    effects: [
      { id: "glow", kind: "glow", enabled: true, params: { color: "#f6b8dc", intensity: 1.6, spread: 14, threshold: 0.3 } },
      { id: "grain", kind: "grain", enabled: true, params: { amount: 0.15, size: 1.5, animated: false } },
    ],
  },
  {
    id: "pixel-collapse",
    name: "pixel collapse",
    fill: "#1b1b3a",
    stroke: null,
    strokeWidth: 0,
    effects: [
      { id: "pixelate", kind: "pixelate", enabled: true, params: { size: 14 } },
      { id: "dither", kind: "dither", enabled: true, params: { mode: "bayer4", threshold: 0.5, palette: "scene", pixelSize: 3 } },
    ],
  },
  {
    id: "liquid-chrome",
    name: "liquid chrome",
    fill: {
      type: "linear",
      stops: [
        { offset: 0, color: "#e6e6ea" },
        { offset: 0.4, color: "#8a8a99" },
        { offset: 0.5, color: "#f4f4f8" },
        { offset: 0.6, color: "#5a5a6e" },
        { offset: 1, color: "#c8c8d4" },
      ],
      angle: 120,
      cx: 0.5,
      cy: 0.5,
    },
    effects: [
      { id: "displace", kind: "displace", enabled: true, params: { amount: 14, scale: 0.01, speed: 0.4, mode: "simplex" } },
    ],
  },
];
