# palmós reconstruction service

Stateless FastAPI service: screenshot in, editable scene-graph JSON out. The
editor works without it — reconstruction is the only feature that needs it.

```sh
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # http://localhost:8000
```

Runs end-to-end on the core dependencies alone. SAM, Tesseract OCR, and
Anthropic layer-naming are optional and imported lazily (see repo README).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{status, capabilities}` — `sam` / `ocr` / `enrich` booleans |
| POST | `/reconstruct` | multipart `image` (png/jpeg) + `max_layers` (1–64, default 24) → `{job_id}` |
| GET | `/jobs/{job_id}` | poll progress; scene + engine when `done` |
| POST | `/jobs/{job_id}/enrich` | optional AI layer naming (503 unless enabled) |

Uploads are validated by byte signature (not just the declared
content-type) and read in bounded chunks, so a mislabeled body is rejected
(415) and an oversize one never fully buffers in memory (413).

## Configuration

All optional; defaults reproduce the original localhost-only behavior.

| Env var | Default | Purpose |
|---|---|---|
| `RECONSTRUCT_MAX_UPLOAD_BYTES` | `10485760` (10 MB) | reject larger uploads with 413 |
| `RECONSTRUCT_JOB_TTL_S` | `3600` | how long finished jobs remain pollable |
| `RECONSTRUCT_WORKERS` | `2` | pipeline thread-pool size (per process) |
| `RECONSTRUCT_CORS_ORIGINS` | — | comma-separated exact origins; overrides the regex |
| `RECONSTRUCT_CORS_ORIGIN_REGEX` | localhost regex | fallback CORS origin pattern |
| `REDIS_URL` | — | activate the Redis-backed job store (see below) |
| `SAM_CHECKPOINT`, `SAM_MODEL_TYPE` | — | optional SAM segmentation |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | — | optional layer naming |

### Scaling beyond one worker

The default job store is in-memory and per-process. Under `uvicorn
--workers >1` a `POST /reconstruct` and its follow-up `GET /jobs/{id}` can
hit different workers and 404. Set `REDIS_URL` to activate the Redis-backed
store, which shares jobs across workers and survives restarts, then raise
the worker count. `redis` is imported only when `REDIS_URL` is set — it is
never a required dependency.

## Docker

```sh
docker build -t palmos-reconstruct .
docker run -p 8000:8000 palmos-reconstruct
```

The image ships the core pipeline only (single worker by default).

## Tests

```sh
pytest            # unit + API + pipeline
```
