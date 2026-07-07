/**
 * Seeded PRNG (mulberry32). Every bake effect must be deterministic
 * given its seed (SPEC2 §10, §12.5) so the golden tests in Step 13
 * reproduce exactly. Never use Math.random in a bake path.
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
