/**
 * Board-matched palettes and paper grounds (SPEC2 §12.3). The ground
 * color does half the work in this aesthetic, so grounds ship as
 * one-click presets alongside the swatch palettes.
 */
export interface NamedPalette {
  name: string;
  colors: string[];
}

export const SHIPPED_PALETTES: NamedPalette[] = [
  { name: "ink & paper", colors: ["#0b3d91", "#1b1b3a", "#f5efe0", "#fdfdfc"] },
  { name: "soft focus", colors: ["#f6b8dc", "#c3b8f6", "#b8d4f6", "#ffffff"] },
  { name: "riso bloom", colors: ["#e0218a", "#6b3fa0", "#2f4bff", "#f5efe0"] },
  { name: "poster heat", colors: ["#e63946", "#f4a261", "#0a0a0a", "#f5efe0"] },
];

export const PAPER_GROUNDS: { name: string; color: string }[] = [
  { name: "warm paper", color: "#f5efe0" },
  { name: "cool white", color: "#fdfdfc" },
  { name: "deep ink navy", color: "#0f1830" },
];

/** Harmonize: rotate hues of unlocked swatches to even spacing around
 *  the first locked (or first) swatch, preserving its hue. */
export function harmonize(colors: string[], locked: boolean[]): string[] {
  const anchorIdx = locked.findIndex(Boolean);
  const anchor = colors[anchorIdx >= 0 ? anchorIdx : 0];
  const { h: baseH, s, l } = rgbToHsl(hexToRgb(anchor));
  const n = colors.length;
  return colors.map((c, i) => {
    if (locked[i]) return c;
    const hue = (baseH + (360 / n) * i) % 360;
    const src = rgbToHsl(hexToRgb(c));
    return hslToHex(hue, Math.max(s, src.s * 0.8), src.l || l);
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
function rgbToHsl([r, g, b]: [number, number, number]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
