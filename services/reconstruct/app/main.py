"""palmós reconstruction service.

Stateless FastAPI app: screenshot in, scene-graph JSON out. Results are
returned to the frontend and persisted there — nothing is stored here
beyond a TTL'd in-memory job registry.

Contract (SPEC §5 step 6, reviewed via api-design-reviewer):
  POST /reconstruct  multipart(image png/jpg <=10MB, max_layers=24) -> {job_id}
  GET  /jobs/{job_id} -> JobState (progress/stage; scene+engine when done)
  GET  /health -> {status, capabilities}
Errors use FastAPI's standard {detail} envelope: 413 oversize, 415 wrong
type, 404 unknown job.
"""

import os
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import enrich as enrich_mod
from .jobs import store
from .pipeline.assemble import assemble
from .pipeline.ocr import try_extract_text
from .pipeline.palette import extract_palette
from .pipeline.preprocess import preprocess
from .pipeline.segment import segment
from .pipeline.vectorize import vectorize
from .schemas import JobCreated, JobState

MAX_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg"}

app = FastAPI(title="palmos-reconstruct", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # the editor runs on localhost:3000 by default; allow any localhost
    # port so dev servers on 3001/3002 work too
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

_executor = ThreadPoolExecutor(max_workers=2)


def _capabilities() -> dict:
    sam = False
    checkpoint = os.environ.get("SAM_CHECKPOINT")
    if checkpoint and os.path.exists(checkpoint):
        try:
            import mobile_sam  # type: ignore[import-not-found]  # noqa: F401

            sam = True
        except ImportError:
            try:
                import segment_anything  # type: ignore[import-not-found]  # noqa: F401

                sam = True
            except ImportError:
                sam = False
    ocr = False
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        ocr = True
    except Exception:
        ocr = False
    return {
        "sam": sam,
        "ocr": ocr,
        "enrich": enrich_mod.is_available(),
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "capabilities": _capabilities()}


def _run_pipeline(
    job_id: str, image_bytes: bytes, max_layers: int, source_name: str
) -> None:
    try:
        store.update(job_id, stage="segmenting", progress=0.05)
        pre = preprocess(image_bytes)

        palette_hex, centroids = extract_palette(pre.rgb)
        store.update(job_id, progress=0.15)

        text_items, exclude = try_extract_text(pre.rgb)
        store.update(job_id, progress=0.25)

        seg_result = segment(pre.rgb, centroids, max_layers, exclude)
        store.update(job_id, stage="vectorizing", progress=0.4)

        vectorized = vectorize(
            pre.rgb,
            seg_result.segments,
            on_progress=lambda f: store.update(job_id, progress=0.4 + 0.45 * f),
        )

        store.update(job_id, stage="assembling", progress=0.9)
        scene = assemble(
            pre, palette_hex, seg_result, vectorized, text_items, source_name
        )
        thumbnail = None
        if enrich_mod.is_available():
            try:
                thumbnail = enrich_mod.make_thumbnail_b64(pre.rgb)
            except Exception:
                thumbnail = None
        store.update(
            job_id,
            status="done",
            progress=1.0,
            stage=None,
            scene=scene.model_dump(),
            engine=seg_result.engine,
            thumbnail_b64=thumbnail,
        )
    except Exception as exc:  # surface, never crash the worker thread
        store.update(job_id, status="error", error=str(exc), stage=None)


@app.post("/reconstruct", response_model=JobCreated)
async def reconstruct(
    image: UploadFile = File(...),
    max_layers: int = Form(default=24, ge=1, le=64),
) -> JobCreated:
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415, detail="image must be png or jpeg"
        )
    data = await image.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds 10MB")
    if not data:
        raise HTTPException(status_code=422, detail="empty upload")

    name = os.path.splitext(image.filename or "reconstructed")[0] or "reconstructed"
    job = store.create()
    _executor.submit(_run_pipeline, job.id, data, max_layers, name)
    return JobCreated(job_id=job.id)


@app.post("/jobs/{job_id}/enrich")
def enrich_job(job_id: str) -> dict:
    """Optional AI layer naming (SPEC §5 step 7) — 503 unless the
    anthropic package + ANTHROPIC_API_KEY are present."""
    if not enrich_mod.is_available():
        raise HTTPException(
            status_code=503,
            detail="enrich unavailable — install `anthropic` and set ANTHROPIC_API_KEY",
        )
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown or expired job")
    if job.status != "done" or not job.scene:
        raise HTTPException(status_code=409, detail="job is not done yet")
    try:
        result = enrich_mod.enrich_scene(job.scene, job.thumbnail_b64)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"naming failed: {exc}")
    # apply to a copy and swap it in under the store lock, so a re-poll
    # sees the new names without racing concurrent readers
    import copy

    updated = copy.deepcopy(job.scene)
    for layer in updated.get("layers", []):
        if layer["id"] in result["names"]:
            layer["name"] = result["names"][layer["id"]]
    store.update(job_id, scene=updated)
    return result


@app.get("/jobs/{job_id}", response_model=JobState, response_model_exclude_none=True)
def get_job(job_id: str) -> JobState:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown or expired job")
    return JobState(
        status=job.status,  # type: ignore[arg-type]
        progress=job.progress,
        stage=job.stage,  # type: ignore[arg-type]
        scene=job.scene,  # type: ignore[arg-type]
        engine=job.engine,  # type: ignore[arg-type]
        error=job.error,
    )
