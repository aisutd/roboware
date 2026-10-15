"""Tabular Q-learning per destination: the notebook's update rule on the warehouse grid."""

from __future__ import annotations

import random
from typing import Callable

import numpy as np

from .grid import ACTIONS, DELTAS, Layout
from .models import Cell, Hyperparameters

MODEL_FORMAT = "roboware-model/v2"
META_KEYS = ("id", "name", "layout_id", "layout_fingerprint", "version", "parent_model_id", "created_at", "updated_at")


def state_index(cell: Cell, width: int) -> int:
    return cell[1] * width + cell[0]


def dest_key(cell: Cell) -> str:
    return f"{cell[0]},{cell[1]}"


def parse_dest_key(key: str) -> Cell:
    x, y = key.split(",")
    return (int(x), int(y))


class QTableSet:
    """One (width*height x 4) Q-table per destination cell."""

    def __init__(self, width: int, height: int, tables: dict[Cell, np.ndarray] | None = None):
        self.width = width
        self.height = height
        self.tables: dict[Cell, np.ndarray] = dict(tables or {})

    def get(self, dest: Cell) -> np.ndarray | None:
        return self.tables.get(dest)

    def set(self, dest: Cell, table: np.ndarray) -> None:
        self.tables[dest] = table

    def destinations(self) -> list[Cell]:
        return sorted(self.tables, key=lambda c: (c[1], c[0]))

    def copy(self) -> "QTableSet":
        return QTableSet(self.width, self.height, {d: t.copy() for d, t in self.tables.items()})

    def __len__(self) -> int:
        return len(self.tables)


def greedy_action(row) -> int:
    return int(np.argmax(row))


def q_update(table, s: int, a: int, reward: float, s_next: int, finished: bool, alpha: float, gamma: float) -> None:
    target = reward if finished else reward + gamma * float(np.max(table[s_next]))
    table[s, a] += alpha * (target - table[s, a])


def _transitions(layout: Layout) -> list[list[int]]:
    """trans[s][a] = next state index; bumping into a wall or rack leaves the robot in place."""
    w = layout.width
    trans = []
    for y in range(layout.height):
        for x in range(w):
            row = []
            for dx, dy in DELTAS:
                n = (x + dx, y + dy)
                row.append(state_index(n, w) if layout.driveable(n) else y * w + x)
            trans.append(row)
    return trans


def train_destination(layout: Layout, dest: Cell, hp: Hyperparameters, rng: random.Random,
                      table: np.ndarray | None = None) -> tuple[np.ndarray, dict]:
    if not layout.driveable(dest):
        raise ValueError(f"Destination {dest} is not a driveable cell.")
    w = layout.width
    q = table.tolist() if table is not None else [[0.0] * 4 for _ in range(w * layout.height)]
    trans = _transitions(layout)
    goal = state_index(dest, w)
    starts = [state_index((x, y), w) for y in range(layout.height) for x in range(w)
              if layout.driveable((x, y)) and (x, y) != dest]
    alpha, gamma = hp.learning_rate, hp.discount_factor
    episodes = max(1, int(hp.episodes_per_destination))
    rewards: list[float] = []
    steps: list[int] = []
    for e in range(episodes):
        eps = hp.exploration_rate
        if hp.epsilon_decay and episodes > 1:
            eps = max(hp.epsilon_min, hp.exploration_rate - (hp.exploration_rate - hp.epsilon_min) * e / (episodes - 1))
        s = rng.choice(starts)
        total = 0.0
        n = 0
        for n in range(1, hp.max_steps + 1):
            row = q[s]
            if rng.random() < eps:
                a = rng.randrange(4)
            else:
                best = max(row)
                a = rng.choice([i for i in range(4) if row[i] == best])
            s2 = trans[s][a]
            finished = s2 == goal
            r = hp.goal_reward if finished else hp.step_reward
            target = r if finished else r + gamma * max(q[s2])
            row[a] += alpha * (target - row[a])
            total += r
            s = s2
            if finished:
                break
        rewards.append(total)
        steps.append(n)
    return np.array(q, dtype=float), {"rewards": rewards, "steps": steps}


def downsample(history: dict, max_points: int = 300) -> dict:
    rewards, steps = history["rewards"], history["steps"]
    n = len(rewards)
    if n <= max_points:
        return {"rewards": [round(v, 3) for v in rewards], "steps": list(steps), "episodes": n}
    bucket = n / max_points
    out_r, out_s = [], []
    for i in range(max_points):
        lo, hi = int(i * bucket), int((i + 1) * bucket)
        out_r.append(round(sum(rewards[lo:hi]) / (hi - lo), 3))
        out_s.append(round(sum(steps[lo:hi]) / (hi - lo), 2))
    return {"rewards": out_r, "steps": out_s, "episodes": n}


def train_model(layout: Layout, hp: Hyperparameters, destinations: list[Cell] | None = None, seed: int = 0,
                qtables: QTableSet | None = None,
                on_progress: Callable[[int, int, Cell, dict], None] | None = None) -> tuple[QTableSet, dict]:
    dests = list(destinations) if destinations else layout.destinations()
    result = qtables.copy() if qtables is not None else QTableSet(layout.width, layout.height)
    rng = random.Random(seed)
    histories: dict[str, dict] = {}
    for i, dest in enumerate(dests):
        table, history = train_destination(layout, dest, hp, rng, result.get(dest))
        result.set(dest, table)
        histories[dest_key(dest)] = downsample(history)
        if on_progress:
            on_progress(i + 1, len(dests), dest, histories[dest_key(dest)])
    return result, histories


def export_model(meta: dict, hp: Hyperparameters, qtables: QTableSet, histories: dict) -> dict:
    return {
        "format": MODEL_FORMAT,
        **{k: meta.get(k) for k in META_KEYS},
        "width": qtables.width,
        "height": qtables.height,
        "actions": list(ACTIONS),
        "step_reward": hp.step_reward,
        "goal_reward": hp.goal_reward,
        "discount_factor": hp.discount_factor,
        "hyperparameters": hp.to_dict(),
        "destinations": {
            dest_key(d): {"goal": [d[0], d[1]], "q_table": qtables.get(d).tolist()} for d in qtables.destinations()
        },
        "training_history": histories,
    }


def _check_table(rows, n_states: int) -> np.ndarray:
    try:
        arr = np.asarray(rows, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Q-table is not a numeric grid: {exc}") from exc
    if arr.shape != (n_states, 4):
        raise ValueError(f"Q-table must be {n_states} x 4, got {list(arr.shape)}.")
    return arr


def import_model(data, width: int = 16, height: int = 10) -> tuple[dict, Hyperparameters, QTableSet, dict]:
    if not isinstance(data, dict):
        raise ValueError("Model file must be a JSON object.")
    if "destinations" in data:
        w, h = int(data.get("width", width)), int(data.get("height", height))
        if not isinstance(data["destinations"], dict):
            raise ValueError('"destinations" must be an object keyed by "x,y".')
        qt = QTableSet(w, h)
        for key, entry in data["destinations"].items():
            try:
                dest = parse_dest_key(key)
            except ValueError as exc:
                raise ValueError(f'Bad destination key "{key}".') from exc
            qt.set(dest, _check_table(entry.get("q_table") if isinstance(entry, dict) else None, w * h))
        hp = Hyperparameters.from_dict(data.get("hyperparameters"))
        return {k: data.get(k) for k in META_KEYS}, hp, qt, data.get("training_history") or {}
    if "q_table" in data:
        table = _check_table(data["q_table"], width * height)
        goal = data.get("goal") or [14, 8]
        hp = Hyperparameters(
            step_reward=float(data.get("step_reward", -1)),
            goal_reward=float(data.get("goal_reward", 10)),
            discount_factor=float(data.get("discount_factor", 0.95)),
        )
        qt = QTableSet(width, height, {(int(goal[0]), int(goal[1])): table})
        return {"name": data.get("name") or "Imported model"}, hp, qt, {}
    raise ValueError('Model file needs a "destinations" or "q_table" field.')
