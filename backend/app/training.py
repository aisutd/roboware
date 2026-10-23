"""Background training jobs: run train_model in a worker thread and expose progress."""

from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .errors import Conflict, NotFound
from .repository import load_layout, load_model, model_meta
from .simulation.models import Cell, Hyperparameters
from .simulation.q_learning import dest_key, export_model, train_model
from .storage import Storage, now

log = logging.getLogger("roboware.training")


@dataclass
class TrainingJob:
    id: str
    model_id: str
    total: int
    status: str = "queued"
    done: int = 0
    current: Cell | None = None
    curves: dict = field(default_factory=dict)
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "model_id": self.model_id,
            "status": self.status,
            "done": self.done,
            "total": self.total,
            "progress": round(self.done / self.total, 3) if self.total else 1.0,
            "current_destination": list(self.current) if self.current else None,
            "curves": dict(self.curves),
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class TrainingJobManager:
    def __init__(self, storage: Storage):
        self.storage = storage
        self.jobs: dict[str, TrainingJob] = {}
        self._active: dict[str, str] = {}  # model_id -> job_id
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="train")

    def start(self, model_id: str, hp: Hyperparameters, destinations: list[Cell] | None, seed: int) -> TrainingJob:
        row = self.storage.get_model(model_id)
        layout = load_layout(self.storage, row["layout_id"])
        valid = layout.destinations()
        if destinations:
            unknown = [d for d in destinations if d not in valid]
            if unknown:
                raise ValueError(f"Not destinations in this layout: {unknown}")
            dests = list(destinations)
        else:
            dests = valid
        with self._lock:
            active = self._active.get(model_id)
            if active and self.jobs[active].status in ("queued", "running"):
                raise Conflict("This model is already training.")
            job = TrainingJob(id=f"job_{uuid.uuid4().hex[:10]}", model_id=model_id, total=len(dests))
            self.jobs[job.id] = job
            self._active[model_id] = job.id
        self._executor.submit(self._run, job, layout, hp, dests, seed)
        return job

    def get(self, job_id: str) -> TrainingJob:
        job = self.jobs.get(job_id)
        if job is None:
            raise NotFound("Training job not found")
        return job

    def _run(self, job: TrainingJob, layout, hp: Hyperparameters, dests: list[Cell], seed: int) -> None:
        job.status, job.started_at = "running", now()
        try:
            row, _, qtables, histories = load_model(self.storage, job.model_id)

            def progress(done: int, _total: int, dest: Cell, history: dict) -> None:
                job.done, job.current = done, dest
                job.curves[dest_key(dest)] = history

            qtables, new_histories = train_model(layout, hp, dests, seed, qtables, progress)
            histories.update(new_histories)
            self.storage.save_model_file(job.model_id, export_model(model_meta(row), hp, qtables, histories))
            self.storage.update_model_after_training(job.model_id, len(qtables), hp.to_dict())
            job.status = "completed"
        except Exception as exc:  # report any failure on the job; the saved model is untouched
            log.exception("training job %s failed", job.id)
            job.status, job.error = "failed", str(exc)
        finally:
            job.finished_at = now()

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
