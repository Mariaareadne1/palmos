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

## Performing with it

1. Build or reconstruct a design, select a layer, open the **motion** tab.
2. `+ add motion` and pick a routing — e.g. background `hue ← low`,
   title `scale ← onset`, shapes `y ← mid`. Amount is bipolar; smoothing
   adds attack/release; live meters show each feature.
3. Pick an audio source: **mic** for a live room, **file** to rehearse,
   **tab** to capture another browser tab (Chrome).
4. Hit **perform**. `F` for fullscreen, `D` for the fps readout, mouse
   reveals the HUD (audio source + master intensity), `Esc` returns to edit.
5. Live coding: run [Strudel](https://strudel.cc) in another tab, select
   **tab** as the audio source (tick "share audio"), and the visuals follow
   your patterns. Routings save with the file, so a `.palmos.json` is a
   complete performance patch.

## Tests

```sh
cd apps/web && npm test              # vitest — commands, DSP, mod matrix
cd apps/web && npx playwright test   # end-to-end smoke (uses installed Chrome)
cd services/reconstruct && pytest    # pipeline + API (no optional deps needed)
```
