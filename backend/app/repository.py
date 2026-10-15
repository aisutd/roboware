"""Load domain objects (layouts, models) from Storage."""

from __future__ import annotations

from .simulation.grid import Layout
from .simulation.models import Hyperparameters
from .simulation.q_learning import QTableSet, import_model
from .storage import Storage


def load_layout(storage: Storage, layout_id: str) -> Layout:
    return Layout.from_dict(storage.get_layout(layout_id)["layout"])


def load_model(storage: Storage, model_id: str) -> tuple[dict, Hyperparameters, QTableSet, dict]:
    row = storage.get_model(model_id)
    payload = storage.load_model_file(model_id)
    if payload is None:
        layout = load_layout(storage, row["layout_id"])
        return row, Hyperparameters.from_dict(row["hyperparameters"]), QTableSet(layout.width, layout.height), {}
    _, hp, qtables, histories = import_model(payload)
    return row, hp, qtables, histories


def model_meta(row: dict) -> dict:
    return {k: row.get(k) for k in ("id", "name", "layout_id", "layout_fingerprint", "version",
                                    "parent_model_id", "created_at", "updated_at")}
