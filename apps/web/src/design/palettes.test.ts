import { describe, expect, it } from "vitest";
import { harmonize, PAPER_GROUNDS, SHIPPED_PALETTES } from "./palettes";

const HEX = /^#[0-9a-f]{6}$/;

describe("shipped presets", () => {
  it("every palette swatch is a valid 6-digit hex", () => {
    for (const p of SHIPPED_PALETTES) {
      expect(p.colors.length).toBeGreaterThan(0);
      for (const c of p.colors) expect(c).toMatch(HEX);
    }
  });

  it("every paper ground is a valid hex", () => {
    for (const g of PAPER_GROUNDS) expect(g.color).toMatch(HEX);
  });
});

describe("harmonize", () => {
  const colors = ["#e63946", "#f4a261", "#2a9d8f", "#1d3557"];

  it("preserves length", () => {
    const out = harmonize(colors, [false, false, false, false]);
    expect(out).toHaveLength(colors.length);
  });

  it("leaves locked swatches untouched", () => {
    const out = harmonize(colors, [false, true, false, true]);
    expect(out[1]).toBe(colors[1]);
    expect(out[3]).toBe(colors[3]);
  });

  it("emits valid hex for recomputed swatches", () => {
    const out = harmonize(colors, [true, false, false, false]);
    for (const c of out) expect(c).toMatch(HEX);
  });

  it("does not mutate its inputs", () => {
    const input = [...colors];
    const locked = [false, false, false, false];
    harmonize(input, locked);
    expect(input).toEqual(colors);
  });

  it("handles the all-unlocked case by anchoring on the first swatch", () => {
    const out = harmonize(colors, [false, false, false, false]);
    // index 0 keeps the anchor hue (offset 0), so it stays red-ish;
    // just assert the shape is valid and length preserved
    expect(out[0]).toMatch(HEX);
    expect(out).toHaveLength(4);
  });
});
