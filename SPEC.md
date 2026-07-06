# SPEC — palmós (repo: palmos)

A design editor and audio visualizer: upload a screenshot of a graphic design, get back an editable, layered reconstruction of it, edit every layer, then route layer properties to live audio so the design moves, warps, and reacts to sound in perform mode. Built for live coders and design-minded people who want their visuals to feel intentional, not generated.

---

## 0. How to execute this spec

You (the agent) are building this end-to-end in one session. Read this entire file before writing any code. Then execute the steps **in order** — each step ends with acceptance criteria that must pass before moving on.

### Hard rules

1. **Git: commit at the end of each step, as the user, with zero AI attribution.** The repo is already initialized by the user (possibly with a GitHub remote named `origin`). Before your first commit, run `git config user.name` and `git config user.email` — both must be set to the user's identity; if either is empty, STOP and ask the user to set them. Never modify git config, never use `--author`, never add `Co-Authored-By:` trailers or `Generated with Claude Code` lines or any AI attribution to any commit message — the message is exactly the text given in section 7, nothing more. At each step boundary: `git add -A && git commit -m "<message from section 7>"`, then `git push` only if `origin` exists (if push fails on auth, say so and continue — do not attempt credential setup). Never force-push, never rebase, never touch history.
2. **Everything must run without external credentials.** Supabase, SAM model weights, Tesseract, and the Anthropic API are all optional enhancements behind flags/graceful fallbacks. The app must work end-to-end on a fresh clone with `npm install` + `pip install` and nothing else. If a download or install fails, fall back per the fallback chain defined in that step and keep going — do not stall the build.
3. **One source of truth.** The scene graph (section 4) is the only state that describes a design. Edit mode mutates it, perform mode reads it, the reconstruction service produces it. Never introduce a second representation that can drift. (This project's predecessor died from two parallel state paths. Do not repeat it.)
4. **TypeScript strict mode everywhere in the frontend.** The scene graph types in section 4 are the contract — define them first, in one file, and import them everywhere.
5. **No placeholder UIs.** Every panel you build must be functional. If a feature is deferred, it does not appear in the UI at all.
6. **Design quality matters as much as function.** This app's target audience judges tools by their aesthetics. Follow the design direction in Step 1 strictly; no default-looking browser UI, no unstyled buttons, no Bootstrap-feeling anything.

### Skills to invoke

The user has skill plugins installed. Invoke these at the specified steps (via the Skill tool / slash command, whichever this environment exposes). If a named skill is unavailable, note it and continue — the spec contains enough detail to proceed without it.

| Step | Skill | Purpose |
|---|---|---|
| 1 | `ui-design-system` | Generate design tokens from the aesthetic direction in Step 1 |
| 3 | `database-schema-designer` | Review the Supabase schema before writing migrations |
| 6 | `api-design-reviewer` | Review the reconstruction API contract before implementing |
| 6 | `api-test-suite-builder` | Generate pytest suite for the pipeline endpoints |
| 8 | `pr-review-expert` | Final self-review pass over the diff |
| 8 | `ship-gate` + `dependency-auditor` | Pre-flight checks before declaring done |

Do not invoke orchestrator/loop skills (`cs-product`, `cs-product-loop`, etc.) — product decisions are already made in this spec.

### Milestone checkpoints

After Steps 2, 4, 5, and 6, print a short status block: what works, what was deferred, how to manually verify (exact commands + what to click). These are the moments the user will test.

---

## 1. Product definition

**One-liner:** Screenshot in → editable layers out → layers dance to sound.

**Primary user:** The builder herself — a live coder who performs with Strudel and wants audio-reactive visuals derived from designs she finds inspiring. Secondary: design-minded tech people ~18–28 who care about clean tools.

**The demo that proves it works:** Upload a flat graphic design (poster, album art, geometric illustration). Within ~30 seconds, see it rebuilt as editable vector layers on the canvas. Recolor one shape, move another. Hit "Perform," play music near the mic, and watch the layers pulse, drift, and hue-shift in sync — fullscreen, 60fps.

**Non-goals (do not build):**
- Multi-image blending / "combine these designs" — cut from scope
- AI image generation of any kind
- Collaboration/multiplayer
- Mobile support (desktop Chrome/Firefox/Safari only)
- Pixel-perfect reconstruction of photos or complex illustrations — the pipeline targets **flat graphic design** (posters, geometric art, UI-style graphics, bold illustrations). Photos will produce coarse results and that is acceptable.

---

## 2. Architecture

Two frontend modes over one scene graph, one backend service.

```
Screenshot ──▶ Reconstruction service (FastAPI)
                 segment → vectorize → palette → (OCR)
                        │
                        ▼
                 Scene graph JSON  ◀──▶  Supabase / localStorage
                        │
          ┌─────────────┴──────────────┐
          ▼                            ▼
     EDIT MODE                    PERFORM MODE
   react-konva canvas           PixiJS fullscreen renderer
   layers panel, inspector      audio feature bus → mod matrix
   undo/redo, transforms        60fps, shader-friendly
```

- **Edit mode** renders the scene graph with react-konva and mutates it through a command layer (for undo/redo).
- **Perform mode** serializes nothing new — it renders the *same* scene graph with PixiJS, applying real-time property offsets computed by the mod matrix from live audio features. Offsets are ephemeral (never written back to the graph).
- **Reconstruction service** is a separate FastAPI app. The frontend talks to it over HTTP. It is stateless; results are returned as scene graph JSON and persisted by the frontend.

## 3. Repo layout & stack (locked decisions — do not substitute)

```
palmos/
├── SPEC.md                  (this file)
├── README.md                (written in Step 8)
├── apps/web/                Next.js 14 (App Router) + TypeScript strict
│   ├── src/types/scene.ts   ← the scene graph contract, written FIRST
│   ├── src/state/           Zustand stores + command (undo) layer
│   ├── src/editor/          react-konva edit mode
│   ├── src/perform/         PixiJS perform mode + audio engine
│   ├── src/components/      shared UI
│   └── src/lib/             api client, persistence, utils
└── services/reconstruct/    FastAPI + Python 3.11
    ├── app/main.py
    ├── app/pipeline/        segment.py, vectorize.py, palette.py, ocr.py, assemble.py
    ├── app/schemas.py       Pydantic models mirroring scene.ts
    └── tests/
```

**Frontend:** Next.js 14 App Router, TypeScript strict, Zustand (state), react-konva + konva (edit canvas), pixi.js v8 (perform renderer), Tailwind (styling, with custom tokens from Step 1 — no default Tailwind look). No Redux, no CSS-in-JS libraries.

**Backend:** FastAPI, Pydantic v2, uvicorn, opencv-python-headless, numpy, scikit-learn (k-means), vtracer (pip package), Pillow. Optional: `segment-anything` or `mobile_sam` + checkpoint, `pytesseract` + tesseract binary. Optional deps are imported lazily inside try/except — their absence must never crash the service.

**Persistence:** localStorage + JSON file download/upload by default. Supabase (auth + `projects` table + storage bucket) activates only when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set. Note in code comments: shell-level env vars override `.env.local` in Next.js — document this trap in the README.

---

## 4. The scene graph (write this file first: `apps/web/src/types/scene.ts`)

```typescript
export type LayerType = "path" | "text" | "image" | "group";

export interface Transform {
  x: number;        // px, relative to parent
  y: number;
  scaleX: number;   // 1 = 100%
  scaleY: number;
  rotation: number; // degrees
}

export interface BaseLayer {
  id: string;             // nanoid
  name: string;           // user-editable, e.g. "Sun circle"
  type: LayerType;
  transform: Transform;
  opacity: number;        // 0–1
  visible: boolean;
  locked: boolean;
  // zIndex is implicit: order within parent's children array
}

export interface PathLayer extends BaseLayer {
  type: "path";
  d: string;              // SVG path data — the universal vector format here
  fill: string | null;    // hex or null
  stroke: string | null;
  strokeWidth: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  align: "left" | "center" | "right";
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  src: string;            // data URL or storage URL
  width: number;
  height: number;
}

export interface GroupLayer extends BaseLayer {
  type: "group";
  children: Layer[];
}

export type Layer = PathLayer | TextLayer | ImageLayer | GroupLayer;

// ---- Audio modulation ----

export type AudioFeature = "rms" | "low" | "mid" | "high" | "onset";

export type ModTarget =
  | "x" | "y" | "scale" | "rotation" | "opacity" | "hue" | "blur";

export interface ModRouting {
  id: string;
  layerId: string;
  target: ModTarget;
  source: AudioFeature;
  amount: number;      // -1..1, bipolar; scaled per-target (see Step 4 table)
  smoothing: number;   // 0..1 → EMA attack/release coefficient
  invert: boolean;
}

export interface SceneGraph {
  id: string;
  name: string;
  width: number;          // canvas px
  height: number;
  background: string;     // hex
  layers: Layer[];        // bottom-to-top render order
  routings: ModRouting[];
  palette: string[];      // extracted or user-defined swatches
  version: 1;
}
```

Every mutation of the graph goes through the command layer (Step 2). The Pydantic schemas in `services/reconstruct/app/schemas.py` mirror these types exactly — field-for-field, same names, camelCase preserved via Pydantic aliases.

---
## 5. Build steps

### Step 1 — Scaffold + design system

1. Scaffold the monorepo per section 3. Next.js app with `create-next-app` (TypeScript, Tailwind, App Router, src dir, no ESLint prompts blocking). FastAPI service with a `pyproject.toml` or `requirements.txt` and a `/health` endpoint.
2. Write `apps/web/src/types/scene.ts` verbatim from section 4.
3. **Invoke `ui-design-system`** with this direction, then encode the result as Tailwind theme tokens + CSS variables:
   - **Vibe:** engineer's sketchbook. White, precise, almost austere — the tool disappears so the artwork is the only colorful thing on screen. Whitespace is a deliberate design element: panels and toolbars should have moments of intentional emptiness rather than filling every pixel; vary density for rhythm.
   - **Surfaces:** pure/near-pure white (`#ffffff` / `#fdfdfc`), black text, 1px black or near-black hairline borders and outlines as the primary structural device. No gray-panel-on-gray-panel layering — separation comes from hairlines and space, not fills.
   - **Graph paper:** a faint graph-paper grid trace (thin lines at ~4–6% black, minor grid ~16px, optional heavier line every 5th) applied to the canvas backdrop and, subtly, to one or two chrome regions (e.g. the empty-state dropzone) for texture. It should read as a trace, barely-there — visible when you look for it.
   - **Type:** a monospace for labels/values (Space Mono or JetBrains Mono via next/font), same or a clean grotesk for the few headings. All UI labels lowercase. 11–13px UI text, black.
   - **Color:** minimal, surgical pops only — one accent for selection outlines/active states and at most one secondary for the perform/record affordance. Suggest 2–3 accent options in a code comment; default to a warm signal orange (`#ff5c1f`-family). Everything else is black on white.
   - **Never:** default blue focus rings, native-looking range inputs (style them as thin black lines with a small square/circle thumb), gradients, drop shadows, glassmorphism, rounded-everything (corners square or barely rounded, ≤2px).
4. App shell: top bar (project name — inline editable, mode toggle `edit / perform`, save/export buttons), left panel (layers), center canvas, right panel (inspector with two tabs: `properties` / `motion`). Panels are fixed-width (260px left, 300px right), canvas flexes.

**Accept when:** `npm run dev` shows the styled shell with an empty canvas; `uvicorn` serves `/health`; zero TypeScript errors.

### Step 2 — Editor core (the biggest step; budget accordingly)

State: a Zustand store holding `SceneGraph`, `selectedLayerIds: string[]`, `mode: "edit" | "perform"`, plus a **command layer**: every mutation is a `Command { do(), undo(), label }` pushed to an undo stack (cap 100). Implement commands: add/delete layer, reorder, rename, set-transform, set-style (fill/stroke/opacity), group/ungroup, set-text.

Canvas (react-konva):
- Render all layer types. `PathLayer` → `Konva.Path` with `data={d}`. Groups render recursively.
- Click to select (shift-click multi-select), drag to move, Konva `Transformer` for scale/rotate handles. Transforms write back through commands **on drag end** (not per-frame).
- Marquee selection on empty-canvas drag. Click empty space deselects.
- Pan with space+drag or middle mouse; zoom with scroll wheel (cursor-centered, 10%–800%), zoom readout in the top bar.
- Checkerboard or subtle dot-grid backdrop outside the artboard; the artboard itself is a crisp rect at `SceneGraph.width × height` with the background color.

Layers panel: bottom-to-top graph order shown top-to-bottom (top of list = frontmost). Rows: visibility eye, lock, color chip (fill), name (double-click to rename), drag to reorder (native HTML5 DnD or dnd-kit). Selection syncs both ways with canvas.

Inspector `properties` tab (context-sensitive to selection): numeric inputs for x/y/w-or-scale/rotation/opacity (draggable-scrub labels if quick to add, plain inputs otherwise), fill + stroke color controls (a compact custom picker: hex input + the scene `palette` swatches + an eyedropper via the EyeDropper API where available), text controls for TextLayers.

Creation tools (toolbar strip on the canvas's left edge): select (V), rectangle (R), ellipse (O), text (T) — shapes are created as `PathLayer`s with generated `d` strings so everything downstream stays uniform. Pen tool is **out of scope**.

Shortcuts: ⌘Z/⇧⌘Z undo/redo, ⌘D duplicate, Delete, arrows nudge 1px (shift = 10px), ⌘G/⇧⌘G group/ungroup, ⌘A select all, Esc deselect, V/R/O/T tools.

Persistence: autosave scene graph JSON to localStorage (debounced 500ms); top-bar export downloads `{name}.palmos.json`; import via file picker or drag-drop of a `.json` onto the canvas. Also implement `export SVG` (serialize the graph to an `<svg>` — straightforward since paths are already SVG `d` strings) and `export PNG` (Konva `stage.toDataURL`, 2x).

**Accept when:** you can build a small poster from scratch — shapes, text, recolors, grouping, reordering — undo/redo through 20 mixed operations without state corruption, reload the page and it's still there, and export a valid SVG that opens in a browser.

### Step 3 — Optional Supabase persistence

**Invoke `database-schema-designer`** to review before writing:

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users not null,
  name text not null default 'untitled',
  scene jsonb not null,
  thumbnail_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- RLS: owner-only read/write. Storage bucket `uploads` for source screenshots, owner-scoped path.
```

Write the migration to `supabase/migrations/`. Frontend: a `PersistenceAdapter` interface with `LocalAdapter` (default, from Step 2) and `SupabaseAdapter` (email magic-link auth, project list modal, save/load). Adapter chosen at startup by env presence. **Do not** let any Supabase import execute when the env vars are absent.

**Accept when:** with no env vars, nothing about the app references or errors on Supabase; with env vars set, save/load round-trips (verified in code review — user will test live later).

### Step 4 — Audio engine + mod matrix

`apps/web/src/perform/audio.ts` — an `AudioEngine` class:
- Sources (user picks in a small panel): **microphone** (`getUserMedia`), **audio file** (file input → `AudioBufferSourceNode` with play/pause/loop — essential for testing without performing), **tab/system audio** (`getDisplayMedia({audio:true})` where supported; hide the option elsewhere).
- `AnalyserNode`, `fftSize 2048`, `smoothingTimeConstant 0` (we do our own smoothing).
- Per animation frame compute a `FeatureFrame`:
  - `rms`: root-mean-square of time-domain data, mapped through a soft knee to 0–1.
  - `low` / `mid` / `high`: mean magnitude of FFT bins in <250 Hz / 250–2000 Hz / >2000 Hz, each normalized 0–1 against a slow-decaying running max (auto-gain, ~3s half-life) so the visuals stay lively at any input level.
  - `onset`: spectral flux (half-wave-rectified frame-to-frame magnitude increase, summed); when flux exceeds `mean + 1.5σ` of a 43-frame rolling window, fire an impulse that jumps to 1 and decays exponentially (~150 ms half-life). Debounce 100 ms.
- Each feature then passes through per-routing EMA smoothing: `y += (x - y) * (1 - smoothing * 0.95)`.

Mod matrix — `applyModulation(graph, features, routings): Map<layerId, PropertyOffsets>`. Offsets are **ephemeral overlays**, never written to the graph. Per-target scaling of `amount` (bipolar, `invert` flips sign):

| target | offset at |amount| = 1 |
|---|---|
| x, y | ±15% of canvas dimension |
| scale | ×(1 ± 0.5) multiplicative |
| rotation | ±45° |
| opacity | ±1 (clamped 0–1) |
| hue | ±180° hue-rotate on fill |
| blur | 0→24px (unipolar) |

Inspector `motion` tab (works on the selected layer, in edit mode too): list of that layer's routings as rows — `[source ▾] → [target ▾]  amount slider (-1..1)  smoothing knob/slider  invert toggle  ×`, plus `+ add motion`. A tiny live meter next to each source name showing current feature value (canvas-drawn, 30fps is fine). Routings live in `SceneGraph.routings` so they persist with the file.

**Accept when:** a unit-testable `AudioEngine` (test the math with synthetic buffers: a 100 Hz sine drives `low` toward 1 and leaves `high` near 0; a step in amplitude fires exactly one onset) and a motion tab that saves/loads routings with the scene.

### Step 5 — Perform mode (PixiJS)

Toggling to `perform` mounts a PixiJS v8 `Application` (WebGL) that renders the scene graph fullscreen (letterboxed to the artboard aspect, true browser fullscreen on `F`):
- `PathLayer` → `Graphics` via `new Graphics().svg(...)` path parsing if available in the installed Pixi version; otherwise parse `d` with `svg-path-parser` (or a small hand-rolled parser for M/L/C/Q/Z — vtracer only emits those) into Graphics commands. Choose ONE approach after checking the installed Pixi API; do not ship both.
- `TextLayer` → `Text`, `ImageLayer` → `Sprite`, groups → `Container`.
- Build the display tree **once** per graph change; per frame only apply mod offsets: position/scale/rotation/alpha directly, `hue` via `ColorMatrixFilter`, `blur` via `BlurFilter` (attach filters only to layers that have such routings — filters are the perf risk).
- rAF loop: pull `FeatureFrame` → compute offsets → apply. Show an fps readout (toggle with `D`). Target 60fps with 50 layers and ≤5 filtered layers.
- Minimal perform HUD (auto-hides after 2s of no mouse): back-to-edit, audio source picker, master intensity slider (0–2, scales all routing amounts).

**Accept when:** edit a design, add routings (e.g. background hue←low, title scale←onset, shapes y←mid), switch to perform, play an audio file, and everything moves accordingly at 60fps; Esc returns to edit with the graph unchanged.

### Step 6 — Reconstruction service

**Invoke `api-design-reviewer`** on this contract first, then implement:

```
POST /reconstruct   multipart: image (png/jpg ≤10MB), max_layers (int, default 24)
  → 200 { job_id }        (processing is async in a thread; typical job 5–30s)
GET  /jobs/{job_id}
  → { status: "processing" | "done" | "error",
      progress: 0–1, stage: "segmenting" | "vectorizing" | "assembling",
      scene?: SceneGraph, engine?: "sam" | "cv", error?: string }
CORS: allow localhost:3000.
```

Pipeline (`app/pipeline/`), in order:

1. **Preprocess** — load with Pillow, EXIF-rotate, downscale longest side to 1024px (keep the scale factor to size the artboard from the original), convert to RGB numpy.
2. **Palette** (`palette.py`) — k-means (k=8) on a 10k-pixel sample; merge centroids closer than ΔE ≈ 12 (Lab space); output hex list ordered by coverage. This is `SceneGraph.palette` and drives the fallback segmenter.
3. **Segment** (`segment.py`) — fallback chain, each wrapped in try/except:
   a. **MobileSAM / SAM** if importable AND a checkpoint exists at `SAM_CHECKPOINT` env path (document in README: optional download, ~40MB MobileSAM). Automatic mask generation; drop masks <0.5% of image area; sort by area desc; keep `max_layers`.
   b. **CV fallback (must always work; build and test this FIRST, add SAM after):** quantize the image to the palette colors (nearest-centroid per pixel) → per color: binary mask → morphological open+close (3×3) → `cv2.connectedComponents` → each component ≥0.5% area becomes a mask. The largest mask overall is treated as the background (becomes `SceneGraph.background`, not a layer).
4. **Vectorize** (`vectorize.py`) — per mask: composite the masked pixels onto transparency, run **vtracer** (`vtracer.convert_raw_image_to_svg` or the file API; color mode, low filter-speckle, appropriate precision) → parse the emitted SVG with a lightweight XML pass → extract each `<path d>` + fill. One mask may yield several paths; keep them, grouped. Normalize coordinates back to original-image scale. If vtracer errors on a mask, fall back to `cv2.findContours` + `approxPolyDP(ε=1.5)` → polygon path string, fill = mask's mean color.
5. **OCR** (`ocr.py`) — only if pytesseract + tesseract binary are present: word boxes with confidence >60 become `TextLayer`s (font: `"Inter"`, size from box height ×0.75, fill = dominant text-pixel color) and their regions are excluded from step 3's masks. Absent → skip silently; text arrives as vector paths instead, which is acceptable.
6. **Assemble** (`assemble.py`) — build the `SceneGraph`: artboard = original dimensions, background from 3b (or the border-pixel modal color under SAM), layers ordered largest-area first (bottom) to smallest (top), auto-named `"{colorname} shape {n}"` using a nearest-CSS-color-name lookup, `routings: []`, `version: 1`. Validate against the Pydantic schema before returning.

Frontend: an upload dropzone on the empty-canvas state + an `import image` button; progress UI showing `stage`; on `done`, load the scene and toast which engine ran. Keep `NEXT_PUBLIC_RECONSTRUCT_URL` configurable (default `http://localhost:8000`). If the service is unreachable, the button explains how to start it — the editor itself must never depend on the backend.

**Invoke `api-test-suite-builder`**, then ensure the suite includes: pytest generating synthetic test images in-code (e.g. 800×600, distinct background + 3 filled rects + a circle) → full CV-path pipeline run asserts: ≥4 layers, every `d` parses, every fill within ΔE 20 of a true color, background detected correctly; palette merge test; job lifecycle test via httpx `TestClient`.

**Accept when:** the synthetic-image pytest suite passes with **no optional deps installed**, and uploading a real flat design through the UI yields an editable, recolorable, perform-able reconstruction.

### Step 7 — Optional AI layer naming (feature-flagged, smallest step)

Only when `ANTHROPIC_API_KEY` is set on the service: `POST /jobs/{id}/enrich` sends the layer list (names, colors, bounding boxes, path counts — **not** the image) plus a downscaled thumbnail to the Anthropic Messages API and asks for JSON: better layer names + 3 vibe tags; apply names, store tags in `SceneGraph.name` suggestions. Frontend shows a small `✦ name layers` button only when the service reports the capability via `/health`. Verify current SDK usage and model names against https://docs.claude.com/en/api/overview at build time rather than assuming. If anything here is friction, stub the endpoint and move on — this step is explicitly sacrificial.

### Step 8 — Tests, review, docs

1. Vitest: command-layer undo/redo property tests; scene serialization round-trip; `applyModulation` scaling table; audio feature math (synthetic buffers from Step 4).
2. One Playwright smoke test: load app → draw rect → recolor → add routing → toggle perform → toggle back → export JSON → assert file contents parse to a valid graph.
3. **Invoke `pr-review-expert`** over the full diff; fix what it flags.
4. **Invoke `dependency-auditor` and `ship-gate`.**
5. README: what it is (one paragraph, no hype), quickstart (two terminals: `npm run dev`, `uvicorn app.main:app --reload`), optional-extras table (SAM checkpoint, tesseract, Supabase, Anthropic key — what each adds, exact setup), the env-var shadowing warning, architecture sketch, and a "performing with it" section (mic input + Strudel in another tab).
6. Make the final commit (message 8 in section 7), push if `origin` exists, then print the final status block: everything working, everything deferred, and confirmation that `git log --format='%an %s'` shows only the user as author.

---

## 6. Acceptance criteria — definition of done

- [ ] Fresh clone, no env vars, no optional deps: editor fully works, perform mode fully works, reconstruction works via the CV fallback.
- [ ] The demo in section 1 is achievable start-to-finish in under 3 minutes.
- [ ] Zero TypeScript errors; vitest, pytest, and the Playwright smoke test all pass.
- [ ] 60fps in perform mode with the synthetic test scene + 5 routings (measure with the fps readout).
- [ ] `git log` shows one commit per completed step, authored solely by the user's git identity, with messages exactly matching section 7 and no AI attribution trailers anywhere.
- [ ] UI matches the Step 1 design direction — a screenshot of it would not be mistaken for a template.

## 7. Commit messages (use these exactly, one per step)

1. `scaffold: monorepo, next app shell, fastapi health, design tokens`
2. `feat(editor): scene graph, command layer, konva canvas, layers panel, inspector`
3. `feat(persistence): local autosave + json import/export, optional supabase adapter`
4. `feat(audio): feature extraction engine + mod matrix + motion tab`
5. `feat(perform): pixi renderer, fullscreen perform mode, hud`
6. `feat(reconstruct): fastapi pipeline (cv fallback + optional sam), upload flow`
7. `feat(ai): optional claude layer naming behind api key flag`
8. `chore: tests, playwright smoke, readme`
