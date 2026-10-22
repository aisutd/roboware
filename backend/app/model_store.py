"""Saved models: one JSON file per model under data/models/.

A plain folder of JSON files is enough for this stage of the project. There's no database to
set up, the files are easy to inspect by hand, and models survive server restarts.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

# The fields shown in the model list. The full model also has the Q-table (160 x 4 numbers) and
# the training history, which are too heavy to send for every row of a list.
SUMMARY_KEYS = ("id", "name", "goal", "created_at", "hyperparameters", "evaluation", "success_rate", "episodes")


class ModelNotFound(KeyError):
    """Raised when a model ID doesn't match a saved file. The API turns this into a 404."""


class ModelStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        # Create the folder on first use, so a fresh checkout works without setup.
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, model_id: str) -> Path:
        """The file for a model ID.

        IDs are always lowercase hex (from uuid4().hex), so anything else is rejected. This is a
        security check too: it stops IDs like "../../secret" from reading files outside the folder.
        """
        if not model_id or any(ch not in "0123456789abcdef" for ch in model_id):
            raise ModelNotFound(model_id)
        return self.root / f"{model_id}.json"

    def save(self, model: dict) -> dict:
        """Store a new model, giving it a fresh ID and a creation time. Returns the saved dict."""
        model = {**model, "id": uuid.uuid4().hex, "created_at": datetime.now(timezone.utc).isoformat()}
        path = self._path(model["id"])
        # Write to a temporary file first, then rename it into place. The rename is atomic, so
        # if the server dies mid-write we lose only the temp file, never a corrupted model.
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(model), encoding="utf-8")
        os.replace(tmp, path)  # never leave a half-written model behind
        return model

    def get(self, model_id: str) -> dict:
        """The full model, including its Q-table and training history."""
        path = self._path(model_id)
        if not path.exists():
            raise ModelNotFound(model_id)
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> list[dict]:
        """Summaries of every saved model, newest first."""
        models = []
        for path in self.root.glob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            models.append({k: data.get(k) for k in SUMMARY_KEYS})
        # ISO-8601 timestamps sort correctly as plain strings.
        return sorted(models, key=lambda m: m["created_at"], reverse=True)

    def delete(self, model_id: str) -> None:
        path = self._path(model_id)
        if not path.exists():
            raise ModelNotFound(model_id)
        path.unlink()
