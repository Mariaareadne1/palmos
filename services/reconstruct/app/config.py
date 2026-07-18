"""Runtime configuration, read once from the environment.

Keeps every tunable in one typed place instead of scattered module-level
constants, and makes CORS/limits environment-specific for non-local
deployment. Defaults preserve the original localhost-only behavior, so a
fresh clone with no env set behaves exactly as before.

No new dependencies (SPEC §0 rule 2): plain os.environ + a frozen
dataclass, cached once via get_settings().
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

# the editor runs on localhost:3000 by default; allow any localhost port so
# dev servers on 3001/3002 work too. Overridable for real deployments.
_DEFAULT_CORS_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    # a negative override is a misconfiguration, not a valid 0 — fall back
    return value if value >= 0 else default


def _csv_env(name: str) -> tuple[str, ...]:
    raw = os.environ.get(name, "")
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    """Immutable service configuration."""

    max_upload_bytes: int = 10 * 1024 * 1024
    # cap simultaneous in-flight uploads so N parallel reads can't buffer
    # N * max_upload_bytes at once (the executor only throttles processing,
    # which happens after the body is read)
    max_concurrent_reconstructs: int = 8
    job_ttl_s: int = 3600
    executor_workers: int = 2
    # CORS: explicit origins take precedence; otherwise the localhost regex.
    # Never combine wildcard origins with credentials (we send none).
    cors_allow_origins: tuple[str, ...] = ()
    cors_allow_origin_regex: str = _DEFAULT_CORS_REGEX
    # optional durable job store; empty => process-local in-memory store.
    redis_url: str = ""
    allowed_content_types: frozenset[str] = field(
        default_factory=lambda: frozenset({"image/png", "image/jpeg"})
    )


@lru_cache
def get_settings() -> Settings:
    return Settings(
        max_upload_bytes=_int_env("RECONSTRUCT_MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
        max_concurrent_reconstructs=max(
            1, _int_env("RECONSTRUCT_MAX_CONCURRENT", 8)
        ),
        job_ttl_s=_int_env("RECONSTRUCT_JOB_TTL_S", 3600),
        executor_workers=max(1, _int_env("RECONSTRUCT_WORKERS", 2)),
        cors_allow_origins=_csv_env("RECONSTRUCT_CORS_ORIGINS"),
        cors_allow_origin_regex=os.environ.get(
            "RECONSTRUCT_CORS_ORIGIN_REGEX", _DEFAULT_CORS_REGEX
        ),
        redis_url=os.environ.get("REDIS_URL", "").strip(),
    )
