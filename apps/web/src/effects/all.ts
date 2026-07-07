/**
 * Import side-effect: registers the full effect suite. Step 9 ships the
 * two foundational effects (they self-register in registry.ts); Steps 10
 * and 11 add their modules here so the registry — and therefore every
 * auto-generated UI, the warmup pass, and the mod-target lists — grows
 * without touching call sites.
 */
import "./registry"; // invert + posterizeTrace (foundational)
// Step 10: import "./gpu";   import "./bake";
// Step 11: import "./post";  (custom shader layer is its own type)
