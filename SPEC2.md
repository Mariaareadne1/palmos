# SPEC 2 — palmós phase two: effects, shaders, and the design kit

Extends the app built by SPEC.md with three capabilities: (A) a tooooools-class image-effect suite where every parameter is audio-modulatable, (B) a GPU shader/post-FX layer for TouchDesigner-adjacent perform visuals, and (C) a techy brand-identity design kit (generative glyphs, grids, glow, gradients, patterns) matching a specific aesthetic defined in Step 12.

---

## 0. How to execute

**Do not begin until every acceptance criterion in SPEC.md section 6 passes.** All hard rules from SPEC.md section 0 apply verbatim here — especially: commit per step as the user with zero AI attribution (messages in section 14 below), everything runs with no credentials/optional deps, the scene graph remains the single source of truth, and the white/hairline/graph-paper UI direction from SPEC.md Step 1 governs all new chrome. Steps here are numbered 9–13, continuing SPEC.md's numbering.

**A clarification on the "no gradients" UI rule from SPEC.md:** that rule governs the tool's chrome, which stays black-on-white. Gradients, glow, and texture built in this spec are *artwork features* — things users create on the canvas — and are not only allowed but the point.

Skills to invoke: `performance-profiler` during Step 9 (resource lifecycle) and Step 13 (frame budget); `chaos-engineering` if available, applied to the 15-minute stress loop in 12.5; `pr-review-expert` + `ship-gate` at the end of Step 13. Read `frontend-design` guidance if available before building the effects browser UI in Step 10.

Milestone checkpoints (print status + how to verify): after Steps 9 (include the 12.5 resource-lifecycle checks here, not deferred to the end), 10, 11, and 12.

---

## 9. Effects architecture (foundation — build first, everything else hangs on it)

### 9.1 Schema (bump `SceneGraph.version` to 2; write a v1→v2 migration that adds empty fields)

Add to `scene.ts`:

```typescript
export interface Effect {
  id: string;
  kind: string;                    // registry key, e.g. "halftone", "crt", "glow"
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

// BaseLayer gains:  effects: Effect[];        (applied bottom-to-top)
// SceneGraph gains: postEffects: Effect[];    (document-level, perform-mode post-processing)
//                   version: 2;

// Fill model extension on PathLayer and TextLayer:
export interface GradientStop { offset: number; color: string; }
export interface GradientFill {
  type: "linear" | "radial" | "conic";
  stops: GradientStop[];          // 2–8 stops
  angle: number;                  // linear/conic, degrees
  cx: number; cy: number;         // radial/conic center, 0–1 relative to layer bbox
}
// fill: string | GradientFill | null
```

Mod matrix extension: `ModTarget` becomes `string`, accepting the existing seven targets **plus** `"effect:{effectId}:{paramName}"` for any numeric effect param, and `"post:{effectId}:{paramName}"` for document post-FX. The motion tab's target dropdown lists them grouped: transform / style / effects / post. Amount scaling for effect params: each param declares `min`, `max` in its registry definition; |amount|=1 sweeps ±40% of that range around the base value (clamped).

### 9.2 Effect registry & two execution classes

A single registry (`src/effects/registry.ts`) where each effect declares: `kind`, display name, param definitions (`{ name, label, type: "number"|"color"|"select"|"boolean", min, max, step, default, options? }`), execution class, and its implementation. The inspector auto-generates effect UI from param definitions — no hand-built panels per effect.

Two execution classes:

1. **GPU effects** (`gpu`): implemented once as GLSL fragment shaders wrapped in PixiJS `Filter`s. Used by both modes via a shared `EffectRenderer` module: an offscreen PixiJS renderer that composites any layer having `effects.length > 0` (or any postEffects) to a texture. In **edit mode**, Konva displays that composited texture as the layer's image (re-render on param change, debounced 60ms — near-live preview, editing interactions like drag/select still hit the vector layer underneath). In **perform mode**, the same filters run live at 60fps in the main Pixi stage. One shader source per effect, two hosts, zero drift.
2. **Bake effects** (`bake`): algorithms that *generate vector geometry* from a source layer (image or rasterized vector). They run in a Web Worker (never block the UI), show a live low-res preview, and on **"bake to layers"** insert their output as real `PathLayer`s/`TextLayer`s in a group — fully editable, fully performable, consistent with the one-format principle. Baking never deletes the source layer; it toggles its visibility off.

The effects UI: a new **`effects` tab** in the right inspector (joining `properties` and `motion`) listing the selected layer's effect stack — add (searchable dropdown from registry), reorder (drag), enable/disable (checkbox), delete, and auto-generated param controls. Params that are modulated show a small pulse-dot indicator linking to the motion tab. Document `postEffects` get the same stack UI under a small toggle when nothing is selected.


### 9.3 Audio-reactive design language (do not treat this as a generic mod matrix — it needs curation)

The mod matrix from SPEC.md is powerful but blank-slate; for this aesthetic specifically, meaningful audio-reactivity is about **which feature drives which parameter**, not just that a routing exists. Build both the generic system (done) and this curated layer on top of it.

**Motion recipes.** A `MotionRecipe` is a named bundle of routings pre-tuned for a specific element or style: `{ id, name, routings: Omit<ModRouting, "id"|"layerId">[] }`. Ship a library (`src/audio/recipes.ts`) and surface it as a one-click **"auto-route"** button in the motion tab whenever the selected layer/group was created by a generator that has a matching recipe (matched via a `sourceGenerator` field stamped onto generator output groups). Applying a recipe creates real `ModRouting` entries the user can then hand-edit — it's a starting point, never a locked black box.

Ship these recipes, each chosen because it matches how the element visually wants to move:

| generator / style | recipe | why |
|---|---|---|
| soft wash / aura blob | scale ← rms (amount 0.4, smoothing 0.85), hue ← low (amount 0.3, smoothing 0.9), opacity ← mid (amount 0.2, smoothing 0.8) | breathing: slow, heavily smoothed swell rather than jitter — high smoothing is load-bearing here, this element should never look twitchy |
| ink splatter | scale ← onset (amount 0.6, smoothing 0.2, per-splat phase offset — see below), rotation ← onset (amount 0.15) | punchy, low-smoothed reaction to hits: it should look like it's being spattered anew on each transient |
| brush stroke | effect:displace:amount ← mid (amount 0.5, smoothing 0.6) | a living wobble along the stroke, not a position jump |
| dendrite / branching network | (bake-time, not mod-matrix — see "growth playback" below) | growth reads as *progression*, which a per-frame offset can't express |
| botanical (L-system) | scale ← rms (amount 0.15, smoothing 0.9), effect:glow:intensity ← high (amount 0.3) | a gentle sway + shimmer on cymbals/high content |
| riso effect (on any layer) | effect:riso:misregistration ← high (amount 0.5, smoothing 0.3) | the classic misprint-jitter-on-treble look |
| feedback post-fx | post:feedback:zoom ← rms (amount 0.5, smoothing 0.7), post:feedback:rotate ← mid (amount 0.3, smoothing 0.85) | the signature trail-tunnel breathing/rotating with the track |
| bloom post-fx | post:bloom:intensity ← onset (amount 0.4, smoothing 0.15) | flash-bloom on hits |

**Per-instance phase offset (new, small mod-matrix extension).** Add `phaseOffset: number` (0–1, default 0) to `ModRouting`. When a recipe is applied to a *group of repeated elements* (e.g. many ink splatters, or the batched paths from a bake effect), each instance gets a small deterministic phase offset derived from its index (`i / count`), applied as a delay on the EMA smoothing input. This is what prevents "everything pulses in flat unison" — instead a splatter cluster ripples. Implement as a lightweight time-shift on the smoothing function, not a separate audio path (respects the one-source-of-truth rule: still reads the same `FeatureFrame` history, just offset).

**Growth playback (dendrite / L-system / flow field — anything built by an iterative/recursive algorithm).** These generators already compute their shape as a sequence of steps (branches added one at a time, L-system iterations, particle traces extending). Store that sequence as `growthSteps: PathLayer[][]` metadata on the generated group at bake time (each entry = the cumulative path set at that step). A new `ModTarget` value `"growthProgress"` (0–1) scrubs through `growthSteps` by index, swapping which paths are visible — **not** a scale/opacity trick, an actual reveal. Recipe: `growthProgress ← rms` with **very heavy smoothing (0.95+)** and a **ratchet mode** (`invert: false` + a new routing flag `ratchet: boolean` meaning the value only increases, never un-reveals) so a dendrite grows across a performance and never un-grows mid-track. Document this as the one target where smoothing philosophy inverts: everywhere else fast smoothing = responsive, here slow + ratcheted = a satisfying one-way bloom across a set.

**Master audio-reactive controls (perform HUD addition):** alongside the existing master intensity slider, add **"reactivity focus"**, a single 4-way toggle — `calm` (multiplies all amounts ×0.5, doubles all smoothing), `pulse` (default, ×1), `chaos` (×1.5 amounts, halves smoothing on non-ratcheted routings), `strobe` (onset-routed targets only, everything else ×0.2). This is the single most-used live control — implement it as a scalar transform over the existing offsets computed each frame, not a re-architecture.

**Audio source clarity for testing:** the file-input source from SPEC.md's `AudioEngine` remains the primary way to develop and demo all of the above without a live mic — every accept-when in Step 10–12 that mentions "route to audio" should be verified with a bundled short test audio clip (add a ~10s CC0 percussive+tonal test file at `apps/web/public/test-audio/sample.mp3` for repeatable manual verification and for the golden/smoke tests in Step 13 to reference).

**Accept when:** registry + EffectRenderer exist with one trivial GPU effect (invert) and one trivial bake effect (posterize-to-paths can be stubbed as "contour trace at N thresholds"); a layer with the invert effect previews correctly in edit mode and renders live in perform mode; migration loads a v1 file cleanly.

---

## 10. The effect suite (tooooools-class, every param modulatable)

Implement in this order (each is independently commit-able; do not stall the whole step on one effect — stub, note, continue):

**GPU effects** — GLSL, live in both modes, all numeric params modulatable:

| kind | params (beyond enabled) | notes |
|---|---|---|
| `dither` | mode (bayer2/bayer4/bayer8/noise), threshold, palette (use scene palette or b/w), pixelSize | ordered dithering in-shader; Floyd–Steinberg is bake-only (see below) |
| `pixelate` | size | mosaic |
| `crt` | scanlineIntensity, scanlineCount, curvature, aberration, vignette, phosphorGlow | the classic |
| `displace` | amount, scale, speed, mode (simplex/ridged) | noise-driven displacement; `speed` animates the noise field over time even without audio |
| `distort` | amount, frequency, mode (wave/twist/bulge) | geometric warps |
| `recolorMap` | dark, mid, light (colors), contrast | luminance → 3-stop gradient map |
| `grain` | amount, size, animated (bool) | film grain overlay |
| `glow` | color, intensity, spread, threshold | blur + screen composite; THE key effect for the Step 12 aesthetic — implement carefully: bright-pass → two-pass gaussian → additive composite |
| `levels` | blackPoint, whitePoint, gamma, blur | tooooools' "preprocessing" block as one effect |
| `scanSlice` | slices, offset, direction | glitchy row/column displacement |
| `riso` | inkColor, paperColor, misregistration, grainAmount, layers (1-3 ink colors) | risograph/screenprint look: duotone-or-tritone remap + slight per-channel offset (misregistration) + paper grain; a board-defining effect |

**Bake effects** — worker-computed, output editable vector layers:

| kind | params | output |
|---|---|---|
| `halftone` | gridType (regular/benday/stagger), angle, cellSize, dotMin, dotMax, shape (circle/square/line) | one PathLayer per N dots batched into ≤12 grouped paths by size-bucket (thousands of individual layers would kill the layers panel — batch aggressively) |
| `stipple` | density, dotSize, seed | weighted rejection sampling by darkness; grouped paths as above |
| `edgeTrace` | threshold, simplify | Sobel → contour → simplified stroke paths |
| `asciiGrid` | cellSize, charset (blocks/ascii/custom), font | grid of TextLayers batched into ≤20 row-groups, mono font |
| `patternFill` | pattern (lines/waves/checker/contour/crosshatch), spacing, angle, weight | luminance-masked pattern as stroke paths — tooooools' "patterns" |
| `ditherBake` | Floyd–Steinberg, palette, pixelSize | exact error-diffusion dithering as rect paths (batched by color) |
| `scatter` | tileSize, jitter, rotationJitter, seed | slices source into tiles → one ImageLayer or PathLayer per tile in a group (this one SHOULD produce many layers — scattering them to audio is the point; cap 400) |
| `cellularAutomata` | rule (life/custom), steps, cellSize, seedFromImage | run CA seeded by image luminance; emit final state as rect paths |
| `pixelSort` | threshold, direction (h/v), mode (luminance/hue), intervalJitter, seed | classic pixel-sorting glitch; CPU in the worker; outputs an ImageLayer (bake effects may output ImageLayers where raster output is inherent — this and `scatter` are the two cases) |

All bake effects: deterministic given `seed` (use a seeded PRNG, not Math.random) — required for the golden tests in Step 13.

**Accept when:** every GPU effect above works live in perform mode with at least one param routed to audio; every bake effect produces editable layers from a test image; halftone on an 800×600 photo bakes in <3s and the result stays >50fps in perform mode.

---
## 11. Shader layer & perform post-FX (the TouchDesigner-adjacent step)

### 11.1 Document post-FX stack (`SceneGraph.postEffects`)

Full-frame GPU passes applied to the composited perform-mode output, in stack order. In edit mode these are previewed via the EffectRenderer only when the user toggles a "preview post-fx" eye in the effects tab (they're heavy; off by default while editing). Implement:

| kind | params | notes |
|---|---|---|
| `bloom` | threshold, intensity, radius | scene-wide glow; pairs with per-layer `glow` |
| `feedback` | decay, zoom, rotate, offsetX, offsetY, hueShift | **the flagship.** Ping-pong render targets: each frame composites the new frame over the previous frame scaled/rotated/hue-shifted and faded by `decay`. This single effect produces the trails/tunnels/echo look that defines TD-style live visuals. Route `zoom` to rms and `rotate` to mid and it sings. Clamp decay ≤0.98 and reset the buffer on mode switch so it can't blow out. |
| `chromaticAberration` | amount, radial (bool) | |
| `kaleido` | segments, angle | kaleidoscope fold |
| `noiseWarp` | amount, scale, speed | full-frame simplex displacement |
| `vignette` | amount, softness, color | |

### 11.2 Custom GLSL layer type (advanced users; keep contained)

New layer type `"shader"` (schema: `ShaderLayer extends BaseLayer { type: "shader"; fragmentSource: string; width; height; customParams: Record<string, number> }`). Renders a quad running the user's fragment shader. Auto-injected uniforms, documented in a help popover: `u_time`, `u_resolution`, `u_rms`, `u_low`, `u_mid`, `u_high`, `u_onset`, plus every key of `customParams` (each auto-appears in the properties tab as a 0–1 slider and is modulatable like any effect param). Editor: a monospace textarea (no need for CodeMirror; keep it light) with a compile-on-blur cycle — compile errors render inline below the editor in red mono text and the layer falls back to a transparent passthrough, never crashing the app. Ship 4 starter shader presets selectable when creating the layer: `plasma`, `rings` (concentric circles pulsing on u_low), `flowfield`, `starburst rays`. In edit mode, shader layers render a live small-preview thumbnail but pause full-rate rendering unless selected.

**Accept when:** feedback trails run at 60fps on top of a 30-layer scene with audio routed to zoom; a deliberately broken shader shows its error inline and the app keeps running; each starter preset visibly reacts to an audio file.

---

## 12. Painterly art-tech design kit

**Target aesthetic** (from the user's reference board — verified against the actual board): *painterly art-tech*. Soft-focus airbrushed gradient washes and glowing blobs (pinks, lavenders, powder blues); ink — splatter, fluid strokes, deep cyanotype blues on cream paper; botanical silhouettes; risograph/screenprint duotones with visible misregistration and grain; text-as-image (ASCII/character-grid flowers and portraits, poem fragments over blur); glitch as *texture* (pixel sorting, bitmap collapse, halftone) rather than as cyberpunk; delicate generative line work — dendrite/branching networks, scribble structures with small construction annotations; editorial serif display type, often warped/liquified, alongside quiet monospace. Grounds are cream/paper at least as often as dark. The overall register is gallery print experiment, NOT corporate techno-branding — no chrome-y2k, no barcodes, no acid green unless the user makes it.

Every generator below outputs ordinary `PathLayer`s/`ImageLayer`s/groups — editable, modulatable, nothing special-cased.

### 12.1 Glyph & element generators
A toolbar flyout `elements` (keyboard `E`) opening a browser of parametric generators; picking one drops it on canvas with its params editable in the inspector (params live on the group as regenerable metadata until ungrouped, which freezes them to plain paths):
- **soft wash / aura blob** — THE load-bearing element. 3–6 draggable control points → smooth closed blob (Catmull-Rom), filled with a radial soft gradient (core color → transparent) + pre-attached `glow` + optional `grain`. Params: points, spread, coreColor, softness, seed. Defaults must be beautiful on first insert (soft lavender-pink on white).
- **ink splatter** — seeded splatter: drops (count), sizeRange, energy (spread + directional streaking), color. Splats as filled paths with irregular edges (perturbed circles + teardrop streaks).
- **brush stroke** — a tapered filled stroke along a user-draggable spline; params: taper profile (sumi / marker / dry), width, wobble, seed. Gets the ink-painting gesture in one element.
- **dendrite / branching network** — space-colonization growth algorithm (seeded, deterministic): density, spread, thickness taper, style (organic / angular). The Molecura-poster energy; also reads as roots, neurons, lightning.
- **botanical (L-system)** — preset grammars: fern / branch / stem-with-leaves; iterations, angle, thickness, seed. Filled silhouette output — pairs with the `riso` effect or a deep-blue fill for instant cyanotype.
- **scribble structure** — seeded random-walk line cluster with optional construction annotations (small circles, boxes, tick marks along the path) — the annotated-sketchbook look. Params: complexity, annotationDensity, weight.
- **contour / topo lines** — seeded simplex noise → marching-squares iso-lines; levels, scale, weight.
- **flow field** — seeded particle traces over a noise field; count, length, weight, curl.
- **annotation marks** — a small set of quiet marks (fine crosshair, construction circle, corner ticks, plus) sized subtly; for garnish, not branding.

### 12.2 Grid & structure tools
- **modular grid generator**: columns, rows, gutter, margin → hairline stroke paths in a locked group; doubles as a snapping source (snap-to-grid toggle in the top bar). Framed as compositional scaffolding — pieces on the board use faint coordinate grids under organic content.
- **dot grid** variant. (Skip isometric — not in this vocabulary.)
- These are artwork layers — distinct from the faint UI graph paper, which stays chrome-only.

### 12.3 Color, wash, print
- **Gradient fills UI**: fill control gains a solid/gradient toggle; gradient editor = stop bar (click to add, drag to move, double-click to recolor from palette/hex) + angle dial + type select. Konva and Pixi support linear/radial natively; conic may bake to texture — acceptable.
- **Palette tools**: palette bar gains per-swatch locks and a "harmonize" button, plus four shipped board-matched palettes: `ink & paper` (Prussian blue, indigo, cream, warm white), `soft focus` (blush pink, lavender, powder blue, white), `riso bloom` (magenta, violet, process blue, paper cream), `poster heat` (vermilion, marigold, black, cream — for the loud outliers).
- **Paper ground presets**: one-click background settings — warm paper, cool white, deep ink navy — because the ground color does half the work in this aesthetic.

### 12.4 Type & styles
- Bundled self-hosted open fonts on TextLayers: **Fraunces** (editorial serif display — the headline voice of this board), Space Grotesk, Space Mono, JetBrains Mono, Silkscreen (pixel, for occasional bitmap moments). Add `letterSpacing` and `strokeOnly` (outline type) to TextLayer (schema addition, migration-safe defaults).
- **Liquified type**: no new machinery needed — document + verify that GPU effects (`displace`, `distort`) apply to TextLayers via the EffectRenderer, which is exactly the melted/warped editorial type on the board. Add a one-click "liquify" shortcut in the text properties that attaches a tuned `displace` effect.
- **Styles**: saved fill+stroke+effects combinations applied as one undoable command, persisted in `SceneGraph.styles`, with a starter set shipped as JSON: `ink wash` (indigo fill, soft edge blur), `cyanotype` (deep blue riso on paper), `riso duotone` (magenta/blue misregistered), `soft focus` (pale gradient + heavy glow + grain), `pixel collapse` (pixelate + scatter tuned chunky), `liquid chrome` (hard multi-stop silver gradient + displace — the one metallic-melt outlier the board does contain).

**Accept when:** using only generators, styles, and effects from this spec — no uploads — you can compose a piece that reads unmistakably as the board (soft wash blobs + ink splatter + an L-system botanical in cyanotype + a warped Fraunces headline + ascii or halftone texture + riso grain) in under 10 minutes, then route it to audio and perform it.

---

## 12.5 Backend soundness (GPU/worker resource lifecycle — read before Step 9 implementation, not after)

This spec runs real-time GPU shaders and background compute workers inside a browser tab for a live performance. "It renders once in dev" is not the bar; "doesn't leak, crash, or silently blank out mid-set" is. Build these guardrails as part of Step 9, not as cleanup at the end:

**WebGL context lifecycle.**
- One shared `PIXI.Application`/WebGL context for the whole app (edit-mode EffectRenderer and perform-mode renderer reuse the same context via a singleton `GpuContext` module) — do not spin up a second context for previews; browsers cap concurrent WebGL contexts (typically ~8–16) and hitting the limit silently breaks unrelated tabs.
- Listen for `webglcontextlost` / `webglcontextrestored` on the canvas. On loss: pause the rAF loop, show a small non-blocking toast ("graphics context lost, recovering…"), and on restore, recreate all `Filter`/`RenderTexture` instances (Pixi does not do this automatically) and resume. This is a real failure mode on laptops after sleep/wake or GPU driver resets — test it manually by forcing context loss (`gl.getExtension('WEBGL_lose_context').loseContext()`) as part of Step 13's manual verification.
- Feature-detect WebGL2 at startup. If unavailable, disable GPU effects and post-FX entirely (bake effects still work — they're CPU/worker-based), show a one-line notice in the effects tab, and do not let the app crash.

**Shader compile & resource management.**
- Compile every registered GPU-effect shader **once at app startup** (a warmup pass, hidden 1×1 canvas), not lazily on first use — first-use compilation is the #1 cause of a visible frame hitch the first time a performer enables an effect live. Cache compiled `Filter` instances per effect-kind, not per-layer; a layer only needs a filter *instance* (holding that layer's uniform values), not a new compiled program.
- Every `Filter`, `RenderTexture`, and `Container` created for a layer/effect must be explicitly `.destroy()`'d when that layer or effect is removed or the scene is replaced. Add a `disposeScene(graph)` teardown function and call it on scene switch, project load, and edit↔perform mode transitions where the display tree is rebuilt. Missing this is the single most likely way a long performance session (the actual use case — a live set can run 30–90 minutes) degrades from 60fps to single digits over time as orphaned GPU memory accumulates.
- Texture memory budget: downscale any `ImageLayer` source (uploads, baked pixelSort/scatter output) to a max dimension (2048px) before it becomes a GPU texture; keep the original at full res only in the scene JSON for re-export.

**Worker pool for bake effects.**
- A single shared worker pool (size = `navigator.hardwareConcurrency - 1`, min 1, max 4), not one worker per bake operation — queue requests. Each job is cancellable (post a cancel message keyed by job id) so switching designs mid-bake doesn't leave zombie computation running.
- Bake workers must be pure functions of `(sourceImageData, params, seed)` — no shared mutable state — so results are reproducible (required for the golden tests in Step 13) and safely parallelizable.
- Enforce a hard timeout (10s) per bake job; on timeout, cancel and surface an error toast rather than hanging the UI indefinitely on a pathological param combination (e.g. `stipple` density set absurdly high).

**Failure isolation.**
- Every effect's render call (GPU) and compute call (bake) is wrapped so a single misbehaving effect (a bad custom shader, a bake algorithm that throws on unusual input) disables *only that effect instance* (auto-toggles its `enabled` to false, logs to a small in-app error console reachable from the effects tab) rather than crashing the render loop or the whole app. This matters specifically because Step 11's custom GLSL layer accepts arbitrary user shader code.
- Autosave (from SPEC.md Step 2) must run independently of the render loop's health — a stalled/crashed renderer must never block localStorage/Supabase persistence of the scene graph, since that's the user's actual work.

**Accept when:** force a WebGL context loss mid-session and confirm the app recovers without a reload; run a 15-minute stress loop (scripted: load a 40-layer scene, toggle every GPU effect on/off, bake every bake effect, undo/redo, switch modes repeatedly) and confirm memory (`performance.memory` or a manual DevTools heap snapshot) does not grow unbounded; kill a worker mid-job and confirm the UI recovers with an error toast, not a hang; disable WebGL2 via browser flags and confirm the app still loads and bake effects still function.

---

## 13. Integration, performance, tests

1. **Effects browser polish**: registry entries get 64px monochrome preview thumbnails (generate at build time by rendering each effect on a bundled sample image — hairline-bordered tiles, lowercase labels, consistent with the white UI).
2. **Performance** (invoke `performance-profiler`): budget = 60fps in perform mode with 40 layers, 6 GPU layer-effects, feedback + bloom post-FX, sustained over the 15-minute stress loop from 12.5 (not just an instantaneous fps reading — a set that starts at 60fps and decays is a failure even if the first frame looked fine). Optimize the obvious: share gaussian passes between glow instances, render shader-layer thumbnails at ≤15fps in edit mode, pause EffectRenderer previews while dragging.
3. **Tests**: golden-image tests for every bake effect (fixed seed + bundled test image → hash the output path data); GLSL compile test for every registered shader (headless via pixi + a WebGL context in the Playwright run); migration test v1→v2; a modulation test asserting every registered numeric param accepts a routing; a motion-recipe test asserting every shipped recipe in 9.3 applies without error to a matching sample layer/group and that `growthProgress` playback with `ratchet: true` never decreases across a synthetic descending-then-rising `FeatureFrame` sequence; the 12.5 resource-lifecycle accept-whens, scripted where possible (context-loss simulation, worker-kill, stress loop) rather than left as manual-only.
4. **Docs**: README gains an `effects` section (table of effects + a note that all params are audio-modulatable) and a `performing` addendum about feedback + master intensity.
5. **Invoke `pr-review-expert`, `dependency-auditor`, `ship-gate`.** Final commit, push.

## 14. Commit messages (use these exactly, one per step)

9.  `feat(effects): registry, effect renderer, schema v2 + migration, effects tab`
10. `feat(effects): gpu suite (dither, crt, glow, displace, +6) and bake suite (halftone, stipple, ascii, +5)`
11. `feat(shaders): post-fx stack with feedback trails, custom glsl layer type, starter presets`
12. `feat(designkit): wash/ink/botanical/dendrite generators, grids, gradients, palettes, fonts, styles`
13. `chore: effect thumbnails, perf pass, golden tests, docs`
