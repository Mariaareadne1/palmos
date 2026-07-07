"""In-memory job registry. Jobs are pruned lazily after a TTL so a
long-running local service doesn't accumulate scene graphs forever
(api-design-review recommendation)."""

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

JOB_TTL_S = 3600


@dataclass
class Job:
    id: str
    status: str = "processing"          # processing | done | error
    progress: float = 0.0
    stage: Optional[str] = None          # segmenting | vectorizing | assembling
    scene: Optional[dict] = None
    engine: Optional[str] = None
    error: Optional[str] = None
    # small jpeg of the working image, for the optional enrich step —
    # never exposed through JobState
    thumbnail_b64: Optional[str] = None
    created_at: float = field(default_factory=time.time)


class JobStore:
    def __init__(self) -> None:
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
        cutoff = time.time() - JOB_TTL_S
        for jid in [j for j, job in self._jobs.items() if job.created_at < cutoff]:
            del self._jobs[jid]


store = JobStore()
