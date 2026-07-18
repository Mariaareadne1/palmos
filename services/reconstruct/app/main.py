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

import asyncio
import copy
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from . import enrich as enrich_mod
from .config import get_settings
from .jobs import store
from .pipeline.assemble import assemble
from .pipeline.ocr import try_extract_text
from .pipeline.palette import extract_palette
from .pipeline.preprocess import preprocess
from .pipeline.segment import segment
from .pipeline.vectorize import vectorize
from .schemas import JobCreated, JobState

logger = logging.getLogger("palmos.reconstruct")
settings = get_settings()

# bound simultaneous in-flight uploads so N parallel reads can't buffer
# N * max_upload_bytes before the executor ever throttles processing
_reconstruct_semaphore = asyncio.Semaphore(settings.max_concurrent_reconstructs)

# byte signatures for the formats we accept, so a mislabeled or non-image
# body is rejected on content rather than on the client-declared type alone
_MAGIC_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)

app = FastAPI(title="palmos-reconstruct", version="0.1.0")

_cors_kwargs: dict[str, object] = {"allow_methods": ["*"], "allow_headers": ["*"]}
if settings.cors_allow_origins:
    _cors_kwargs["allow_origins"] = list(settings.cors_allow_origins)
else:
    _cors_kwargs["allow_origin_regex"] = settings.cors_allow_origin_regex
app.add_middleware(CORSMiddleware, **_cors_kwargs)

_executor = ThreadPoolExecutor(max_workers=settings.executor_workers)


def _sniff_image_type(data: bytes) -> str | None:
    """Return the real image type from the leading bytes, or None."""
    for signature, mime in _MAGIC_SIGNATURES:
        if data.startswith(signature):
            return mime
    return None


async def _read_bounded(image: UploadFile, limit: int) -> bytes:
    """Read the upload in chunks, aborting with 413 the moment it exceeds
    `limit` — so an oversize body is never fully buffered in memory."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await image.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=413, detail="image exceeds size limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _capabilities() -> dict[str, bool]:
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
def health() -> dict[str, object]:
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
    except Exception:  # surface, never crash the worker thread
        logger.exception("reconstruction failed for job %s", job_id)
        store.update(job_id, status="error", error="reconstruction failed", stage=None)


@app.post("/reconstruct", response_model=JobCreated)
async def reconstruct(
    image: UploadFile = File(...),
    max_layers: int = Form(default=24, ge=1, le=64),
) -> JobCreated:
    if image.content_type not in settings.allowed_content_types:
        raise HTTPException(status_code=415, detail="image must be png or jpeg")
    async with _reconstruct_semaphore:
        data = await _read_bounded(image, settings.max_upload_bytes)
        if not data:
            raise HTTPException(status_code=422, detail="empty upload")
        # defend against a mislabeled or non-image body: the actual bytes must
        # match one of the accepted formats, not just the declared content-type
        if _sniff_image_type(data) is None:
            raise HTTPException(
                status_code=415, detail="upload is not a valid png or jpeg image"
            )
        name = (
            os.path.splitext(image.filename or "reconstructed")[0] or "reconstructed"
        )
        # store.create() may do blocking Redis I/O — keep it off the event loop
        job = await run_in_threadpool(store.create)
    _executor.submit(_run_pipeline, job.id, data, max_layers, name)
    return JobCreated(job_id=job.id)


@app.post("/jobs/{job_id}/enrich")
def enrich_job(job_id: str) -> dict[str, object]:
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
    except Exception:
        logger.exception("layer naming failed for job %s", job_id)
        raise HTTPException(status_code=502, detail="naming failed")
    # apply names to a fresh copy and publish it, so a re-poll sees the new
    # names without racing concurrent readers
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
        status=job.status,
        progress=job.progress,
        stage=job.stage,
        scene=job.scene,
        engine=job.engine,
        error=job.error,
    )
