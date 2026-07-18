import { describe, expect, it } from "vitest";
import {
  catmullRomClosed,
  catmullRomOpen,
  makeNoise2D,
  mulberry32,
  round2,
  type Pt,
} from "./geometry";

const square: Pt[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("diverges for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });

  it("stays within [0, 1)", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("catmullRomClosed", () => {
  it("returns empty for fewer than 3 points", () => {
    expect(catmullRomClosed([])).toBe("");
    expect(catmullRomClosed([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe("");
  });

  it("produces a closed cubic path", () => {
    const d = catmullRomClosed(square);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
    expect(d).toContain(" C ");
  });

  it("is deterministic", () => {
    expect(catmullRomClosed(square)).toBe(catmullRomClosed(square));
  });
});

describe("catmullRomOpen", () => {
  it("returns empty for fewer than 2 points", () => {
    expect(catmullRomOpen([])).toBe("");
    expect(catmullRomOpen([{ x: 0, y: 0 }])).toBe("");
  });

  it("draws a straight line for exactly 2 points", () => {
    const d = catmullRomOpen([{ x: 0, y: 0 }, { x: 4, y: 6 }]);
    expect(d).toBe("M 0 0 L 4 6");
  });

  it("produces an open cubic path (no Z) for 3+ points", () => {
    const d = catmullRomOpen(square);
    expect(d.startsWith("M ")).toBe(true);
    expect(d).toContain(" C ");
    expect(d.endsWith("Z")).toBe(false);
  });
});

describe("makeNoise2D", () => {
  it("is deterministic for a given seed and coordinate", () => {
    const n1 = makeNoise2D(99);
    const n2 = makeNoise2D(99);
    expect(n1(3.5, 7.25)).toBe(n2(3.5, 7.25));
  });

  it("returns values within the table range [0, 1]", () => {
    const noise = makeNoise2D(5);
    for (let x = 0; x < 20; x += 2.5) {
      for (let y = 0; y < 20; y += 2.5) {
        const v = noise(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("round2", () => {
  it("rounds to two decimal places", () => {
    expect(round2(1.239)).toBe(1.24);
    expect(round2(1)).toBe(1);
    expect(round2(2.567)).toBe(2.57);
  });
});
