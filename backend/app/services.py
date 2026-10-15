"""Process-wide service objects, created once in the app lifespan."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import Request

from .simulation.grid import default_layout
from .storage import Storage
from .training import TrainingJobManager


@dataclass
class Services:
    storage: Storage
    training: TrainingJobManager
    sessions: Any = None  # SessionManager (added in Task 10)

    @classmethod
    def create(cls, data_dir: Path) -> "Services":
        storage = Storage(data_dir)
        storage.ensure_default_layout(default_layout().to_dict())
        storage.mark_interrupted_sessions()
        return cls(storage, TrainingJobManager(storage))

    async def shutdown(self) -> None:
        if self.sessions is not None:
            await self.sessions.shutdown()
        self.training.shutdown()
        self.storage.close()


def get_services(request: Request) -> Services:
    return request.app.state.services
