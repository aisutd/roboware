"""Saved models: one JSON file per model under data/models/."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

SUMMARY_KEYS = ("id", "name", "goal", "created_at", "hyperparameters", "evaluation", "success_rate", "episodes")


class ModelNotFound(KeyError):
    pass


class ModelStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, model_id: str) -> Path:
        if not model_id or any(ch not in "0123456789abcdef" for ch in model_id):
            raise ModelNotFound(model_id)
        return self.root / f"{model_id}.json"

    def save(self, model: dict) -> dict:
        model = {**model, "id": uuid.uuid4().hex, "created_at": datetime.now(timezone.utc).isoformat()}
        path = self._path(model["id"])
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(model), encoding="utf-8")
        os.replace(tmp, path)  # never leave a half-written model behind
        return model

    def get(self, model_id: str) -> dict:
        path = self._path(model_id)
        if not path.exists():
            raise ModelNotFound(model_id)
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> list[dict]:
        models = []
        for path in self.root.glob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            models.append({k: data.get(k) for k in SUMMARY_KEYS})
        return sorted(models, key=lambda m: m["created_at"], reverse=True)

    def delete(self, model_id: str) -> None:
        path = self._path(model_id)
        if not path.exists():
            raise ModelNotFound(model_id)
        path.unlink()
