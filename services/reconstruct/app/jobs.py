"""Job registry.

Default is a process-local in-memory store: jobs are pruned lazily after a
TTL so a long-running local service doesn't accumulate scene graphs forever
(api-design-review recommendation). This is correct for the default
single-process deployment.

Under `uvicorn --workers >1` an in-memory store is not shared — a
POST /reconstruct and its follow-up GET /jobs/{id} can land on different
workers and 404. Set REDIS_URL to activate the optional Redis-backed store
so jobs survive across workers/restarts. `redis` is imported lazily and is
never required (SPEC §0 rule 2): with no REDIS_URL the service runs on the
core dependencies alone.

Both stores publish immutable snapshots: update() replaces the whole Job
under the lock rather than mutating fields in place, so a caller that holds
a reference (or reads several fields unlocked) can never observe a
half-updated object.
"""

import json
import logging
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field, replace
from typing import Protocol

from .config import Settings, get_settings
from .schemas import Engine, JobStage, JobStatus

logger = logging.getLogger("palmos.jobs")


@dataclass(frozen=True)
class Job:
    id: str
    status: JobStatus = "processing"
    progress: float = 0.0
    stage: JobStage | None = None
    scene: dict | None = None
    engine: Engine | None = None
    error: str | None = None
    # small jpeg of the working image, for the optional enrich step —
    # never exposed through JobState
    thumbnail_b64: str | None = None
    created_at: float = field(default_factory=time.time)


class JobStore(Protocol):
    """The surface main.py depends on. Two implementations below."""

    def create(self) -> Job: ...
    def get(self, job_id: str) -> Job | None: ...
    def update(self, job_id: str, **fields: object) -> None: ...


class _RedisLike(Protocol):
    """Minimal subset of redis.Redis this store uses (aids testability)."""

    def get(self, key: str) -> bytes | str | None: ...
    def setex(self, key: str, ttl: int, value: str) -> object: ...
    def ttl(self, key: str) -> int: ...


class InMemoryJobStore:
    """Process-local store. Fast, dependency-free, single-process only."""

    def __init__(self, ttl_s: int) -> None:
        self._ttl_s = ttl_s
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self) -> Job:
        job = Job(id=uuid.uuid4().hex)
        with self._lock:
            self._prune()
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            # expire this job on read without an O(n) scan on the hot path
            if job.created_at < time.time() - self._ttl_s:
                del self._jobs[job_id]
                return None
            return job

    def update(self, job_id: str, **fields: object) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            # replace() validates field names (unknown key -> TypeError) and
            # publishes a fresh immutable snapshot rather than mutating live
            self._jobs[job_id] = replace(job, **fields)

    def _prune(self) -> None:
        cutoff = time.time() - self._ttl_s
        for jid in [j for j, job in self._jobs.items() if job.created_at < cutoff]:
            del self._jobs[jid]


class RedisJobStore:
    """Redis-backed store so jobs survive across workers/restarts.

    Each job is a JSON blob under `palmos:job:{id}` with a TTL, mirroring the
    in-memory prune. There is a single writer per job (its pipeline thread,
    then the enrich endpoint after completion), so read-modify-write on
    update() is race-free in practice without a distributed lock. `client` is
    injectable for tests; production passes a redis URL.
    """

    _PREFIX = "palmos:job:"

    def __init__(
        self, url: str, ttl_s: int, client: _RedisLike | None = None
    ) -> None:
        self._ttl_s = ttl_s
        if client is None:
            import redis  # lazy, optional dependency

            client = redis.Redis.from_url(
                url, socket_connect_timeout=2, socket_timeout=5
            )
        self._r = client

    def _key(self, job_id: str) -> str:
        return f"{self._PREFIX}{job_id}"

    def create(self) -> Job:
        job = Job(id=uuid.uuid4().hex)
        self._r.setex(self._key(job.id), self._ttl_s, json.dumps(asdict(job)))
        return job

    def get(self, job_id: str) -> Job | None:
        raw = self._r.get(self._key(job_id))
        if raw is None:
            return None
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            return Job(**json.loads(raw))
        except (ValueError, TypeError) as exc:
            # corrupt or schema-drifted payload — treat as unknown, don't 500
            logger.warning("dropping unreadable job %s: %s", job_id, exc)
            return None

    def update(self, job_id: str, **fields: object) -> None:
        key = self._key(job_id)
        current = self.get(job_id)
        if current is None:
            return
        data = asdict(replace(current, **fields))
        # preserve the remaining TTL rather than resetting the clock
        remaining = self._r.ttl(key)
        ttl = remaining if isinstance(remaining, int) and remaining > 0 else self._ttl_s
        self._r.setex(key, ttl, json.dumps(data))


def build_store(settings: Settings) -> JobStore:
    if settings.redis_url:
        return RedisJobStore(settings.redis_url, settings.job_ttl_s)
    return InMemoryJobStore(settings.job_ttl_s)


store: JobStore = build_store(get_settings())
