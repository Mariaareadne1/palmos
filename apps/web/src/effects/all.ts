/**
 * Import side-effect: registers the full effect suite. Step 9 ships the
 * two foundational effects (they self-register in registry.ts); Steps 10
 * and 11 add their modules here so the registry — and therefore every
 * auto-generated UI, the warmup pass, and the mod-target lists — grows
 * without touching call sites.
 */
import "./registry"; // invert + posterizeTrace (foundational)
import "./gpu"; // dither, pixelate, crt, displace, distort, recolorMap, grain, glow, levels, scanSlice, riso
import "./bake"; // halftone, stipple, edgeTrace, asciiGrid, patternFill, ditherBake, scatter, cellularAutomata, pixelSort
import "./post"; // bloom, feedback, chromaticAberration, kaleido, noiseWarp, vignette
