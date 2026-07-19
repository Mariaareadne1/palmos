# palmós

A design editor and audio visualizer. Upload a screenshot of a flat graphic
design and get back an editable, layered vector reconstruction; edit every
layer; then route layer properties to live audio so the design moves, warps,
and hue-shifts in sync with sound. Built for live coders and design-minded
people who want their visuals to feel intentional, not generated.

## Quickstart

Two terminals:

```sh
# 1 — the editor (Next.js)
cd apps/web
npm install
npm run dev            # http://localhost:3000

# 2 — the reconstruction service (FastAPI, Python 3.11+)
cd services/reconstruct
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # http://localhost:8000
```

Open http://localhost:3000, drop a poster/album-art PNG onto the canvas,
and it comes back as editable layers. The editor works fully without the
service — reconstruction is the only feature that needs terminal 2.

If either default port is taken, run `npm run dev -- --port <n>` and/or
`uvicorn app.main:app --port <n>`, and point the editor at the service
with `NEXT_PUBLIC_RECONSTRUCT_URL=http://localhost:<n>`.

## Architecture

```
Screenshot ──▶ Reconstruction service (FastAPI)
                 segment → vectorize → palette → (OCR)
                        │
                        ▼
                 Scene graph JSON  ◀──▶  localStorage / Supabase
                        │
          ┌─────────────┴──────────────┐
          ▼                            ▼
     EDIT MODE                    PERFORM MODE
   react-konva canvas           PixiJS fullscreen renderer
   layers panel, inspector      audio feature bus → mod matrix
   undo/redo, transforms        60fps, filters only where routed
```

One scene graph (`apps/web/src/types/scene.ts`) is the single source of
truth: edit mode mutates it through an undoable command layer, perform
mode reads it and applies ephemeral audio-driven offsets that are never
written back, and the reconstruction service emits it.

## Optional extras

Everything below is off by default and the app runs fully without it.

| Extra | What it adds | Setup |
|---|---|---|
| MobileSAM / SAM | Better segmentation of complex designs (default is a color-quantization CV pipeline) | `pip install git+https://github.com/ChaoningZhang/MobileSAM.git torch`, download the ~40MB MobileSAM checkpoint (`mobile_sam.pt`), set `SAM_CHECKPOINT=/path/to/mobile_sam.pt` |
| Tesseract OCR | Detected text becomes editable `TextLayer`s instead of vector paths | `brew install tesseract` (or apt) + `pip install pytesseract` |
| Supabase | Cloud persistence: magic-link auth, project list, save/load | Create a project, run `supabase/migrations/`, set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/web/.env.local` |
| Claude layer naming | `✦ name layers` button after reconstruction — descriptive names + vibe tags | `pip install anthropic`, set `ANTHROPIC_API_KEY` on the service |
| Redis job store | Shares reconstruction jobs across workers so the service scales past one process (`uvicorn --workers >1`) | `pip install redis`, set `REDIS_URL` on the service |

> **env-var trap:** shell-level environment variables override `.env.local`
> in Next.js. An empty `NEXT_PUBLIC_SUPABASE_URL` exported in your shell
> silently disables the Supabase adapter even with a correct `.env.local`.

### Notes

- **vtracer on Python 3.14:** the vtracer wheel hard-crashes (SIGSEGV) on
  some CPython builds. The service runs it in a crash-isolated subprocess
  and falls back to an OpenCV contour tracer automatically — reconstruction
  works either way, vtracer just produces smoother curves where it runs.
- **npm audit:** remaining advisories are in Next.js 14 itself and its dev
  tooling, fixed only in Next 15/16. This project pins Next 14 by design and
  runs on localhost, where those server-deployment vectors don't apply.

## Effects & design kit

Every layer has an **effects** tab (next to properties/motion). **Every
numeric effect parameter is audio-modulatable** — route it in the motion
tab (`effect:…`, `post:…` targets) or one-click **auto-route** a curated
motion recipe when a generator has one.

Two execution classes, one shader source each, no drift between modes:

- **GPU effects** (live in edit preview *and* perform, per-frame):
  `dither`, `pixelate`, `crt`, `displace`, `distort`, `recolorMap`,
  `grain`, `glow`, `levels`, `scanSlice`, `riso`, plus `invert`.
- **Bake effects** (worker-computed → editable vector layers): `halftone`,
  `stipple`, `edgeTrace`, `asciiGrid`, `patternFill`, `ditherBake`,
  `scatter`, `cellularAutomata`, `pixelSort`. Baking hides the source, never
  deletes it; output is real, editable, performable layers.
- **Document post-FX** (perform-mode, full-frame): `bloom`, **`feedback`**
  (ping-pong trails — the flagship), `chromaticAberration`, `kaleido`,
  `noiseWarp`, `vignette`.
- **Custom GLSL layer** (`✦` in the toolbar): write a fragment shader with
  auto-injected `u_time`, `u_resolution`, `u_rms/low/mid/high/onset`, and
  your own 0–1 params. Compile errors show inline; a broken shader falls
  back to transparent passthrough.

**Design kit** (`E` for the elements browser): `soft wash`, `ink splatter`,
`brush stroke`, `dendrite`, `botanical` (L-system), `scribble`, `contour`,
`flow field`, `annotation marks`, `modular grid`, `dot grid`. Plus gradient
fills, per-swatch palette locks + harmonize, board palettes, paper grounds,
editorial fonts (Fraunces et al.), one-click `liquify`, and saved styles
(`cyanotype`, `riso duotone`, `soft focus`, `liquid chrome`, …). Generators
stay regenerable (params in the inspector) until you ungroup them, which
freezes them to plain editable paths.

> Effect param controls are auto-generated from each effect's registry
> definition — one param schema drives the inspector UI, the mod-matrix
> ranges, and the export. The effects/elements browsers list effects as
> labeled hairline tiles (rendered 64px thumbnails were scoped down to keep
> the build dependency-free).

## Performing with it

1. Build, reconstruct, or generate a design; select a layer; open the
   **motion** tab.
2. `+ add motion` and pick a routing — e.g. background `hue ← low`,
   title `scale ← onset`, a wash blob `scale ← rms`, or an effect param like
   `effect:riso:misregistration ← high`. Amount is bipolar; smoothing adds
   attack/release; `phase` staggers repeated elements; `ratchet` makes a
   value only ever grow (the dendrite/L-system `growthProgress` bloom). Or
   hit **auto-route** for a curated recipe.
3. Pick an audio source: **mic** for a live room, **file** to rehearse
   (a bundled test clip lives at `public/test-audio/`), **tab** to capture
   another browser tab (Chrome).
4. Hit **perform**. The HUD (auto-hides after 2s) has the audio source, a
   **reactivity focus** 4-way (`calm`/`pulse`/`chaos`/`strobe`), and a
   master **intensity** slider. `F` fullscreen, `D` fps readout, `Esc` back
   to edit (the graph is never mutated by performing).
5. Add a `feedback` post-fx and route `zoom ← rms`, `rotate ← mid` for the
   signature trail-tunnel that breathes with the track.
6. Live coding: run [Strudel](https://strudel.cc) in another tab, select
   **tab** as the audio source (tick "share audio"), and the visuals follow
   your patterns. Routings, effects, and post-FX all save with the file, so
   a `.palmos.json` is a complete performance patch.

### Performance & graphics notes

- One shared WebGL2 context for the whole app; shaders are warm-compiled at
  startup so enabling an effect mid-set never hitches. Filters attach only
  to layers that use them. Budget: 60fps in perform with 40 layers + GPU
  effects + feedback (verified by a frame-work-time Playwright test).
- The app listens for WebGL context loss (sleep/wake, GPU reset) and
  recovers automatically without a reload.
- WebGL2 is required for GPU effects & perform mode; without it, bake
  effects (CPU/worker) still work and the effects tab says so.

## Tests

```sh
cd apps/web && npm test              # vitest — commands, DSP, mod matrix, design/lib units
cd apps/web && npm run typecheck     # tsc --noEmit, strict mode
cd apps/web && npm run e2e           # Playwright end-to-end (uses installed Chrome)
cd services/reconstruct && pytest    # pipeline + API + hardening (no optional deps needed)
```

## Deploying the reconstruction service

The editor is a static Next.js app (`cd apps/web && npm run build`). The
reconstruction service is a stateless FastAPI app that runs on its core
dependencies alone; it's environment-configurable (upload limits, CORS
origins, worker count, and the optional `REDIS_URL` job store) and ships a
`Dockerfile`. See [`services/reconstruct/README.md`](services/reconstruct/README.md)
for the API contract, the full env-var table, and scale-out notes.
