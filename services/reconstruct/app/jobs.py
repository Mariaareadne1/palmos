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
"""

import json
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Optional, Protocol

from .config import Settings, get_settings


@dataclass
class Job:
    id: str
    status: str = "processing"  # processing | done | error
    progress: float = 0.0
    stage: Optional[str] = None  # segmenting | vectorizing | assembling
    scene: Optional[dict] = None
    engine: Optional[str] = None
    error: Optional[str] = None
    # small jpeg of the working image, for the optional enrich step —
    # never exposed through JobState
    thumbnail_b64: Optional[str] = None
    created_at: float = field(default_factory=time.time)


class JobStore(Protocol):
    """The surface main.py depends on. Two implementations below."""

    def create(self) -> Job: ...
    def get(self, job_id: str) -> Optional[Job]: ...
    def update(self, job_id: str, **fields: object) -> None: ...


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

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            self._prune()
            return self._jobs.get(job_id)

    def update(self, job_id: str, **fields: object) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for key, value in fields.items():
                setattr(job, key, value)

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

    def __init__(self, url: str, ttl_s: int, client: object | None = None) -> None:
        self._ttl_s = ttl_s
        if client is None:
            import redis  # lazy, optional dependency

            client = redis.Redis.from_url(url)
        self._r = client

    def _key(self, job_id: str) -> str:
        return f"{self._PREFIX}{job_id}"

    def create(self) -> Job:
        job = Job(id=uuid.uuid4().hex)
        self._r.setex(self._key(job.id), self._ttl_s, json.dumps(asdict(job)))
        return job

    def get(self, job_id: str) -> Optional[Job]:
        raw = self._r.get(self._key(job_id))
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return Job(**json.loads(raw))

    def update(self, job_id: str, **fields: object) -> None:
        key = self._key(job_id)
        raw = self._r.get(key)
        if raw is None:
            return
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        data = json.loads(raw)
        data.update(fields)
        # preserve the remaining TTL rather than resetting the clock
        remaining = self._r.ttl(key)
        ttl = remaining if isinstance(remaining, int) and remaining > 0 else self._ttl_s
        self._r.setex(key, ttl, json.dumps(data))


def build_store(settings: Settings) -> JobStore:
    if settings.redis_url:
        return RedisJobStore(settings.redis_url, settings.job_ttl_s)
    return InMemoryJobStore(settings.job_ttl_s)


store: JobStore = build_store(get_settings())
