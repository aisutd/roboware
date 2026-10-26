"""Persistence: SQLite for layouts, models, sessions and metrics; JSON files for Q-tables."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .errors import Forbidden, NotFound

SCHEMA = """
CREATE TABLE IF NOT EXISTS layouts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, layout_id TEXT NOT NULL, layout_fingerprint TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, parent_model_id TEXT, trained_destinations INTEGER NOT NULL DEFAULT 0,
    hyperparameters TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_trained_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, config TEXT NOT NULL, summary TEXT,
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS session_metrics (
    session_id TEXT NOT NULL, tick INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (session_id, tick));
CREATE TABLE IF NOT EXISTS orders (
    session_id TEXT NOT NULL, order_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (session_id, order_id));
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class Storage:
    def __init__(self, data_dir: Path | str):
        self.data_dir = Path(data_dir)
        self.models_dir = self.data_dir / "models"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.data_dir / "roboware.db", check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _exec(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def _rows(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def _one(self, sql: str, params: tuple, what: str) -> dict:
        rows = self._rows(sql, params)
        if not rows:
            raise NotFound(f"{what} not found")
        return rows[0]

    # -- layouts

    @staticmethod
    def _layout_row(row: dict) -> dict:
        row["is_default"] = bool(row["is_default"])
        row["layout"] = json.loads(row.pop("data"))
        return row

    def ensure_default_layout(self, layout: dict) -> None:
        """Seed the built-in warehouse, and refresh it when the code's version changes (e.g. new cell types)."""
        rows = self._rows("SELECT data FROM layouts WHERE id = 'default'")
        ts = now()
        if not rows:
            self._exec("INSERT INTO layouts VALUES ('default', ?, ?, 1, ?, ?)",
                       (layout.get("name", "Default warehouse"), json.dumps(layout), ts, ts))
        elif json.loads(rows[0]["data"]).get("fingerprint") != layout.get("fingerprint") or \
                json.loads(rows[0]["data"]).get("products") != layout.get("products"):
            self._exec("UPDATE layouts SET data = ?, updated_at = ? WHERE id = 'default'", (json.dumps(layout), ts))

    def list_layouts(self) -> list[dict]:
        return [dict(r, is_default=bool(r["is_default"])) for r in
                self._rows("SELECT id, name, is_default, updated_at FROM layouts ORDER BY is_default DESC, created_at")]

    def get_layout(self, layout_id: str) -> dict:
        return self._layout_row(self._one("SELECT * FROM layouts WHERE id = ?", (layout_id,), "Layout"))

    def create_layout(self, name: str, data: dict) -> str:
        lid, ts = new_id("lay"), now()
        self._exec("INSERT INTO layouts VALUES (?, ?, ?, 0, ?, ?)", (lid, name, json.dumps(data), ts, ts))
        return lid

    def update_layout(self, layout_id: str, name: str, data: dict) -> None:
        if self.get_layout(layout_id)["is_default"]:
            raise Forbidden("The default layout cannot be edited; use Save as.")
        self._exec("UPDATE layouts SET name = ?, data = ?, updated_at = ? WHERE id = ?",
                   (name, json.dumps(data), now(), layout_id))

    # -- models

    @staticmethod
    def _model_row(row: dict) -> dict:
        row["hyperparameters"] = json.loads(row["hyperparameters"])
        return row

    def create_model(self, name: str, layout_id: str, fingerprint: str, hp: dict,
                     parent_model_id: str | None = None, version: int = 1) -> str:
        mid, ts = new_id("mdl"), now()
        self._exec(
            "INSERT INTO models (id, name, layout_id, layout_fingerprint, version, parent_model_id, "
            "trained_destinations, hyperparameters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
            (mid, name, layout_id, fingerprint, version, parent_model_id, json.dumps(hp), ts, ts))
        return mid

    def list_models(self) -> list[dict]:
        return [self._model_row(r) for r in self._rows("SELECT * FROM models ORDER BY created_at DESC")]

    def get_model(self, model_id: str) -> dict:
        return self._model_row(self._one("SELECT * FROM models WHERE id = ?", (model_id,), "Model"))

    def update_model_after_training(self, model_id: str, trained_destinations: int, hp: dict,
                                    fingerprint: str | None = None) -> None:
        ts = now()
        self._exec("UPDATE models SET trained_destinations = ?, hyperparameters = ?, updated_at = ?, "
                   "last_trained_at = ? WHERE id = ?", (trained_destinations, json.dumps(hp), ts, ts, model_id))
        if fingerprint:
            self._exec("UPDATE models SET layout_fingerprint = ? WHERE id = ?", (fingerprint, model_id))

    def delete_model(self, model_id: str) -> None:
        self.get_model(model_id)
        self._exec("DELETE FROM models WHERE id = ?", (model_id,))
        (self.models_dir / f"{model_id}.json").unlink(missing_ok=True)

    def save_model_file(self, model_id: str, payload: dict) -> None:
        path = self.models_dir / f"{model_id}.json"
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(tmp, path)

    def load_model_file(self, model_id: str) -> dict | None:
        path = self.models_dir / f"{model_id}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    # -- sessions

    @staticmethod
    def _session_row(row: dict) -> dict:
        row["config"] = json.loads(row["config"])
        row["summary"] = json.loads(row["summary"]) if row["summary"] else None
        return row

    def create_session(self, name: str, config: dict) -> str:
        sid, ts = new_id("ses"), now()
        self._exec("INSERT INTO sessions (id, name, status, config, created_at, updated_at) "
                   "VALUES (?, ?, 'created', ?, ?, ?)", (sid, name, json.dumps(config), ts, ts))
        return sid

    def update_session(self, session_id: str, **fields) -> None:
        allowed = {"status", "summary", "ended_at", "error"}
        sets, params = [], []
        for key, value in fields.items():
            if key not in allowed:
                raise ValueError(f"Cannot update session field {key}")
            sets.append(f"{key} = ?")
            params.append(json.dumps(value) if key == "summary" and value is not None else value)
        sets.append("updated_at = ?")
        params.append(now())
        self._exec(f"UPDATE sessions SET {', '.join(sets)} WHERE id = ?", (*params, session_id))

    def list_sessions(self) -> list[dict]:
        return [self._session_row(r) for r in self._rows("SELECT * FROM sessions ORDER BY created_at DESC")]

    def get_session(self, session_id: str) -> dict:
        return self._session_row(self._one("SELECT * FROM sessions WHERE id = ?", (session_id,), "Session"))

    def add_metrics(self, session_id: str, rows: list[dict]) -> None:
        if not rows:
            return
        with self._lock:
            self._conn.executemany("INSERT OR REPLACE INTO session_metrics VALUES (?, ?, ?)",
                                   [(session_id, r["tick"], json.dumps(r)) for r in rows])
            self._conn.commit()

    def get_metrics(self, session_id: str) -> list[dict]:
        return [json.loads(r["data"]) for r in
                self._rows("SELECT data FROM session_metrics WHERE session_id = ? ORDER BY tick", (session_id,))]

    def save_orders(self, session_id: str, orders: list[dict]) -> None:
        with self._lock:
            self._conn.executemany("INSERT OR REPLACE INTO orders VALUES (?, ?, ?)",
                                   [(session_id, o["id"], json.dumps(o)) for o in orders])
            self._conn.commit()

    def get_orders(self, session_id: str) -> list[dict]:
        return [json.loads(r["data"]) for r in
                self._rows("SELECT data FROM orders WHERE session_id = ? ORDER BY order_id", (session_id,))]

    def mark_interrupted_sessions(self) -> None:
        self._exec("UPDATE sessions SET status = 'interrupted', updated_at = ? "
                   "WHERE status IN ('created', 'running', 'paused')", (now(),))
