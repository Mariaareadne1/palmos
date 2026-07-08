/**
 * Shared deterministic geometry helpers for the design-kit generators
 * (SPEC2 §12). All randomness flows through a seeded PRNG so a generator
 * with the same params + seed always yields the same paths — required
 * for regenerable generator metadata and the golden tests.
 */

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pt {
  x: number;
  y: number;
}

const f = (n: number) => Math.round(n * 100) / 100;

/** Closed Catmull-Rom spline through points → smooth SVG cubic path. */
export function catmullRomClosed(points: Pt[]): string {
  const n = points.length;
  if (n < 3) return "";
  const p = (i: number) => points[((i % n) + n) % n];
  let d = `M ${f(p(0).x)} ${f(p(0).y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d + " Z";
}

/** Open Catmull-Rom spline (for strokes / brush spines). */
export function catmullRomOpen(points: Pt[]): string {
  const n = points.length;
  if (n < 2) return "";
  if (n === 2) return `M ${f(points[0].x)} ${f(points[0].y)} L ${f(points[1].x)} ${f(points[1].y)}`;
  const p = (i: number) => points[Math.max(0, Math.min(n - 1, i))];
  let d = `M ${f(p(0).x)} ${f(p(0).y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** value-noise 2D (deterministic, for flow/contour fields). */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  const rand = mulberry32(seed);
  const table = Array.from({ length: 256 }, () => rand());
  const hash = (x: number, y: number) =>
    table[(Math.abs(Math.floor(x) * 73856093 + Math.floor(y) * 19349663)) % 256];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return (
      a * (1 - u) * (1 - v) +
      b * u * (1 - v) +
      c * (1 - u) * v +
      d * u * v
    );
  };
}

export const round2 = f;
