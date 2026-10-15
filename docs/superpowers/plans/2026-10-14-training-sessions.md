# RoboWare Training & Automated Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move RoboWare's simulation into a FastAPI backend that trains per-destination Q-learning models, runs automated multi-robot warehouse sessions (multi-item orders → pick → pack → ship), stores results in SQLite, and streams live state to a React UI with Models, Session, Layouts and History & Compare views.

**Architecture:** A pure, deterministic Python simulation core (`backend/app/simulation/`) has no I/O. Service classes wrap it: `Storage` (SQLite plus model JSON files), `TrainingJobManager` (a thread pool), and `SessionManager` (one asyncio task per live session, broadcasting over a WebSocket). FastAPI routers expose them under `/api`. The React frontend talks REST for commands and a WebSocket for live frames, and reuses the existing claymorphism components.

**Tech Stack:** Python 3.14 (local) / 3.13 (Docker), FastAPI, uvicorn, NumPy, stdlib `sqlite3`, pytest; React 19, Vite 8, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-training-sessions-design.md`

## Global Constraints

- **Never `git push`, never open a PR, never touch the remote.** Commit locally on `feature/training-sessions` only.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Grid default 16×10; state index `y*W + x`; actions `[up, down, left, right]` with deltas `(0,-1),(0,1),(-1,0),(1,0)`.
- Default hyperparameters: α 0.1, γ 0.95, ε 0.3, ε-decay off (ε_min 0.05), step reward −1, goal reward +10, 3000 episodes per destination, 200 max steps.
- Battery: −0.8% per step, −0.1% per wait, charge below 20%, dispatch only above 35%, +5% per tick at a charger, critical below 10%.
- Picking takes 1 tick; packing takes 3 ticks, one robot per station.
- Collision priority: battery < 10%, then rush order, then carrying, then robot index. More than 3 waits triggers a re-plan around robots.
- 1–8 robots per session (default 4). Session speeds 1×, 2×, 5×, 10×, max; 1× = 600 ms per tick; at most 20 WebSocket frames per second.
- Compare: at most 6 runs, at most 5000 ticks per run.
- Data lives in `backend/data/` (git-ignored). The backend listens on port 8080 and the frontend on 5173, which proxies `/api` (including WebSockets) to the backend.
- No new runtime dependencies. The frontend adds only `vitest` (dev). The backend uses what is already in `requirements.txt`; if a pin will not install on Python 3.14, bump only that pin to the nearest release that installs.
- Backend commands run from `backend/` with the venv's Python: `.venv\Scripts\python.exe -m pytest`. Frontend commands run from `frontend/`.

## Review Focus

These are inputs the spec implies but no task's main tests exercise. Each line has a pinning test in the task named.

1. **Head-on deadlock in a 1-wide aisle** (x = 3, 6, 9, 12 between racks). Two robots facing each other must not freeze forever; one sidesteps after 3 waits. *Pinned in Task 7, `test_head_on_robots_in_one_wide_aisle_get_past_each_other`.*
2. **Low battery with an assigned order but nothing picked yet.** The order must go back to `queued` with its stock reservation released, not vanish. *Pinned in Task 7, `test_low_battery_before_first_pick_requeues_order`.*
3. **Model trained on a different layout, or not trained at all.** Starting a session must succeed with a warning; unknown destinations fall back to A\*. *Pinned in Task 10, `test_session_with_untrained_model_warns`.*
4. **WebSocket for a session that is not live** (finished on a previous server run, or a bad id). It must close with code 4404 so the client stops reconnecting. *Pinned in Task 10, `test_stream_unknown_session_closes_4404`.*
5. **Importing a malformed model file** (wrong shape, wrong type, legacy format). It returns a clear 400, never a 500. *Pinned in Task 9, `test_import_rejects_malformed_model`.*

---

### Task 1: Backend test setup, warehouse layout and products

**Files:**
- Create: `backend/pytest.ini`
- Rename: `backend/app/simulation/init.py` → `backend/app/simulation/__init__.py`
- Rename: `backend/app/tests/test-astar.py` → `backend/app/tests/test_astar.py` (it is empty; Task 2 fills it in)
- Create: `backend/app/tests/__init__.py` (empty)
- Modify: `backend/app/simulation/models.py` (currently empty)
- Modify: `backend/app/simulation/grid.py` (currently empty)
- Test: `backend/app/tests/test_grid.py` (currently empty)

**Interfaces:**
- Produces:
  - `Cell = tuple[int, int]`
  - `Product(sku, name, face: Cell, stock: int)` with `to_dict()` and `Product.from_dict(d)`
  - Constants `AISLE, RACK, PACKING, DOCK, CHARGER, CELL_TYPES, ACTIONS, DELTAS`
  - `Layout(width, height, cells, products, name)`, whose methods are:
    - `in_bounds(c)`, `cell_type(c)`, `driveable(c)`, `neighbors(c)`
    - `cells_of(kind)`, `pick_faces()`, `destinations()`, `fingerprint()`
    - `reachable_from(c)`, `validate()`, `to_dict()`, `Layout.from_dict(d)`
  - `LayoutError(message, unreachable)`, `assign_products(layout)`, `default_layout()`

All cell lists are in row-major order (y, then x).

- [ ] **Step 1: Create the venv and confirm the pinned requirements install**

Run (from `backend/`):
```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```
Expected: installs cleanly. If one pin fails to build on Python 3.14, change only that line to the newest release that installs, re-run, and mention it in the commit message.

- [ ] **Step 2: Add the pytest config and fix the module and test file names**

`backend/pytest.ini`:
```ini
[pytest]
testpaths = app/tests
pythonpath = .
markers =
    slow: long-running acceptance tests (run with -m slow)
addopts = -m "not slow"
```
Run:
```
git mv backend/app/simulation/init.py backend/app/simulation/__init__.py
git mv backend/app/tests/test-astar.py backend/app/tests/test_astar.py
```
Create `backend/app/tests/__init__.py` as an empty file.

- [ ] **Step 3: Write the failing tests** — `backend/app/tests/test_grid.py`:

```python
import pytest

from app.simulation.grid import (
    CHARGER,
    DOCK,
    PACKING,
    RACK,
    Layout,
    LayoutError,
    default_layout,
)


def test_default_layout_matches_original_coordinates():
    layout = default_layout()
    assert (layout.width, layout.height) == (16, 10)
    assert len(layout.cells_of(RACK)) == 36
    assert layout.cell_type((4, 1)) == RACK
    assert layout.cell_type((11, 7)) == RACK
    assert layout.cells_of(PACKING) == [(14, 2), (14, 5)]
    assert layout.cells_of(DOCK) == [(14, 8)]
    assert layout.cells_of(CHARGER) == [(0, 2), (0, 7)]


def test_pick_faces_are_aisle_cells_next_to_racks():
    faces = default_layout().pick_faces()
    assert len(faces) == 42
    assert (3, 1) in faces and (6, 4) in faces and (12, 7) in faces and (4, 0) in faces
    assert (0, 0) not in faces
    assert (4, 1) not in faces  # a rack, not a face


def test_default_products_sit_on_distinct_faces():
    layout = default_layout()
    assert len(layout.products) == 24
    assert len({p.face for p in layout.products}) == 24
    assert all(20 <= p.stock <= 40 for p in layout.products)
    assert layout.products[0].sku == "SKU-001"
    assert len(layout.destinations()) == 29  # 24 faces + 2 packing + 1 dock + 2 chargers


def test_driveable_and_neighbors():
    layout = default_layout()
    assert layout.driveable((0, 0))
    assert not layout.driveable((4, 1))
    assert not layout.driveable((-1, 0))
    assert not layout.driveable((16, 0))
    assert set(layout.neighbors((3, 1))) == {(3, 0), (3, 2), (2, 1)}


def test_fingerprint_is_stable_and_tracks_cells():
    a, b = default_layout(), default_layout()
    assert a.fingerprint() == b.fingerprint()
    b.cells[0][0] = RACK
    assert a.fingerprint() != b.fingerprint()


def test_validate_rejects_sealed_off_dock():
    layout = default_layout()
    layout.validate()
    for x, y in [(13, 8), (15, 8), (14, 7), (14, 9)]:
        layout.cells[y][x] = RACK
    with pytest.raises(LayoutError) as err:
        layout.validate()
    assert (14, 8) in err.value.unreachable


def test_validate_requires_a_dock():
    layout = default_layout()
    layout.cells[8][14] = "aisle"
    with pytest.raises(LayoutError, match="shipping dock"):
        layout.validate()


def test_dict_roundtrip_and_bad_cell_type():
    layout = default_layout()
    again = Layout.from_dict(layout.to_dict())
    assert again.fingerprint() == layout.fingerprint()
    assert [p.to_dict() for p in again.products] == [p.to_dict() for p in layout.products]
    data = layout.to_dict()
    data["cells"][0][0] = "lava"
    with pytest.raises(LayoutError, match="Unknown cell type"):
        Layout.from_dict(data)
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_grid.py -q`
Expected: collection error, `ImportError` (cannot import `CHARGER`).

- [ ] **Step 5: Implement** — `backend/app/simulation/models.py`:

```python
"""Plain data objects shared by the simulation modules."""

from __future__ import annotations

from dataclasses import dataclass

Cell = tuple[int, int]


@dataclass
class Product:
    sku: str
    name: str
    face: Cell
    stock: int

    def to_dict(self) -> dict:
        return {"sku": self.sku, "name": self.name, "face": list(self.face), "stock": self.stock}

    @classmethod
    def from_dict(cls, data: dict) -> "Product":
        face = data["face"]
        return cls(str(data["sku"]), str(data["name"]), (int(face[0]), int(face[1])), int(data["stock"]))
```

`backend/app/simulation/grid.py`:

```python
"""Warehouse floor layout: cell types, pick faces, destinations and validation."""

from __future__ import annotations

import hashlib
from collections import deque
from dataclasses import dataclass, field

from .models import Cell, Product

AISLE = "aisle"
RACK = "rack"
PACKING = "packing"
DOCK = "dock"
CHARGER = "charger"
CELL_TYPES = (AISLE, RACK, PACKING, DOCK, CHARGER)

# Same action order as the notebook and the original JS engine.
ACTIONS = ("up", "down", "left", "right")
DELTAS = ((0, -1), (0, 1), (-1, 0), (1, 0))

DEFAULT_WIDTH = 16
DEFAULT_HEIGHT = 10
DEFAULT_RACKS = [(x, y) for x0 in (4, 7, 10) for x in (x0, x0 + 1) for y in (1, 2, 3, 5, 6, 7)]
DEFAULT_PACKING = [(14, 2), (14, 5)]
DEFAULT_DOCKS = [(14, 8)]
DEFAULT_CHARGERS = [(0, 2), (0, 7)]

PRODUCT_NAMES = [
    "Wireless Mouse", "USB-C Cable", "Desk Lamp", "Notebook Pack", "Water Bottle", "Headphones",
    "Phone Case", "Power Bank", "Keyboard", "Monitor Stand", "Webcam", "Backpack",
    "Coffee Mug", "Sticky Notes", "Pen Set", "HDMI Adapter", "Mouse Pad", "LED Strip",
    "Bluetooth Speaker", "Smart Plug", "Tape Roll", "Scissors", "Stapler", "Desk Organizer",
]


class LayoutError(ValueError):
    """A layout that cannot be used; `unreachable` lists cells robots cannot get to."""

    def __init__(self, message: str, unreachable: list[Cell] | None = None):
        super().__init__(message)
        self.unreachable = unreachable or []


@dataclass
class Layout:
    width: int
    height: int
    cells: list[list[str]]  # cells[y][x]
    products: list[Product] = field(default_factory=list)
    name: str = "Untitled layout"

    def in_bounds(self, c: Cell) -> bool:
        return 0 <= c[0] < self.width and 0 <= c[1] < self.height

    def cell_type(self, c: Cell) -> str:
        return self.cells[c[1]][c[0]]

    def driveable(self, c: Cell) -> bool:
        return self.in_bounds(c) and self.cell_type(c) != RACK

    def neighbors(self, c: Cell) -> list[Cell]:
        return [(c[0] + dx, c[1] + dy) for dx, dy in DELTAS if self.driveable((c[0] + dx, c[1] + dy))]

    def cells_of(self, kind: str) -> list[Cell]:
        return [(x, y) for y in range(self.height) for x in range(self.width) if self.cells[y][x] == kind]

    def pick_faces(self) -> list[Cell]:
        faces = []
        for x, y in self.cells_of(AISLE):
            for dx, dy in DELTAS:
                n = (x + dx, y + dy)
                if self.in_bounds(n) and self.cell_type(n) == RACK:
                    faces.append((x, y))
                    break
        return faces

    def destinations(self) -> list[Cell]:
        stocked = {p.face for p in self.products}
        dests = [c for c in self.pick_faces() if c in stocked]
        return dests + self.cells_of(PACKING) + self.cells_of(DOCK) + self.cells_of(CHARGER)

    def fingerprint(self) -> str:
        rows = ";".join(",".join(row) for row in self.cells)
        return hashlib.sha256(f"{self.width}x{self.height}:{rows}".encode()).hexdigest()

    def reachable_from(self, start: Cell) -> set[Cell]:
        seen = {start}
        queue = deque([start])
        while queue:
            for n in self.neighbors(queue.popleft()):
                if n not in seen:
                    seen.add(n)
                    queue.append(n)
        return seen

    def validate(self) -> None:
        for kind, label in ((PACKING, "packing station"), (DOCK, "shipping dock"), (CHARGER, "charger")):
            if not self.cells_of(kind):
                raise LayoutError(f"Layout needs at least one {label}.")
        faces = set(self.pick_faces())
        misplaced = [p.sku for p in self.products if p.face not in faces]
        if misplaced:
            raise LayoutError(f"Products are not on a pick face: {', '.join(misplaced)}")
        reach = self.reachable_from(self.cells_of(CHARGER)[0])
        unreachable = [c for c in self.destinations() if c not in reach]
        if unreachable:
            raise LayoutError("Some destinations cannot be reached from the chargers.", unreachable)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "width": self.width,
            "height": self.height,
            "cells": [list(row) for row in self.cells],
            "products": [p.to_dict() for p in self.products],
            "pick_faces": [list(c) for c in self.pick_faces()],
            "destinations": [list(c) for c in self.destinations()],
            "fingerprint": self.fingerprint(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Layout":
        width, height = int(data["width"]), int(data["height"])
        cells = data["cells"]
        if len(cells) != height or any(len(row) != width for row in cells):
            raise LayoutError(f"cells must be {height} rows of {width} entries.")
        for row in cells:
            for kind in row:
                if kind not in CELL_TYPES:
                    raise LayoutError(f"Unknown cell type: {kind}")
        products = [Product.from_dict(p) for p in data.get("products") or []]
        return cls(width, height, [list(row) for row in cells], products, data.get("name", "Untitled layout"))


def assign_products(layout: Layout, count: int = 24) -> list[Product]:
    """Spread `count` products evenly over the layout's pick faces (one product per face)."""
    faces = layout.pick_faces()
    count = min(count, len(faces), len(PRODUCT_NAMES))
    return [
        Product(
            sku=f"SKU-{i + 1:03d}",
            name=PRODUCT_NAMES[i],
            face=faces[(i * len(faces)) // count],
            stock=20 + (i * 7) % 21,
        )
        for i in range(count)
    ]


def default_layout() -> Layout:
    cells = [[AISLE] * DEFAULT_WIDTH for _ in range(DEFAULT_HEIGHT)]
    for kind, coords in ((RACK, DEFAULT_RACKS), (PACKING, DEFAULT_PACKING), (DOCK, DEFAULT_DOCKS), (CHARGER, DEFAULT_CHARGERS)):
        for x, y in coords:
            cells[y][x] = kind
    layout = Layout(DEFAULT_WIDTH, DEFAULT_HEIGHT, cells, name="Default warehouse")
    layout.products = assign_products(layout)
    return layout
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_grid.py -q`
Expected: `8 passed`.

- [ ] **Step 7: Commit**

```
git add backend/pytest.ini backend/app/tests/__init__.py backend/app/simulation backend/app/tests/test_grid.py backend/app/tests/test_astar.py backend/requirements.txt
git commit -m "feat(backend): warehouse layout, pick faces and default products"
```

---

### Task 2: A\* paths and distance maps

**Files:**
- Modify: `backend/app/simulation/astar.py` (empty)
- Test: `backend/app/tests/test_astar.py` (empty)

**Interfaces:**
- Consumes: `Layout`, `Cell` (Task 1).
- Produces:
  - `manhattan(a, b) -> int`
  - `find_path(layout, start, goal, blocked=frozenset()) -> list[Cell] | None`. The path includes both `start` and `goal`. A path from a cell to itself is `[start]`.
  - `distance_map(layout, target) -> dict[Cell, int]`: BFS step counts to `target` from every reachable cell.

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_astar.py`:

```python
from app.simulation.astar import distance_map, find_path, manhattan
from app.simulation.grid import RACK, default_layout


def test_open_route_is_manhattan_length():
    path = find_path(default_layout(), (0, 0), (14, 8))
    assert path[0] == (0, 0) and path[-1] == (14, 8)
    assert len(path) - 1 == 22
    assert all(manhattan(a, b) == 1 for a, b in zip(path, path[1:]))


def test_route_goes_around_a_rack_bay():
    path = find_path(default_layout(), (3, 2), (6, 2))
    assert len(path) - 1 == 7
    assert all(default_layout().driveable(c) for c in path)


def test_no_path_into_a_rack_or_sealed_cell():
    layout = default_layout()
    assert find_path(layout, (0, 0), (4, 1)) is None
    for x, y in [(13, 8), (15, 8), (14, 7), (14, 9)]:
        layout.cells[y][x] = RACK
    assert find_path(layout, (0, 0), (14, 8)) is None


def test_blocked_cells_are_avoided():
    path = find_path(default_layout(), (0, 0), (2, 0), blocked=frozenset({(1, 0)}))
    assert (1, 0) not in path
    assert len(path) - 1 == 4


def test_same_cell_path():
    assert find_path(default_layout(), (2, 2), (2, 2)) == [(2, 2)]


def test_distance_map_agrees_with_find_path():
    layout = default_layout()
    dist = distance_map(layout, (14, 8))
    assert dist[(14, 8)] == 0
    assert dist[(0, 0)] == 22
    assert dist[(3, 2)] == len(find_path(layout, (3, 2), (14, 8))) - 1
    assert (4, 1) not in dist
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_astar.py -q`
Expected: `ImportError`.

- [ ] **Step 3: Implement** — `backend/app/simulation/astar.py`:

```python
"""Grid search on a Layout: A* paths and BFS distance maps."""

from __future__ import annotations

import heapq
from collections import deque

from .grid import Layout
from .models import Cell


def manhattan(a: Cell, b: Cell) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def find_path(layout: Layout, start: Cell, goal: Cell, blocked: frozenset | set = frozenset()) -> list[Cell] | None:
    """Shortest 4-connected path from start to goal (both included), or None if unreachable."""
    if start == goal:
        return [start]
    if not layout.driveable(goal) or goal in blocked:
        return None
    came_from: dict[Cell, Cell | None] = {start: None}
    g_score = {start: 0}
    heap = [(manhattan(start, goal), 0, start)]
    while heap:
        _, g, current = heapq.heappop(heap)
        if current == goal:
            break
        if g > g_score[current]:
            continue
        for n in layout.neighbors(current):
            if n in blocked:
                continue
            if g + 1 < g_score.get(n, 1 << 30):
                g_score[n] = g + 1
                came_from[n] = current
                heapq.heappush(heap, (g + 1 + manhattan(n, goal), g + 1, n))
    else:
        return None
    path = []
    cell: Cell | None = goal
    while cell is not None:
        path.append(cell)
        cell = came_from[cell]
    return path[::-1]


def distance_map(layout: Layout, target: Cell) -> dict[Cell, int]:
    """Step distance from every reachable cell to `target`."""
    if not layout.driveable(target):
        return {}
    dist = {target: 0}
    queue = deque([target])
    while queue:
        cell = queue.popleft()
        for n in layout.neighbors(cell):
            if n not in dist:
                dist[n] = dist[cell] + 1
                queue.append(n)
    return dist
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_astar.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/simulation/astar.py backend/app/tests/test_astar.py
git commit -m "feat(backend): A* pathfinding and BFS distance maps"
```

---

### Task 3: Q-learning per destination

**Files:**
- Modify: `backend/app/simulation/models.py` (append `Hyperparameters`)
- Modify: `backend/app/simulation/q_learning.py` (empty)
- Create: `backend/app/tests/test_q_learning.py`

**Interfaces:**
- Consumes: `Layout`, `ACTIONS`, `DELTAS`, `default_layout` (Task 1); `distance_map` (Task 2, tests only).
- Produces:
  - `Hyperparameters` (fields as in Global Constraints), with `to_dict()` and `Hyperparameters.from_dict(d)` (unknown keys are ignored).
  - `state_index(cell, width) -> int`; `dest_key(cell) -> "x,y"`; `parse_dest_key(str) -> Cell`.
  - `QTableSet(width, height, tables=None)`, with `get(dest) -> np.ndarray | None`, `set(dest, table)`, `destinations()`, `copy()` and `len()`.
  - `greedy_action(row) -> int`, the first index of the maximum.
  - `q_update(table, s, a, reward, s_next, finished, alpha, gamma)`.
  - `train_destination(layout, dest, hp, rng, table=None) -> (np.ndarray, {"rewards": [...], "steps": [...]})`.
  - `train_model(layout, hp, destinations=None, seed=0, qtables=None, on_progress=None) -> (QTableSet, {dest_key: downsampled history})`. `on_progress(done, total, dest, history)` is called after each destination.
  - `downsample(history, max_points=300) -> {"rewards", "steps", "episodes"}`.
  - `export_model(meta, hp, qtables, histories) -> dict` and `import_model(data, width=16, height=10) -> (meta, hp, QTableSet, histories)`. Import raises `ValueError` on a bad file.

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_q_learning.py`:

```python
import json
import random

import numpy as np
import pytest

from app.simulation.astar import distance_map
from app.simulation.grid import DELTAS, default_layout
from app.simulation.models import Hyperparameters
from app.simulation.q_learning import (
    QTableSet,
    export_model,
    greedy_action,
    import_model,
    q_update,
    state_index,
    train_destination,
    train_model,
)


def test_update_rule_matches_notebook_numbers():
    # base_reference_model.ipynb: 5 cells, goal at 4, actions [left, right], alpha 0.1, gamma 0.95.
    q = np.zeros((5, 2))
    q_update(q, 3, 1, 10, 4, True, 0.1, 0.95)
    assert q[3, 1] == pytest.approx(1.0)
    q_update(q, 2, 1, -1, 3, False, 0.1, 0.95)
    assert q[2, 1] == pytest.approx(0.1 * (-1 + 0.95 * 1.0))


def _greedy_reach_rate(layout, table, dest):
    dist = distance_map(layout, dest)
    ok = total = 0
    for cell, d in dist.items():
        if cell == dest:
            continue
        total += 1
        pos = cell
        for _ in range(d + 2):
            dx, dy = DELTAS[greedy_action(table[state_index(pos, layout.width)])]
            nxt = (pos[0] + dx, pos[1] + dy)
            if not layout.driveable(nxt):
                break
            pos = nxt
            if pos == dest:
                break
        ok += pos == dest
    return ok / total


@pytest.mark.parametrize("dest", [(14, 8), (3, 2), (0, 2)])
def test_trained_policy_reaches_destination_from_almost_everywhere(dest):
    layout = default_layout()
    table, history = train_destination(layout, dest, Hyperparameters(), random.Random(0))
    assert len(history["rewards"]) == 3000
    assert _greedy_reach_rate(layout, table, dest) >= 0.95


def test_value_next_to_goal_converges_positive_and_points_at_goal():
    layout = default_layout()
    table, _ = train_destination(layout, (14, 8), Hyperparameters(), random.Random(0))
    row = table[state_index((13, 8), 16)]
    assert row[3] > 0  # right
    assert greedy_action(row) == 3


def test_epsilon_decay_runs_and_keeps_episode_count():
    hp = Hyperparameters(episodes_per_destination=200, epsilon_decay=True)
    _, history = train_destination(default_layout(), (14, 8), hp, random.Random(1))
    assert len(history["rewards"]) == 200


def test_train_model_reports_progress_and_continues_existing_tables():
    layout = default_layout()
    hp = Hyperparameters(episodes_per_destination=50)
    calls = []
    qt, hist = train_model(layout, hp, [(14, 8), (0, 2)], seed=3, on_progress=lambda *a: calls.append(a))
    assert [c[:3] for c in calls] == [(1, 2, (14, 8)), (2, 2, (0, 2))]
    assert hist["14,8"]["episodes"] == 50
    first = qt.get((14, 8)).copy()
    qt2, _ = train_model(layout, hp, [(14, 8)], seed=4, qtables=qt)
    assert not np.array_equal(first, qt2.get((14, 8)))
    assert np.array_equal(first, qt.get((14, 8)))  # the input set is not mutated


def test_default_train_model_covers_all_destinations():
    layout = default_layout()
    qt, hist = train_model(layout, Hyperparameters(episodes_per_destination=5))
    assert len(qt) == 29 and len(hist) == 29


def test_export_import_roundtrip_is_exact():
    layout = default_layout()
    qt, hist = train_model(layout, Hyperparameters(episodes_per_destination=20), [(14, 8)])
    qt.get((14, 8))[138, 3] = 8.55
    meta = {"id": "m1", "name": "Test", "layout_id": "default", "layout_fingerprint": layout.fingerprint()}
    data = json.loads(json.dumps(export_model(meta, Hyperparameters(), qt, hist)))
    assert data["actions"] == ["up", "down", "left", "right"]
    meta2, hp2, qt2, hist2 = import_model(data)
    assert meta2["name"] == "Test"
    assert hp2 == Hyperparameters()
    assert qt2.get((14, 8))[138, 3] == 8.55
    assert np.array_equal(qt2.get((14, 8)), qt.get((14, 8)))
    assert hist2 == hist


def test_import_legacy_single_goal_export():
    rows = [[0.0, 0.0, 0.0, 0.0] for _ in range(160)]
    rows[138][3] = 8.55
    legacy = {"q_table": rows, "actions": ["up", "down", "left", "right"], "goal": [14, 8],
              "step_reward": -1, "goal_reward": 10, "discount_factor": 0.9}
    _, hp, qt, _ = import_model(legacy)
    assert qt.destinations() == [(14, 8)]
    assert qt.get((14, 8))[138, 3] == 8.55
    assert hp.discount_factor == 0.9


@pytest.mark.parametrize("bad", [[], {"q_table": [[0, 0]]}, {"destinations": {"1,1": {"q_table": [[1, 2, 3]]}}}, {"nope": 1}])
def test_import_rejects_malformed_files(bad):
    with pytest.raises(ValueError):
        import_model(bad)


def test_qtableset_copy_is_deep():
    qt = QTableSet(16, 10, {(1, 1): np.zeros((160, 4))})
    clone = qt.copy()
    clone.get((1, 1))[0, 0] = 5
    assert qt.get((1, 1))[0, 0] == 0
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_q_learning.py -q`
Expected: `ImportError` (no `Hyperparameters`).

- [ ] **Step 3: Implement `Hyperparameters`** — append to `backend/app/simulation/models.py` and add `asdict, fields` to the dataclasses import:

```python
from dataclasses import asdict, dataclass, fields


@dataclass
class Hyperparameters:
    learning_rate: float = 0.1
    discount_factor: float = 0.95
    exploration_rate: float = 0.3
    epsilon_decay: bool = False
    epsilon_min: float = 0.05
    step_reward: float = -1.0
    goal_reward: float = 10.0
    episodes_per_destination: int = 3000
    max_steps: int = 200

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "Hyperparameters":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})
```

(The import line at the top becomes `from dataclasses import asdict, dataclass, fields`; don't add a second import.)

- [ ] **Step 4: Implement** — `backend/app/simulation/q_learning.py`:

```python
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_q_learning.py -q`
Expected: all pass (about 15 s, because of the three 3000-episode trainings).

- [ ] **Step 6: Commit**

```
git add backend/app/simulation/models.py backend/app/simulation/q_learning.py backend/app/tests/test_q_learning.py
git commit -m "feat(backend): per-destination Q-learning, training and model import/export"
```

---

### Task 4: Orders, inventory and the order generator

**Files:**
- Modify: `backend/app/simulation/models.py` (append the order types)
- Modify: `backend/app/simulation/orders.py` (empty)
- Create: `backend/app/tests/test_orders.py`

**Interfaces:**
- Consumes: `Product`, `Cell` (Task 1).
- Produces:
  - `ORDER_STATUSES`.
  - `OrderItem(sku, qty)` with `to_dict()`.
  - `Order(id, items, priority, created_tick, status="queued", robot_id=None, timeline={}, package_id=None, fail_reason=None)`, with `set_status(status, tick)`, the `is_open` property, and `to_dict()`.
  - `Package(id, order_id, station, packed_tick, delivered_tick=None)` with `to_dict()`.
  - `OrderSettings(rate_per_100=6.0, size_weights=[0.5, 0.3, 0.2], rush_fraction=0.1, seed=42)` with `to_dict()` and `OrderSettings.from_dict(d)`.
  - `Inventory(products)`, with `.stock`, `.face`, `.names` and `.reserved` dicts, plus `available(sku)`, `can_fulfill(items)`, `reserve(items)`, `release(items)` and `pick(items)`.
  - `OrderGenerator(settings, skus, rng)`, with `maybe_generate(tick, make_id) -> list[Order]` and `random_order(tick, order_id, priority=None) -> Order`.

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_orders.py`:

```python
import random

import pytest

from app.simulation.grid import default_layout
from app.simulation.models import Order, OrderItem, OrderSettings
from app.simulation.orders import Inventory, OrderGenerator


def _inventory():
    return Inventory(default_layout().products)


def test_reserve_pick_release():
    inv = _inventory()
    start = inv.stock["SKU-001"]
    items = [OrderItem("SKU-001", 2)]
    assert inv.can_fulfill(items)
    inv.reserve(items)
    assert inv.available("SKU-001") == start - 2
    inv.pick(items)
    assert inv.stock["SKU-001"] == start - 2 and inv.reserved["SKU-001"] == 0
    inv.reserve(items)
    inv.release(items)
    assert inv.available("SKU-001") == start - 2


def test_cannot_fulfill_unknown_sku_or_short_stock():
    inv = _inventory()
    assert not inv.can_fulfill([OrderItem("SKU-999", 1)])
    assert not inv.can_fulfill([OrderItem("SKU-001", inv.stock["SKU-001"] + 1)])


def test_order_timeline_records_each_status():
    order = Order("ORD-0001", [OrderItem("SKU-001", 1)], "normal", 5)
    assert order.timeline == {"queued": 5}
    order.set_status("assigned", 6)
    order.set_status("delivered", 40)
    assert order.timeline == {"queued": 5, "assigned": 6, "delivered": 40}
    assert not order.is_open
    with pytest.raises(ValueError):
        order.set_status("teleported", 41)
    assert order.to_dict()["items"] == [{"sku": "SKU-001", "qty": 1}]


def _run_generator(seed, ticks=500, rate=10.0):
    gen = OrderGenerator(OrderSettings(rate_per_100=rate, seed=seed), [p.sku for p in default_layout().products],
                         random.Random(seed))
    counter = iter(range(1, 10_000))
    out = []
    for tick in range(1, ticks + 1):
        for o in gen.maybe_generate(tick, lambda: f"ORD-{next(counter):04d}"):
            out.append((o.created_tick, o.priority, tuple((i.sku, i.qty) for i in o.items)))
    return out


def test_generator_is_reproducible_and_near_rate():
    a, b = _run_generator(7), _run_generator(7)
    assert a == b
    assert 30 <= len(a) <= 75  # ~50 expected at 10 per 100 ticks
    assert _run_generator(8) != a


def test_generated_orders_have_one_to_three_distinct_skus():
    for _, _, items in _run_generator(3, ticks=2000, rate=30):
        skus = [sku for sku, _ in items]
        assert 1 <= len(skus) <= 3
        assert len(set(skus)) == len(skus)
        assert all(qty in (1, 2) for _, qty in items)


def test_zero_rate_generates_nothing():
    assert _run_generator(1, rate=0) == []
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_orders.py -q`
Expected: `ImportError` (no `Order`).

- [ ] **Step 3: Implement the order types** — append to `backend/app/simulation/models.py` (also add `field` to the dataclasses import):

```python
ORDER_STATUSES = ("queued", "assigned", "picking", "packing", "shipping", "delivered", "failed")


@dataclass
class OrderItem:
    sku: str
    qty: int

    def to_dict(self) -> dict:
        return {"sku": self.sku, "qty": self.qty}


@dataclass
class Order:
    id: str
    items: list[OrderItem]
    priority: str  # "normal" | "rush"
    created_tick: int
    status: str = "queued"
    robot_id: str | None = None
    timeline: dict[str, int] = field(default_factory=dict)
    package_id: str | None = None
    fail_reason: str | None = None

    def __post_init__(self) -> None:
        self.timeline.setdefault("queued", self.created_tick)

    def set_status(self, status: str, tick: int) -> None:
        if status not in ORDER_STATUSES:
            raise ValueError(f"Unknown order status: {status}")
        self.status = status
        self.timeline[status] = tick

    @property
    def is_open(self) -> bool:
        return self.status not in ("delivered", "failed")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "items": [i.to_dict() for i in self.items],
            "priority": self.priority,
            "created_tick": self.created_tick,
            "status": self.status,
            "robot_id": self.robot_id,
            "timeline": dict(self.timeline),
            "package_id": self.package_id,
            "fail_reason": self.fail_reason,
        }


@dataclass
class Package:
    id: str
    order_id: str
    station: Cell
    packed_tick: int
    delivered_tick: int | None = None

    def to_dict(self) -> dict:
        return {"id": self.id, "order_id": self.order_id, "station": list(self.station),
                "packed_tick": self.packed_tick, "delivered_tick": self.delivered_tick}


@dataclass
class OrderSettings:
    rate_per_100: float = 6.0
    size_weights: list[float] = field(default_factory=lambda: [0.5, 0.3, 0.2])
    rush_fraction: float = 0.1
    seed: int = 42

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "OrderSettings":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})
```

- [ ] **Step 4: Implement** — `backend/app/simulation/orders.py`:

```python
"""Inventory bookkeeping and the seeded order generator."""

from __future__ import annotations

import random
from typing import Callable

from .models import Order, OrderItem, OrderSettings, Product


class Inventory:
    def __init__(self, products: list[Product]):
        self.stock = {p.sku: p.stock for p in products}
        self.face = {p.sku: p.face for p in products}
        self.names = {p.sku: p.name for p in products}
        self.reserved = {p.sku: 0 for p in products}

    def available(self, sku: str) -> int:
        return self.stock.get(sku, 0) - self.reserved.get(sku, 0)

    def can_fulfill(self, items: list[OrderItem]) -> bool:
        return all(i.sku in self.stock and self.available(i.sku) >= i.qty for i in items)

    def reserve(self, items: list[OrderItem]) -> None:
        for i in items:
            self.reserved[i.sku] += i.qty

    def release(self, items: list[OrderItem]) -> None:
        for i in items:
            self.reserved[i.sku] -= i.qty

    def pick(self, items: list[OrderItem]) -> None:
        for i in items:
            self.stock[i.sku] -= i.qty
            self.reserved[i.sku] -= i.qty


class OrderGenerator:
    """At most one new order per tick, with probability rate_per_100 / 100."""

    def __init__(self, settings: OrderSettings, skus: list[str], rng: random.Random):
        self.settings = settings
        self.skus = list(skus)
        self.rng = rng

    def maybe_generate(self, tick: int, make_id: Callable[[], str]) -> list[Order]:
        probability = min(1.0, max(0.0, self.settings.rate_per_100 / 100.0))
        if not self.skus or self.rng.random() >= probability:
            return []
        return [self.random_order(tick, make_id())]

    def random_order(self, tick: int, order_id: str, priority: str | None = None) -> Order:
        weights = list(self.settings.size_weights[:3]) or [1.0]
        size = min(self.rng.choices(range(1, len(weights) + 1), weights=weights)[0], len(self.skus))
        items = [OrderItem(sku, self.rng.choice((1, 1, 2))) for sku in self.rng.sample(self.skus, size)]
        if priority is None:
            priority = "rush" if self.rng.random() < self.settings.rush_fraction else "normal"
        return Order(order_id, items, priority, tick)
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_orders.py -q`
Expected: `6 passed`.

- [ ] **Step 6: Commit**

```
git add backend/app/simulation/models.py backend/app/simulation/orders.py backend/app/tests/test_orders.py
git commit -m "feat(backend): orders, inventory and seeded order generator"
```

---

### Task 5: Collision resolution

**Files:**
- Modify: `backend/app/simulation/collisions.py` (empty)
- Create: `backend/app/tests/test_collisions.py`

**Interfaces:**
- Consumes: `Cell` (Task 1).
- Produces: `resolve_moves(positions: dict[str, Cell], intents: dict[str, Cell], priority: dict[str, tuple]) -> tuple[dict[str, Cell], set[str]]`. It returns the moves that may happen this tick and the ids that must wait. A lower priority tuple goes first. Robots without an intent stay where they are, and they are not in the yielded set.

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_collisions.py`:

```python
import random

from app.simulation.collisions import resolve_moves
from app.simulation.grid import default_layout


def test_higher_priority_wins_a_contested_cell():
    moves, yielded = resolve_moves({"A": (0, 0), "B": (2, 0)}, {"A": (1, 0), "B": (1, 0)}, {"A": (1,), "B": (0,)})
    assert moves == {"B": (1, 0)} and yielded == {"A"}


def test_head_on_swap_is_refused():
    moves, yielded = resolve_moves({"A": (0, 0), "B": (1, 0)}, {"A": (1, 0), "B": (0, 0)}, {"A": (0,), "B": (1,)})
    assert moves == {} and yielded == {"A", "B"}


def test_following_into_a_vacated_cell_is_allowed():
    moves, yielded = resolve_moves({"A": (0, 0), "B": (1, 0)}, {"A": (1, 0), "B": (2, 0)}, {"A": (0,), "B": (1,)})
    assert moves == {"A": (1, 0), "B": (2, 0)} and yielded == set()


def test_blocked_chain_waits_together():
    positions = {"A": (0, 0), "B": (1, 0), "C": (2, 0)}
    moves, yielded = resolve_moves(positions, {"A": (1, 0), "B": (2, 0)}, {"A": (0,), "B": (1,), "C": (2,)})
    assert moves == {} and yielded == {"A", "B"}


def test_no_overlaps_or_swaps_over_many_random_ticks():
    layout = default_layout()
    rng = random.Random(0)
    free = [(x, y) for y in range(10) for x in range(16) if layout.driveable((x, y))]
    positions = {f"R{i}": c for i, c in enumerate(rng.sample(free, 8))}
    for _ in range(1000):
        intents = {}
        for rid, pos in positions.items():
            options = layout.neighbors(pos)
            if options and rng.random() < 0.9:
                intents[rid] = rng.choice(options)
        priority = {rid: (rng.random(),) for rid in positions}
        moves, yielded = resolve_moves(positions, intents, priority)
        assert set(moves) | yielded == set(intents)
        for a, ta in moves.items():
            for b, tb in moves.items():
                if a != b:
                    assert not (ta == positions[b] and tb == positions[a])
        positions = {rid: moves.get(rid, pos) for rid, pos in positions.items()}
        assert len(set(positions.values())) == len(positions)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_collisions.py -q`
Expected: `ImportError`.

- [ ] **Step 3: Implement** — `backend/app/simulation/collisions.py`:

```python
"""Per-tick move arbitration: robots claim cells in priority order; losers wait."""

from __future__ import annotations

from .models import Cell


def resolve_moves(positions: dict[str, Cell], intents: dict[str, Cell],
                  priority: dict[str, tuple]) -> tuple[dict[str, Cell], set[str]]:
    occupant = {pos: rid for rid, pos in positions.items()}
    claimed: set[Cell] = set()
    moves: dict[str, Cell] = {}
    yielded: set[str] = set()
    for rid in sorted(intents, key=lambda r: priority[r]):
        target = intents[rid]
        other = occupant.get(target)
        blocked_by_stayer = other is not None and other != rid and other not in intents
        head_on = other is not None and other != rid and intents.get(other) == positions[rid]
        if target in claimed or blocked_by_stayer or head_on:
            yielded.add(rid)
            continue
        claimed.add(target)
        moves[rid] = target
    # A robot cannot move into a cell whose robot ends up staying; repeat until stable.
    changed = True
    while changed:
        changed = False
        staying = {positions[rid] for rid in positions if rid not in moves}
        for rid, target in list(moves.items()):
            if target in staying:
                del moves[rid]
                yielded.add(rid)
                changed = True
    return moves, yielded
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_collisions.py -q`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/simulation/collisions.py backend/app/tests/test_collisions.py
git commit -m "feat(backend): priority-based collision resolution"
```

---

### Task 6: Metrics

**Files:**
- Modify: `backend/app/simulation/metrics.py` (empty)
- Create: `backend/app/tests/test_metrics.py`

**Interfaces:**
- Produces:
  - `percentile(values, p) -> float | None` (nearest rank).
  - `MetricsTracker(robot_ids, window=100)` with these methods:
    - `record_delivery(tick, cycle_time)`, `record_failure()`, `record_wait()`, `record_fallback()`
    - `record_planned_step(used_q: bool)`, `record_move()`, `record_leg(steps, optimal)`
    - `record_robot_tick(robot_id, activity)`, where `activity` is one of moving, working, charging or idle
    - `throughput(tick) -> float`
    - `live(tick, queued, in_progress, avg_battery, charging_count, idle_count) -> dict`
    - `summary(tick) -> dict`
  - Public counters: `delivered`, `failed`, `fallbacks`, `legs`.

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_metrics.py`:

```python
from app.simulation.metrics import MetricsTracker, percentile


def test_percentile_nearest_rank():
    values = list(range(1, 11))
    assert percentile(values, 50) == 5
    assert percentile(values, 95) == 10
    assert percentile([7], 95) == 7
    assert percentile([], 50) is None


def test_rolling_throughput_window():
    m = MetricsTracker(["R1"], window=100)
    for tick in (10, 50, 150):
        m.record_delivery(tick, 20)
    assert m.throughput(160) == 1.0  # only tick 150 is inside (60, 160]
    early = MetricsTracker(["R1"], window=100)
    early.record_delivery(10, 5)
    early.record_delivery(50, 5)
    assert early.throughput(50) == 4.0  # 2 deliveries scaled from 50 ticks to 100


def test_summary_rates_and_shares():
    m = MetricsTracker(["R1", "R2"])
    m.record_delivery(30, 30)
    m.record_delivery(60, 50)
    for _ in range(10):
        m.record_move()
    m.record_leg(5, 4)
    m.record_leg(7, 7)
    m.record_fallback()
    m.record_planned_step(True)
    m.record_planned_step(False)
    for _ in range(50):
        m.record_robot_tick("R1", "moving")
        m.record_robot_tick("R2", "idle")
    s = m.summary(100)
    assert s["delivered"] == 2
    assert s["throughput_per_100"] == 2.0
    assert s["avg_cycle_time"] == 40.0
    assert s["p95_cycle_time"] == 50
    assert s["steps_per_delivery"] == 5.0
    assert s["avg_extra_steps_per_leg"] == 0.5
    assert s["fallback_share"] == 0.5
    assert s["q_step_share"] == 0.5
    assert s["utilization"] == {"R1": 0.5, "R2": 0.0}


def test_live_stats_shape():
    m = MetricsTracker(["R1"])
    live = m.live(10, queued=2, in_progress=1, avg_battery=88.04, charging_count=0, idle_count=1)
    assert live["tick"] == 10 and live["queued"] == 2 and live["avg_battery"] == 88.0
    assert live["avg_cycle_time"] is None
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_metrics.py -q`
Expected: `ImportError`.

- [ ] **Step 3: Implement** — `backend/app/simulation/metrics.py`:

```python
"""Session metrics: live counters, rolling throughput and the end-of-run summary."""

from __future__ import annotations

import math
from collections import deque


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def _ratio(num: float, den: float, digits: int = 3) -> float:
    return round(num / den, digits) if den else 0.0


class MetricsTracker:
    def __init__(self, robot_ids: list[str], window: int = 100):
        self.window = window
        self.delivered = 0
        self.failed = 0
        self.wait_events = 0
        self.fallbacks = 0
        self.q_steps = 0
        self.planned_steps = 0
        self.total_steps = 0
        self.legs = 0
        self.extra_steps = 0
        self.cycle_times: list[int] = []
        self._recent: deque[int] = deque()
        self.robot_ticks = {rid: {"moving": 0, "working": 0, "charging": 0, "idle": 0} for rid in robot_ids}

    def record_delivery(self, tick: int, cycle_time: int) -> None:
        self.delivered += 1
        self.cycle_times.append(cycle_time)
        self._recent.append(tick)

    def record_failure(self) -> None:
        self.failed += 1

    def record_wait(self) -> None:
        self.wait_events += 1

    def record_fallback(self) -> None:
        self.fallbacks += 1

    def record_planned_step(self, used_q: bool) -> None:
        self.planned_steps += 1
        self.q_steps += int(used_q)

    def record_move(self) -> None:
        self.total_steps += 1

    def record_leg(self, steps: int, optimal: int) -> None:
        self.legs += 1
        self.extra_steps += max(0, steps - optimal)

    def record_robot_tick(self, robot_id: str, activity: str) -> None:
        self.robot_ticks[robot_id][activity] += 1

    def throughput(self, tick: int) -> float:
        while self._recent and self._recent[0] <= tick - self.window:
            self._recent.popleft()
        span = min(self.window, max(tick, 1))
        return round(len(self._recent) * 100 / span, 2)

    def _avg_cycle(self) -> float | None:
        return round(sum(self.cycle_times) / len(self.cycle_times), 2) if self.cycle_times else None

    def live(self, tick: int, queued: int, in_progress: int, avg_battery: float,
             charging_count: int, idle_count: int) -> dict:
        return {
            "tick": tick,
            "delivered": self.delivered,
            "failed": self.failed,
            "queued": queued,
            "in_progress": in_progress,
            "throughput_per_100": self.throughput(tick),
            "avg_cycle_time": self._avg_cycle(),
            "wait_events": self.wait_events,
            "fallbacks": self.fallbacks,
            "q_step_share": _ratio(self.q_steps, self.planned_steps),
            "avg_battery": round(avg_battery, 1),
            "charging_count": charging_count,
            "idle_count": idle_count,
        }

    def summary(self, tick: int) -> dict:
        return {
            "ticks": tick,
            "delivered": self.delivered,
            "failed": self.failed,
            "throughput_per_100": _ratio(self.delivered * 100, tick, 2),
            "avg_cycle_time": self._avg_cycle(),
            "p50_cycle_time": percentile(self.cycle_times, 50),
            "p95_cycle_time": percentile(self.cycle_times, 95),
            "steps_per_delivery": _ratio(self.total_steps, self.delivered, 2),
            "avg_extra_steps_per_leg": _ratio(self.extra_steps, self.legs),
            "legs": self.legs,
            "fallbacks": self.fallbacks,
            "fallback_share": _ratio(self.fallbacks, self.legs),
            "wait_events": self.wait_events,
            "q_step_share": _ratio(self.q_steps, self.planned_steps),
            "utilization": {rid: _ratio(t["moving"] + t["working"], tick) for rid, t in self.robot_ticks.items()},
        }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_metrics.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/simulation/metrics.py backend/app/tests/test_metrics.py
git commit -m "feat(backend): session metrics tracker"
```

---

### Task 7: The warehouse simulator

**Files:**
- Modify: `backend/app/simulation/models.py` (append the robot and session types)
- Modify: `backend/app/simulation/simulator.py` (empty)
- Test: `backend/app/tests/test_simulator.py` (empty)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  - Constants `ROUTING_MODES`, `ROBOT_STATUSES`, `ROBOT_COLORS`.
  - Data types: `Task`, `Robot`, `StopCondition(type="ticks", value=2000)`.
  - `SessionConfig(layout_id="default", model_id=None, routing_mode="hybrid", hybrid_margin=0.5, robot_count=4, orders=OrderSettings(), stop=StopCondition(), online_learning=False, metrics_every=10, name="")`, with `to_dict()` and `SessionConfig.from_dict(d)`.
  - `Simulator(layout, config, qtables=None, hyperparameters=None)`, with these attributes:
    - `.robots`, `.orders`, `.open_orders`, `.packages`, `.stations`
    - `.inventory`, `.metrics`, `.qtables`, `.tick`, `.finished`, `.layout`, `.config`
  - and these methods:
    - `inject_order(items=None, priority="normal") -> Order`, where `items` is a list of `{"sku", "qty"}` dicts
    - `step() -> list[dict]` (events) and `stop()`
    - `snapshot(events=None) -> dict`, `live_stats() -> dict`, `summary() -> dict`
    - `distance(a, b) -> int`
  - Frame keys (consumed by Task 10 and the frontend):
    - top level: `tick, finished, routing_mode, robots, orders, stations, stock, stats, events`
    - each robot: `id, color, x, y, battery, status, yielding, heading, target, order_id, carrying, package_id, path, q_scores, fallback_leg`
    - each station: `x, y, occupant, remaining`

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_simulator.py`:

```python
import numpy as np
import pytest

from app.simulation.grid import AISLE, default_layout
from app.simulation.models import Hyperparameters, OrderSettings, SessionConfig, StopCondition
from app.simulation.q_learning import QTableSet, train_model
from app.simulation.simulator import Simulator


def make(robots=4, mode="astar", rate=0.0, ticks=2000, layout=None, qtables=None, stop=None, **kw):
    cfg = SessionConfig(routing_mode=mode, robot_count=robots, orders=OrderSettings(rate_per_100=rate, seed=42),
                        stop=stop or StopCondition("ticks", ticks), **kw)
    return Simulator(layout or default_layout(), cfg, qtables)


def run_until(sim, cond, limit=2000, on_step=None):
    for _ in range(limit):
        if cond():
            return True
        events = sim.step()
        if on_step:
            on_step(sim, events)
    return cond()


@pytest.fixture(scope="module")
def trained():
    qt, _ = train_model(default_layout(), Hyperparameters(), seed=1)
    return qt


def test_robots_spawn_on_distinct_plain_aisle_cells():
    sim = make(robots=8)
    cells = [r.pos for r in sim.robots]
    assert [r.id for r in sim.robots] == [f"R{i}" for i in range(1, 9)]
    assert len(set(cells)) == 8
    assert all(sim.layout.cell_type(c) == AISLE and c not in sim.layout.destinations() for c in cells)


def test_same_seed_gives_identical_runs():
    a, b = make(rate=10, ticks=400), make(rate=10, ticks=400)
    while not a.finished:
        a.step()
        b.step()
    assert a.summary() == b.summary()
    assert [r.pos for r in a.robots] == [r.pos for r in b.robots]
    assert a.metrics.delivered > 0


def test_single_order_goes_through_every_state():
    sim = make(robots=1)
    before = sim.inventory.stock["SKU-001"]
    order = sim.inject_order([{"sku": "SKU-001", "qty": 1}])
    assert run_until(sim, lambda: order.status == "delivered", 400)
    t = order.timeline
    assert t["queued"] <= t["assigned"] <= t["picking"] < t["packing"] < t["shipping"] < t["delivered"]
    assert t["shipping"] - t["packing"] == 3
    assert sim.inventory.stock["SKU-001"] == before - 1
    assert sim.packages[order.package_id].delivered_tick == t["delivered"]
    assert sim.metrics.delivered == 1


def test_multi_item_order_picks_at_each_face():
    sim = make(robots=1)
    order = sim.inject_order([{"sku": "SKU-001", "qty": 1}, {"sku": "SKU-012", "qty": 2}, {"sku": "SKU-024", "qty": 1}])
    picked = []
    run_until(sim, lambda: order.status == "delivered", 600,
              on_step=lambda s, ev: picked.extend(e for e in ev if e["type"] == "picked"))
    assert order.status == "delivered"
    assert len(picked) == 3


def test_out_of_stock_order_fails():
    layout = default_layout()
    layout.products[0].stock = 0
    sim = make(robots=1, layout=layout)
    order = sim.inject_order([{"sku": "SKU-001", "qty": 1}])
    sim.step()
    assert order.status == "failed" and order.fail_reason == "out_of_stock"
    assert sim.metrics.failed == 1


def test_rush_order_is_dispatched_first():
    sim = make(robots=1)
    normal = sim.inject_order([{"sku": "SKU-002", "qty": 1}])
    rush = sim.inject_order([{"sku": "SKU-003", "qty": 1}], priority="rush")
    sim.step()
    assert rush.status == "assigned" and rush.robot_id == "R1"
    assert normal.status == "queued"


def test_idle_robot_with_low_battery_charges_and_returns_to_idle():
    sim = make(robots=1)
    robot = sim.robots[0]
    robot.battery = 30
    sim.step()
    assert robot.status == "to_charger" and robot.target in sim.layout.cells_of("charger")
    assert run_until(sim, lambda: robot.status == "idle" and robot.battery == 100.0, 300)


def test_low_battery_before_first_pick_requeues_order():
    sim = make(robots=1)
    order = sim.inject_order([{"sku": "SKU-024", "qty": 1}])
    sim.step()
    assert order.status == "assigned"
    sim.robots[0].battery = 15
    sim.step()
    assert order.status == "queued" and order.robot_id is None
    assert sim.inventory.reserved["SKU-024"] == 0
    assert sim.robots[0].status == "to_charger" and sim.robots[0].task is None


def test_low_battery_while_carrying_finishes_the_order_first():
    sim = make(robots=1)
    robot = sim.robots[0]
    order = sim.inject_order([{"sku": "SKU-001", "qty": 1}, {"sku": "SKU-020", "qty": 1}])
    assert run_until(sim, lambda: bool(robot.carrying), 400)
    robot.battery = 18
    assert run_until(sim, lambda: order.status == "delivered", 400)
    assert robot.status == "to_charger"


def test_single_packing_station_serves_one_robot_at_a_time():
    layout = default_layout()
    layout.cells[5][14] = AISLE  # leave only the station at (14, 2)
    sim = make(robots=3, layout=layout)
    orders = [sim.inject_order([{"sku": sku, "qty": 1}]) for sku in ("SKU-001", "SKU-005", "SKU-009")]

    def check(s, _events):
        assert sum(r.status == "packing" for r in s.robots) <= 1

    assert run_until(sim, lambda: all(o.status == "delivered" for o in orders), 1000, on_step=check)


def test_robots_never_share_a_cell_under_heavy_load():
    sim = make(robots=8, rate=30, ticks=1500)

    def check(s, _events):
        assert len({r.pos for r in s.robots}) == 8

    run_until(sim, lambda: sim.finished, 1600, on_step=check)
    assert sim.metrics.delivered > 20


def test_head_on_robots_in_one_wide_aisle_get_past_each_other():
    sim = make(robots=2)
    r1, r2 = sim.robots
    r1.pos, r2.pos = (6, 1), (6, 3)
    sim._go(r1, "parking", (6, 4))
    sim._go(r2, "parking", (6, 0))
    assert run_until(sim, lambda: r1.pos == (6, 4) and r2.pos == (6, 0), 80)


def test_stop_after_ticks_and_after_orders():
    sim = make(ticks=50)
    for _ in range(60):
        sim.step()
    assert sim.tick == 50 and sim.finished and sim.step() == []
    by_orders = make(rate=40, stop=StopCondition("orders", 2))
    assert run_until(by_orders, lambda: by_orders.finished, 2000)
    assert by_orders.metrics.delivered >= 2


def test_q_only_without_tables_falls_back_but_still_delivers():
    sim = make(mode="q_only", rate=10, ticks=600, qtables=QTableSet(16, 10))
    run_until(sim, lambda: sim.finished, 700)
    summary = sim.summary()
    assert summary["delivered"] > 0 and summary["fallbacks"] > 0


def test_trained_q_only_mostly_follows_the_policy(trained):
    sim = make(mode="q_only", rate=10, ticks=600, qtables=trained)
    run_until(sim, lambda: sim.finished, 700)
    summary = sim.summary()
    assert summary["delivered"] > 0
    assert summary["q_step_share"] > 0.8
    assert summary["fallback_share"] < 0.1


def test_online_learning_updates_a_copy_only():
    qt, _ = train_model(default_layout(), Hyperparameters(episodes_per_destination=50), seed=2)
    original = {d: qt.get(d).copy() for d in qt.destinations()}
    sim = make(mode="q_only", rate=10, ticks=300, qtables=qt, online_learning=True)
    run_until(sim, lambda: sim.finished, 400)
    assert all(np.array_equal(qt.get(d), original[d]) for d in original)
    assert any(not np.array_equal(sim.qtables.get(d), original[d]) for d in original)


def test_snapshot_shape(trained):
    sim = make(mode="hybrid", rate=20, qtables=trained)
    for _ in range(30):
        sim.step()
    snap = sim.snapshot()
    assert set(snap) == {"tick", "finished", "routing_mode", "robots", "orders", "stations", "stock", "stats", "events"}
    robot = snap["robots"][0]
    assert {"id", "x", "y", "battery", "status", "path", "q_scores", "carrying", "target", "heading"} <= set(robot)
    assert snap["stations"][0].keys() == {"x", "y", "occupant", "remaining"}
    assert snap["stats"]["tick"] == 30
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_simulator.py -q`
Expected: `ImportError` (no `SessionConfig`).

- [ ] **Step 3: Implement the session and robot types** — append to `backend/app/simulation/models.py`:

```python
ROUTING_MODES = ("hybrid", "q_only", "astar")
ROBOT_STATUSES = ("idle", "parking", "to_pick", "picking", "to_pack", "queued_pack", "packing",
                  "to_dock", "to_charger", "charging")
ROBOT_COLORS = ["#FF5A26", "#2563EB", "#10B981", "#9333EA", "#E11D48", "#0891B2", "#CA8A04", "#4B5563"]


@dataclass
class Task:
    order_id: str
    picks: list[tuple[Cell, list[OrderItem]]]  # remaining pick stops: (face, items there)
    station: Cell | None = None
    dock: Cell | None = None


@dataclass
class Robot:
    id: str
    pos: Cell
    color: str
    battery: float = 100.0
    status: str = "idle"
    yielding: bool = False
    task: Task | None = None
    target: Cell | None = None
    carrying: list[OrderItem] = field(default_factory=list)
    package_id: str | None = None
    work_ticks: int = 0
    wait_ticks: int = 0
    charge_after_task: bool = False
    heading: int = 0
    path: list[Cell] = field(default_factory=list)  # cached A* path, starting at pos
    detour: list[Cell] = field(default_factory=list)  # path around blocking robots, starting at pos
    visit_counts: dict[Cell, int] = field(default_factory=dict)
    fallback_leg: bool = False
    leg_steps: int = 0
    leg_optimal: int = 0
    q_step: tuple[int, int] | None = None  # (state, action) chosen by the Q-table this tick


@dataclass
class StopCondition:
    type: str = "ticks"  # "ticks" | "orders" | "manual"
    value: int | None = 2000


@dataclass
class SessionConfig:
    layout_id: str = "default"
    model_id: str | None = None
    routing_mode: str = "hybrid"
    hybrid_margin: float = 0.5
    robot_count: int = 4
    orders: OrderSettings = field(default_factory=OrderSettings)
    stop: StopCondition = field(default_factory=StopCondition)
    online_learning: bool = False
    metrics_every: int = 10
    name: str = ""

    def __post_init__(self) -> None:
        if self.routing_mode not in ROUTING_MODES:
            raise ValueError(f"Unknown routing mode: {self.routing_mode}")

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "SessionConfig":
        known = {f.name for f in fields(cls)}
        values = {k: v for k, v in (data or {}).items() if k in known}
        values["orders"] = OrderSettings.from_dict(values.get("orders"))
        stop = values.get("stop") or {}
        values["stop"] = StopCondition(stop.get("type", "ticks"), stop.get("value", 2000))
        return cls(**values)
```

- [ ] **Step 4: Implement** — `backend/app/simulation/simulator.py`:

```python
"""Deterministic warehouse simulation: each step() advances the whole fleet by one tick."""

from __future__ import annotations

import random
from collections import deque

from .astar import distance_map, find_path, manhattan
from .collisions import resolve_moves
from .grid import ACTIONS, AISLE, CHARGER, DELTAS, DOCK, PACKING, Layout
from .metrics import MetricsTracker
from .models import (
    ROBOT_COLORS,
    Cell,
    Hyperparameters,
    Order,
    OrderItem,
    Package,
    Robot,
    SessionConfig,
    Task,
)
from .orders import Inventory, OrderGenerator
from .q_learning import QTableSet, greedy_action, q_update, state_index

MOVE_COST = 0.8
WAIT_COST = 0.1
CHARGE_RATE = 5.0
LOW_BATTERY = 20.0
DISPATCH_MIN_BATTERY = 35.0
CRITICAL_BATTERY = 10.0
PICK_TICKS = 1
PACK_TICKS = 3
MAX_WAIT = 3
REVISIT_LIMIT = 2  # entering the same cell a third time on one leg means the policy is looping
PREVIEW_STEPS = 30
RECENT_FINISHED = 20
WORKING = ("picking", "packing")
# Degrees clockwise; the UI draws the robot's nose pointing right at 0.
HEADINGS = {(1, 0): 0, (0, 1): 90, (-1, 0): 180, (0, -1): 270}


class Simulator:
    def __init__(self, layout: Layout, config: SessionConfig, qtables: QTableSet | None = None,
                 hyperparameters: Hyperparameters | None = None):
        self.layout = layout
        self.config = config
        self.hp = hyperparameters or Hyperparameters()
        if qtables is not None and config.online_learning:
            qtables = qtables.copy()
        self.qtables = qtables
        self.inventory = Inventory(layout.products)
        self.generator = OrderGenerator(config.orders, [p.sku for p in layout.products],
                                        random.Random(config.orders.seed))
        self.destinations = set(layout.destinations())
        self.chargers = layout.cells_of(CHARGER)
        self.docks = layout.cells_of(DOCK)
        self.stations: dict[Cell, dict] = {c: {"occupant": None, "remaining": 0} for c in layout.cells_of(PACKING)}
        self.robots = self._spawn_robots(config.robot_count)
        self.metrics = MetricsTracker([r.id for r in self.robots])
        self.orders: dict[str, Order] = {}
        self.open_orders: dict[str, Order] = {}
        self.recent_finished: deque[Order] = deque(maxlen=RECENT_FINISHED)
        self.packages: dict[str, Package] = {}
        self.tick = 0
        self.finished = False
        self._order_seq = 0
        self._package_seq = 0
        self._pending: list[Order] = []
        self._dist_cache: dict[Cell, dict[Cell, int]] = {}

    # ------------------------------------------------------------------ public API

    def inject_order(self, items: list[dict] | None = None, priority: str = "normal") -> Order:
        order_id = self._next_order_id()
        if items:
            order = Order(order_id, [OrderItem(str(i["sku"]), int(i["qty"])) for i in items], priority, self.tick)
        else:
            order = self.generator.random_order(self.tick, order_id, priority)
        self._pending.append(order)
        return order

    def stop(self) -> None:
        self.finished = True

    def step(self) -> list[dict]:
        if self.finished:
            return []
        self.tick += 1
        events: list[dict] = []
        self._arrivals(events)
        self._dispatch(events)
        positions = {r.id: r.pos for r in self.robots}
        intents: dict[str, Cell] = {}
        for r in self.robots:
            r.q_step = None
            if r.status == "idle" and self._needs_parking(r):
                spot = self._parking_spot(r)
                if spot is not None:
                    self._go(r, "parking", spot)
            nxt = self._plan(r, positions, events)
            if nxt is not None:
                intents[r.id] = nxt
        priority = {r.id: self._priority(r, i) for i, r in enumerate(self.robots)}
        moves, yielded = resolve_moves(positions, intents, priority)
        for r in self.robots:
            if r.id in moves:
                self._move(r, moves[r.id])
            elif r.id in yielded:
                r.yielding = True
                r.wait_ticks += 1
                r.battery = max(0.0, r.battery - WAIT_COST)
                self.metrics.record_wait()
            else:
                r.yielding = False
        for r in self.robots:
            self._work(r, events)
            self._battery_rules(r, events)
            self.metrics.record_robot_tick(r.id, self._activity(r))
        self._check_stop()
        return events

    def distance(self, a: Cell, b: Cell) -> int:
        dist = self._dist_cache.get(b)
        if dist is None:
            dist = self._dist_cache[b] = distance_map(self.layout, b)
        return dist.get(a, 10**6)

    def live_stats(self) -> dict:
        queued = sum(1 for o in self.open_orders.values() if o.status == "queued")
        return self.metrics.live(
            self.tick, queued, len(self.open_orders) - queued,
            sum(r.battery for r in self.robots) / len(self.robots),
            sum(r.status == "charging" for r in self.robots),
            sum(r.status == "idle" for r in self.robots),
        )

    def summary(self) -> dict:
        return self.metrics.summary(self.tick)

    def snapshot(self, events: list[dict] | None = None) -> dict:
        return {
            "tick": self.tick,
            "finished": self.finished,
            "routing_mode": self.config.routing_mode,
            "robots": [self._robot_view(r) for r in self.robots],
            "orders": [o.to_dict() for o in self.open_orders.values()]
            + [o.to_dict() for o in reversed(self.recent_finished)],
            "stations": [{"x": c[0], "y": c[1], "occupant": s["occupant"], "remaining": s["remaining"]}
                         for c, s in self.stations.items()],
            "stock": dict(self.inventory.stock),
            "stats": self.live_stats(),
            "events": list(events or []),
        }

    # ------------------------------------------------------------------ setup & orders

    def _spawn_robots(self, count: int) -> list[Robot]:
        count = max(1, min(len(ROBOT_COLORS), count))
        seen = set(self.chargers)
        queue = deque(self.chargers)
        spots: list[Cell] = []
        while queue and len(spots) < count:
            cell = queue.popleft()
            if self.layout.cell_type(cell) == AISLE and cell not in self.destinations:
                spots.append(cell)
            for n in self.layout.neighbors(cell):
                if n not in seen:
                    seen.add(n)
                    queue.append(n)
        return [Robot(id=f"R{i + 1}", pos=spot, color=ROBOT_COLORS[i]) for i, spot in enumerate(spots)]

    def _next_order_id(self) -> str:
        self._order_seq += 1
        return f"ORD-{self._order_seq:04d}"

    def _arrivals(self, events: list[dict]) -> None:
        new = self.generator.maybe_generate(self.tick, self._next_order_id) + self._pending
        self._pending = []
        for order in new:
            self.orders[order.id] = order
            self.open_orders[order.id] = order
            events.append({"type": "order_created", "order": order.id, "priority": order.priority})

    def _close(self, order: Order) -> None:
        self.open_orders.pop(order.id, None)
        self.recent_finished.append(order)

    def _dispatch(self, events: list[dict]) -> None:
        queued = sorted((o for o in self.open_orders.values() if o.status == "queued"),
                        key=lambda o: (o.priority != "rush", o.created_tick, o.id))
        for order in queued:
            if not self.inventory.can_fulfill(order.items):
                order.fail_reason = "out_of_stock"
                order.set_status("failed", self.tick)
                self._close(order)
                self.metrics.record_failure()
                events.append({"type": "order_failed", "order": order.id, "reason": "out_of_stock"})
                continue
            free = [r for r in self.robots if r.status in ("idle", "parking") and r.battery > DISPATCH_MIN_BATTERY]
            if not free:
                continue
            grouped: dict[Cell, list[OrderItem]] = {}
            for item in order.items:
                grouped.setdefault(self.inventory.face[item.sku], []).append(item)
            robot = min(free, key=lambda r: (min(self.distance(r.pos, f) for f in grouped), r.id))
            stops = self._order_stops(robot.pos, grouped)
            self.inventory.reserve(order.items)
            order.robot_id = robot.id
            order.set_status("assigned", self.tick)
            robot.task = Task(order.id, stops)
            self._go(robot, "to_pick", stops[0][0])
            events.append({"type": "order_assigned", "order": order.id, "robot": robot.id})

    def _order_stops(self, start: Cell, grouped: dict[Cell, list[OrderItem]]) -> list[tuple[Cell, list[OrderItem]]]:
        remaining = dict(grouped)
        pos = start
        stops = []
        while remaining:
            face = min(remaining, key=lambda f: (self.distance(pos, f), f))
            stops.append((face, remaining.pop(face)))
            pos = face
        return stops

    # ------------------------------------------------------------------ movement

    def _go(self, r: Robot, status: str, target: Cell | None) -> None:
        r.status = status
        if target != r.target:
            r.target = target
            r.path = []
            r.detour = []
            r.visit_counts = {}
            r.fallback_leg = False
            r.leg_steps = 0
            r.leg_optimal = self.distance(r.pos, target) if target is not None else 0
            r.wait_ticks = 0

    def _priority(self, r: Robot, index: int) -> tuple:
        rush = r.task is not None and self.orders[r.task.order_id].priority == "rush"
        return (r.battery >= CRITICAL_BATTERY, not rush, not (r.carrying or r.package_id), index)

    def _busy(self, cell: Cell, rid: str) -> bool:
        station = self.stations.get(cell)
        if station is not None and station["occupant"] not in (None, rid):
            return True
        return any(o.id != rid and o.pos == cell and o.status == "charging" for o in self.robots)

    def _plan(self, r: Robot, positions: dict[str, Cell], events: list[dict]) -> Cell | None:
        if r.target is None or r.pos == r.target or r.status in WORKING or r.status == "charging":
            return None
        if manhattan(r.pos, r.target) == 1 and self._busy(r.target, r.id):
            if r.status == "to_pack":
                r.status = "queued_pack"
            return None
        if r.status == "queued_pack":
            r.status = "to_pack"
        if r.wait_ticks > MAX_WAIT:
            r.wait_ticks = 0
            return self._detour(r, positions)
        if len(r.detour) > 1 and r.detour[0] == r.pos:
            return r.detour[1]
        nxt = self._route(r, events)
        if nxt is not None:
            self.metrics.record_planned_step(r.q_step is not None)
        return nxt

    def _table_for(self, target: Cell | None):
        if self.qtables is None or target is None:
            return None
        return self.qtables.get(target)

    def _route(self, r: Robot, events: list[dict]) -> Cell | None:
        mode = self.config.routing_mode
        if mode == "astar" or r.target not in self.destinations or r.fallback_leg:
            return self._astar_step(r)
        table = self._table_for(r.target)
        if table is None:
            if mode == "q_only":
                self._fallback(r, events, "untrained")
            return self._astar_step(r)
        s = state_index(r.pos, self.layout.width)
        row = table[s]
        a = greedy_action(row)
        nxt = (r.pos[0] + DELTAS[a][0], r.pos[1] + DELTAS[a][1])
        valid = self.layout.driveable(nxt)
        if mode == "hybrid":
            if valid and row[a] - sorted(row)[-2] >= self.config.hybrid_margin:
                r.q_step = (s, a)
                return nxt
            return self._astar_step(r)
        if not valid:
            self._fallback(r, events, "wall")
            return self._astar_step(r)
        if r.visit_counts.get(nxt, 0) >= REVISIT_LIMIT:
            self._fallback(r, events, "loop")
            return self._astar_step(r)
        r.q_step = (s, a)
        return nxt

    def _fallback(self, r: Robot, events: list[dict], reason: str) -> None:
        r.fallback_leg = True
        self.metrics.record_fallback()
        events.append({"type": "fallback", "robot": r.id, "reason": reason, "target": list(r.target)})

    def _astar_step(self, r: Robot) -> Cell | None:
        if not (len(r.path) > 1 and r.path[0] == r.pos and r.path[-1] == r.target):
            r.path = find_path(self.layout, r.pos, r.target) or []
        return r.path[1] if len(r.path) > 1 else None

    def _detour(self, r: Robot, positions: dict[str, Cell]) -> Cell | None:
        """After waiting too long: route around the other robots, or sidestep if fully boxed in."""
        others = {pos for rid, pos in positions.items() if rid != r.id}
        path = find_path(self.layout, r.pos, r.target, frozenset(others - {r.target}))
        r.path = []
        if path and len(path) > 1:
            r.detour = path
            return path[1]
        r.detour = []
        for dx, dy in DELTAS:
            n = (r.pos[0] + dx, r.pos[1] + dy)
            if self.layout.driveable(n) and n not in others:
                return n
        return None

    def _move(self, r: Robot, nxt: Cell) -> None:
        r.heading = HEADINGS.get((nxt[0] - r.pos[0], nxt[1] - r.pos[1]), r.heading)
        r.pos = nxt
        r.yielding = False
        r.wait_ticks = 0
        r.battery = max(0.0, r.battery - MOVE_COST)
        r.leg_steps += 1
        r.visit_counts[nxt] = r.visit_counts.get(nxt, 0) + 1
        r.path = r.path[1:] if len(r.path) > 1 and r.path[1] == nxt else []
        r.detour = r.detour[1:] if len(r.detour) > 2 and r.detour[1] == nxt else []
        self.metrics.record_move()
        if r.q_step is not None and self.config.online_learning and self.qtables is not None:
            s, a = r.q_step
            done = nxt == r.target
            reward = self.hp.goal_reward if done else self.hp.step_reward
            q_update(self.qtables.get(r.target), s, a, reward, state_index(nxt, self.layout.width), done,
                     self.hp.learning_rate, self.hp.discount_factor)
        if nxt == r.target:
            self.metrics.record_leg(r.leg_steps, r.leg_optimal)

    def _needs_parking(self, r: Robot) -> bool:
        return self.layout.cell_type(r.pos) != AISLE or r.pos in self.destinations

    def _parking_spot(self, r: Robot) -> Cell | None:
        taken = {o.pos for o in self.robots if o.id != r.id}
        taken |= {o.target for o in self.robots if o.id != r.id and o.status == "parking"}
        seen = {r.pos}
        queue = deque([r.pos])
        while queue:
            cell = queue.popleft()
            if self.layout.cell_type(cell) == AISLE and cell not in self.destinations and cell not in taken:
                return cell
            for n in self.layout.neighbors(cell):
                if n not in seen:
                    seen.add(n)
                    queue.append(n)
        return None

    # ------------------------------------------------------------------ work at destinations

    def _work(self, r: Robot, events: list[dict]) -> None:
        if r.status == "to_pick" and r.pos == r.target:
            order = self.orders[r.task.order_id]
            if order.status == "assigned":
                order.set_status("picking", self.tick)
            r.status, r.work_ticks = "picking", PICK_TICKS
        elif r.status == "picking":
            r.work_ticks -= 1
            if r.work_ticks <= 0:
                self._finish_pick(r, events)
        elif r.status == "to_pack" and r.pos == r.target:
            self.stations[r.pos].update(occupant=r.id, remaining=PACK_TICKS)
            r.status, r.work_ticks = "packing", PACK_TICKS
            self.orders[r.task.order_id].set_status("packing", self.tick)
            events.append({"type": "packing_started", "robot": r.id, "order": r.task.order_id, "at": list(r.pos)})
        elif r.status == "packing":
            r.work_ticks -= 1
            self.stations[r.pos]["remaining"] = max(0, r.work_ticks)
            if r.work_ticks <= 0:
                self._finish_pack(r, events)
        elif r.status == "to_dock" and r.pos == r.target:
            self._deliver(r, events)
        elif r.status == "to_charger" and r.pos == r.target:
            r.status = "charging"
            events.append({"type": "charging_started", "robot": r.id, "at": list(r.pos)})
        elif r.status == "charging":
            r.battery = min(100.0, r.battery + CHARGE_RATE)
            if r.battery >= 100.0:
                self._go(r, "idle", None)
                events.append({"type": "charged", "robot": r.id})
        elif r.status == "parking" and r.pos == r.target:
            self._go(r, "idle", None)

    def _finish_pick(self, r: Robot, events: list[dict]) -> None:
        face, items = r.task.picks.pop(0)
        self.inventory.pick(items)
        r.carrying.extend(items)
        events.append({"type": "picked", "robot": r.id, "order": r.task.order_id, "at": list(face),
                       "items": [i.to_dict() for i in items]})
        if r.task.picks:
            self._go(r, "to_pick", r.task.picks[0][0])
        else:
            r.task.station = self._choose_station(r)
            self._go(r, "to_pack", r.task.station)

    def _choose_station(self, r: Robot) -> Cell:
        def load(cell: Cell) -> int:
            return sum(1 for o in self.robots if o.id != r.id and o.target == cell
                       and o.status in ("to_pack", "queued_pack", "packing"))
        return min(self.stations, key=lambda c: (load(c), self.distance(r.pos, c), c))

    def _finish_pack(self, r: Robot, events: list[dict]) -> None:
        self.stations[r.pos].update(occupant=None, remaining=0)
        self._package_seq += 1
        package = Package(f"PKG-{self._package_seq:04d}", r.task.order_id, r.pos, self.tick)
        self.packages[package.id] = package
        order = self.orders[r.task.order_id]
        order.package_id = package.id
        order.set_status("shipping", self.tick)
        r.carrying = []
        r.package_id = package.id
        r.task.dock = min(self.docks, key=lambda d: (self.distance(r.pos, d), d))
        self._go(r, "to_dock", r.task.dock)
        events.append({"type": "packed", "robot": r.id, "order": order.id, "package": package.id, "at": list(r.pos)})

    def _deliver(self, r: Robot, events: list[dict]) -> None:
        order = self.orders[r.task.order_id]
        self.packages[r.package_id].delivered_tick = self.tick
        order.set_status("delivered", self.tick)
        self._close(order)
        cycle = self.tick - order.created_tick
        self.metrics.record_delivery(self.tick, cycle)
        events.append({"type": "delivered", "robot": r.id, "order": order.id, "package": r.package_id,
                       "at": list(r.pos), "cycle_time": cycle})
        r.package_id = None
        r.task = None
        if r.charge_after_task:
            r.charge_after_task = False
            self._send_to_charger(r, events)
        else:
            self._go(r, "idle", None)

    # ------------------------------------------------------------------ battery

    def _battery_rules(self, r: Robot, events: list[dict]) -> None:
        if r.status in ("to_charger", "charging"):
            return
        if r.status in ("idle", "parking") and r.battery < DISPATCH_MIN_BATTERY:
            self._send_to_charger(r, events)
            return
        if r.battery >= LOW_BATTERY or r.charge_after_task:
            return
        if r.carrying or r.package_id:
            r.charge_after_task = True
            return
        if r.task is not None:  # assigned, nothing picked yet: hand the order back
            order = self.orders[r.task.order_id]
            self.inventory.release([i for _, items in r.task.picks for i in items])
            order.robot_id = None
            order.set_status("queued", self.tick)
            events.append({"type": "order_requeued", "order": order.id, "robot": r.id})
            r.task = None
        self._send_to_charger(r, events)

    def _send_to_charger(self, r: Robot, events: list[dict]) -> None:
        def load(cell: Cell) -> int:
            return sum(1 for o in self.robots if o.id != r.id and o.target == cell
                       and o.status in ("to_charger", "charging"))
        charger = min(self.chargers, key=lambda c: (load(c), self.distance(r.pos, c), c))
        self._go(r, "to_charger", charger)
        events.append({"type": "to_charger", "robot": r.id, "battery": round(r.battery, 1)})

    # ------------------------------------------------------------------ bookkeeping & views

    def _activity(self, r: Robot) -> str:
        if r.status in WORKING:
            return "working"
        if r.status == "charging":
            return "charging"
        if r.status == "idle":
            return "idle"
        return "moving"

    def _check_stop(self) -> None:
        stop = self.config.stop
        if stop.type == "ticks" and stop.value and self.tick >= stop.value:
            self.finished = True
        elif stop.type == "orders" and stop.value and self.metrics.delivered >= stop.value:
            self.finished = True

    def _robot_view(self, r: Robot) -> dict:
        table = self._table_for(r.target)
        q_scores = None
        if table is not None:
            row = table[state_index(r.pos, self.layout.width)]
            q_scores = {name: round(float(row[i]), 2) for i, name in enumerate(ACTIONS)}
        return {
            "id": r.id,
            "color": r.color,
            "x": r.pos[0],
            "y": r.pos[1],
            "battery": round(r.battery, 1),
            "status": r.status,
            "yielding": r.yielding,
            "heading": r.heading,
            "target": list(r.target) if r.target else None,
            "order_id": r.task.order_id if r.task else None,
            "carrying": [i.to_dict() for i in r.carrying],
            "package_id": r.package_id,
            "path": [list(c) for c in self._preview(r)],
            "q_scores": q_scores,
            "fallback_leg": r.fallback_leg,
        }

    def _preview(self, r: Robot) -> list[Cell]:
        if r.target is None or r.pos == r.target:
            return []
        if len(r.detour) > 1:
            return r.detour[1:PREVIEW_STEPS + 1]
        table = self._table_for(r.target)
        if self.config.routing_mode == "astar" or table is None or r.fallback_leg or r.target not in self.destinations:
            path = r.path if (r.path and r.path[0] == r.pos) else (find_path(self.layout, r.pos, r.target) or [])
            return path[1:PREVIEW_STEPS + 1]
        cells: list[Cell] = []
        pos, seen = r.pos, {r.pos}
        for _ in range(PREVIEW_STEPS):
            dx, dy = DELTAS[greedy_action(table[state_index(pos, self.layout.width)])]
            nxt = (pos[0] + dx, pos[1] + dy)
            if not self.layout.driveable(nxt) or nxt in seen:
                break
            cells.append(nxt)
            seen.add(nxt)
            pos = nxt
            if nxt == r.target:
                break
        return cells
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_simulator.py -q`
Expected: all pass. If a test fails, debug the simulator (use superpowers:systematic-debugging); don't weaken the test. The exception is a timing limit (`limit=` in `run_until`): you may raise one if the scenario is correct but slower than estimated. Say so in the commit message.

- [ ] **Step 6: Run the whole backend suite**

Run: `.venv\Scripts\python.exe -m pytest -q`
Expected: everything passes.

- [ ] **Step 7: Commit**

```
git add backend/app/simulation/models.py backend/app/simulation/simulator.py backend/app/tests/test_simulator.py
git commit -m "feat(backend): deterministic multi-robot warehouse simulator"
```

---

### Task 8: Storage (SQLite and model files)

**Files:**
- Create: `backend/app/errors.py`
- Create: `backend/app/storage.py`
- Create: `backend/app/tests/test_storage.py`
- Modify: `.gitignore` (add `backend/data/`)

**Interfaces:**
- Produces:
  - In `errors.py`: `NotFound(KeyError)`, `Conflict(Exception)` and `Forbidden(Exception)`.
  - In `storage.py`: `now() -> str` (ISO UTC) and `new_id(prefix) -> str`.
  - `Storage(data_dir)`, with these methods. Rows come back as plain dicts; their JSON columns are parsed.
    - Layouts: `ensure_default_layout(layout_dict)`, `list_layouts()`, `get_layout(id) -> {"id", "name", "is_default", "layout": dict, ...}`, `create_layout(name, data) -> id`, `update_layout(id, name, data)`
    - Models: `create_model(name, layout_id, fingerprint, hp_dict, parent_model_id=None, version=1) -> id`, `list_models()`, `get_model(id)`, `update_model_after_training(id, trained_destinations, hp_dict)`, `delete_model(id)`, `save_model_file(id, payload)`, `load_model_file(id) -> dict | None`
    - Sessions: `create_session(name, config_dict) -> id`, `update_session(id, **fields)` (accepts `status`, `summary`, `ended_at`, `error`), `list_sessions()`, `get_session(id)`
    - Session data: `add_metrics(session_id, rows)`, `get_metrics(session_id)`, `save_orders(session_id, orders)`, `get_orders(session_id)`
    - `mark_interrupted_sessions()` and `close()`
  - Missing ids raise `NotFound`. Editing the default layout raises `Forbidden`.

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_storage.py`:

```python
import pytest

from app.errors import Forbidden, NotFound
from app.simulation.grid import default_layout
from app.storage import Storage


@pytest.fixture
def storage(tmp_path):
    s = Storage(tmp_path)
    s.ensure_default_layout(default_layout().to_dict())
    yield s
    s.close()


def test_default_layout_is_seeded_once_and_read_only(storage):
    storage.ensure_default_layout(default_layout().to_dict())
    layouts = storage.list_layouts()
    assert [(l["id"], l["is_default"]) for l in layouts] == [("default", True)]
    assert storage.get_layout("default")["layout"]["width"] == 16
    with pytest.raises(Forbidden):
        storage.update_layout("default", "x", {})


def test_layout_create_update_and_missing(storage):
    lid = storage.create_layout("Mine", default_layout().to_dict())
    storage.update_layout(lid, "Renamed", {"width": 16})
    row = storage.get_layout(lid)
    assert row["name"] == "Renamed" and row["layout"] == {"width": 16} and row["is_default"] is False
    with pytest.raises(NotFound):
        storage.get_layout("nope")


def test_model_rows_and_files(storage):
    mid = storage.create_model("First", "default", "abc", {"learning_rate": 0.1})
    assert storage.get_model(mid)["hyperparameters"] == {"learning_rate": 0.1}
    assert storage.load_model_file(mid) is None
    storage.save_model_file(mid, {"destinations": {}})
    assert storage.load_model_file(mid) == {"destinations": {}}
    storage.update_model_after_training(mid, 29, {"learning_rate": 0.2})
    row = storage.get_model(mid)
    assert row["trained_destinations"] == 29 and row["last_trained_at"] is not None
    assert [m["id"] for m in storage.list_models()] == [mid]
    storage.delete_model(mid)
    assert storage.list_models() == []
    assert storage.load_model_file(mid) is None
    with pytest.raises(NotFound):
        storage.delete_model(mid)


def test_sessions_metrics_and_orders(storage):
    sid = storage.create_session("Run 1", {"routing_mode": "astar"})
    storage.add_metrics(sid, [{"tick": 10, "delivered": 1}, {"tick": 20, "delivered": 3}])
    storage.save_orders(sid, [{"id": "ORD-0001", "status": "delivered"}])
    storage.update_session(sid, status="finished", summary={"delivered": 3})
    row = storage.get_session(sid)
    assert row["status"] == "finished" and row["summary"] == {"delivered": 3} and row["config"]["routing_mode"] == "astar"
    assert [m["tick"] for m in storage.get_metrics(sid)] == [10, 20]
    assert storage.get_orders(sid)[0]["id"] == "ORD-0001"


def test_mark_interrupted(storage):
    running = storage.create_session("A", {})
    storage.update_session(running, status="running")
    done = storage.create_session("B", {})
    storage.update_session(done, status="finished")
    storage.mark_interrupted_sessions()
    assert storage.get_session(running)["status"] == "interrupted"
    assert storage.get_session(done)["status"] == "finished"
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_storage.py -q`
Expected: `ModuleNotFoundError: app.errors`.

- [ ] **Step 3: Implement** — `backend/app/errors.py`:

```python
"""Domain errors that the API maps to HTTP status codes."""


class NotFound(KeyError):
    """404: the requested record does not exist."""

    def __str__(self) -> str:
        return str(self.args[0]) if self.args else "Not found"


class Conflict(Exception):
    """409: the action is not valid in the current state."""


class Forbidden(Exception):
    """403: the record cannot be changed."""
```

`backend/app/storage.py`:

```python
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
        if not self._rows("SELECT id FROM layouts WHERE id = 'default'"):
            ts = now()
            self._exec("INSERT INTO layouts VALUES ('default', ?, ?, 1, ?, ?)",
                       (layout.get("name", "Default warehouse"), json.dumps(layout), ts, ts))

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

    def update_model_after_training(self, model_id: str, trained_destinations: int, hp: dict) -> None:
        ts = now()
        self._exec("UPDATE models SET trained_destinations = ?, hyperparameters = ?, updated_at = ?, "
                   "last_trained_at = ? WHERE id = ?", (trained_destinations, json.dumps(hp), ts, ts, model_id))

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
```

Append to the root `.gitignore`:
```
# RoboWare backend data (SQLite database and trained models)
backend/data/
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_storage.py -q`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```
git add .gitignore backend/app/errors.py backend/app/storage.py backend/app/tests/test_storage.py
git commit -m "feat(backend): SQLite storage for layouts, models, sessions and metrics"
```

---

### Task 9: App wiring, training jobs, and the layouts, models and training API

**Files:**
- Create: `backend/app/repository.py`
- Create: `backend/app/training.py`
- Create: `backend/app/services.py`
- Create: `backend/app/schemas.py`
- Create: `backend/app/api/__init__.py` (empty), `backend/app/api/layouts.py`, `backend/app/api/models.py`, `backend/app/api/training.py`
- Modify: `backend/app/main.py`
- Create: `backend/app/tests/conftest.py`, `backend/app/tests/test_api_models.py`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces:
  - From `repository.py`:
    - `load_layout(storage, layout_id) -> Layout`
    - `load_model(storage, model_id) -> (row: dict, hp: Hyperparameters, qtables: QTableSet, histories: dict)`, where `qtables` is empty if the model is untrained
    - `model_meta(row) -> dict`
  - From `training.py`:
    - `TrainingJob` with `to_dict()`
    - `TrainingJobManager(storage)`, with `start(model_id, hp, destinations, seed) -> TrainingJob`, `get(job_id)` and `shutdown()`
  - From `services.py`:
    - `Services(storage, training, sessions)`, with `Services.create(data_dir)` and `async shutdown()`
    - `get_services(request)`
    - Task 10 adds `SessionManager`. Until then, `services.sessions` is `None`.
  - From `main.py`: `create_app(data_dir=None) -> FastAPI` and the module-level `app`.
  - Endpoints:
    - `GET /api/health`
    - `GET`/`POST /api/layouts`, `GET`/`PUT /api/layouts/{id}`
    - `GET`/`POST /api/models`, `GET`/`DELETE /api/models/{id}`
    - `POST /api/models/{id}/train` (202, returns a job dict)
    - `GET /api/models/{id}/qtable?dest=x,y`
    - `GET /api/models/{id}/export`, `POST /api/models/import`
    - `GET /api/training/{job_id}`
  - Job dict: `{id, model_id, status: queued|running|completed|failed, done, total, progress, current_destination, curves: {"x,y": {rewards, steps, episodes}}, error}`.

- [ ] **Step 1: Write the failing tests**

`backend/app/tests/conftest.py`:
```python
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        yield c


def wait_for_job(client, job_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/training/{job_id}").json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError("training job did not finish")
```

`backend/app/tests/test_api_models.py`:
```python
from app.simulation.grid import RACK, default_layout
from app.tests.conftest import wait_for_job


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_default_layout_is_listed(client):
    layouts = client.get("/api/layouts").json()
    assert layouts[0]["id"] == "default" and layouts[0]["is_default"] is True
    detail = client.get("/api/layouts/default").json()
    assert detail["width"] == 16 and len(detail["destinations"]) == 29 and len(detail["products"]) == 24


def test_create_layout_auto_assigns_products_and_validates(client):
    data = default_layout().to_dict()
    created = client.post("/api/layouts", json={"name": "Copy", "width": 16, "height": 10, "cells": data["cells"]})
    assert created.status_code == 201
    assert len(created.json()["products"]) == 24
    cells = [row[:] for row in data["cells"]]
    for x, y in [(13, 8), (15, 8), (14, 7), (14, 9)]:
        cells[y][x] = RACK
    bad = client.put(f"/api/layouts/{created.json()['id']}", json={"name": "Copy", "width": 16, "height": 10, "cells": cells})
    assert bad.status_code == 400
    assert [14, 8] in bad.json()["detail"]["unreachable"]


def test_default_layout_cannot_be_edited(client):
    data = default_layout().to_dict()
    r = client.put("/api/layouts/default", json={"name": "x", "width": 16, "height": 10, "cells": data["cells"]})
    assert r.status_code == 403


def test_create_train_and_read_model(client):
    model = client.post("/api/models", json={"name": "Quick", "hyperparameters": {"episodes_per_destination": 40}}).json()
    assert model["trained_destinations"] == 0 and model["layout_id"] == "default"
    job = client.post(f"/api/models/{model['id']}/train", json={"destinations": [[14, 8], [0, 2]]})
    assert job.status_code == 202
    done = wait_for_job(client, job.json()["id"])
    assert done["status"] == "completed" and done["done"] == 2 and done["progress"] == 1.0
    assert set(done["curves"]) == {"14,8", "0,2"}
    detail = client.get(f"/api/models/{model['id']}").json()
    assert detail["trained_destinations"] == 2
    assert detail["destinations"] == [[0, 2], [14, 8]]
    table = client.get(f"/api/models/{model['id']}/qtable", params={"dest": "14,8"}).json()
    assert len(table["values"]) == 160 and len(table["values"][0]) == 4
    assert client.get(f"/api/models/{model['id']}/qtable", params={"dest": "3,3"}).status_code == 404


def test_train_rejects_unknown_destination(client):
    model = client.post("/api/models", json={"name": "Quick"}).json()
    r = client.post(f"/api/models/{model['id']}/train", json={"destinations": [[4, 1]]})
    assert r.status_code == 400


def test_export_import_roundtrip(client):
    model = client.post("/api/models", json={"name": "Exp", "hyperparameters": {"episodes_per_destination": 20}}).json()
    wait_for_job(client, client.post(f"/api/models/{model['id']}/train", json={"destinations": [[14, 8]]}).json()["id"])
    exported = client.get(f"/api/models/{model['id']}/export")
    assert "attachment" in exported.headers["content-disposition"]
    imported = client.post("/api/models/import", json=exported.json())
    assert imported.status_code == 201
    assert imported.json()["trained_destinations"] == 1 and imported.json()["id"] != model["id"]


def test_import_rejects_malformed_model(client):
    assert client.post("/api/models/import", json={"q_table": [[1, 2]]}).status_code == 400
    assert client.post("/api/models/import", json=[1, 2, 3]).status_code == 400


def test_delete_model_and_404s(client):
    model = client.post("/api/models", json={"name": "Gone"}).json()
    assert client.delete(f"/api/models/{model['id']}").status_code == 204
    assert client.get(f"/api/models/{model['id']}").status_code == 404
    assert client.get("/api/training/nope").status_code == 404
    assert client.post("/api/models", json={"name": ""}).status_code == 422
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_api_models.py -q`
Expected: `ImportError: cannot import name 'create_app'`.

- [ ] **Step 3: Implement the repository helpers** — `backend/app/repository.py`:

```python
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
```

- [ ] **Step 4: Implement training jobs** — `backend/app/training.py`:

```python
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
```

- [ ] **Step 5: Implement the services container** — `backend/app/services.py`:

```python
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
```

- [ ] **Step 6: Implement the request schemas** — `backend/app/schemas.py`:

```python
"""Request bodies (pydantic) for the RoboWare API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HyperparametersIn(BaseModel):
    learning_rate: float = Field(0.1, gt=0, le=1)
    discount_factor: float = Field(0.95, ge=0, lt=1)
    exploration_rate: float = Field(0.3, ge=0, le=1)
    epsilon_decay: bool = False
    epsilon_min: float = Field(0.05, ge=0, le=1)
    step_reward: float = -1.0
    goal_reward: float = 10.0
    episodes_per_destination: int = Field(3000, ge=1, le=50_000)
    max_steps: int = Field(200, ge=1, le=5_000)


class ProductIn(BaseModel):
    sku: str
    name: str
    face: tuple[int, int]
    stock: int = Field(ge=0)


class LayoutIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    width: int = Field(ge=4, le=40)
    height: int = Field(ge=4, le=40)
    cells: list[list[str]]
    products: list[ProductIn] | None = None  # None: assign products automatically


class ModelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    layout_id: str = "default"
    hyperparameters: HyperparametersIn = Field(default_factory=HyperparametersIn)


class TrainRequest(BaseModel):
    hyperparameters: HyperparametersIn | None = None
    destinations: list[tuple[int, int]] | None = None
    seed: int = 0


class OrderSettingsIn(BaseModel):
    rate_per_100: float = Field(6.0, ge=0, le=100)
    size_weights: list[float] = Field(default_factory=lambda: [0.5, 0.3, 0.2], min_length=1, max_length=3)
    rush_fraction: float = Field(0.1, ge=0, le=1)
    seed: int = 42


class StopIn(BaseModel):
    type: Literal["ticks", "orders", "manual"] = "ticks"
    value: int | None = Field(2000, ge=1)


RoutingMode = Literal["hybrid", "q_only", "astar"]
Speed = Literal[1, 2, 5, 10, "max"]


class SessionCreate(BaseModel):
    name: str = Field("", max_length=80)
    layout_id: str = "default"
    model_id: str | None = None
    routing_mode: RoutingMode = "hybrid"
    hybrid_margin: float = Field(0.5, ge=0)
    robot_count: int = Field(4, ge=1, le=8)
    orders: OrderSettingsIn = Field(default_factory=OrderSettingsIn)
    stop: StopIn = Field(default_factory=StopIn)
    online_learning: bool = False
    metrics_every: int = Field(10, ge=1, le=1000)


class ControlIn(BaseModel):
    action: Literal["play", "pause", "step", "stop", "set_speed"]
    speed: Speed | None = None


class OrderItemIn(BaseModel):
    sku: str
    qty: int = Field(1, ge=1, le=10)


class InjectOrderIn(BaseModel):
    items: list[OrderItemIn] | None = Field(None, min_length=1, max_length=3)
    priority: Literal["normal", "rush"] = "normal"


class SaveModelIn(BaseModel):
    name: str | None = Field(None, max_length=80)


class CompareRun(BaseModel):
    model_id: str | None = None
    routing_mode: RoutingMode = "astar"


class CompareRequest(BaseModel):
    layout_id: str = "default"
    runs: list[CompareRun] = Field(min_length=1, max_length=6)
    robot_count: int = Field(4, ge=1, le=8)
    orders: OrderSettingsIn = Field(default_factory=lambda: OrderSettingsIn(rate_per_100=20))
    ticks: int = Field(2000, ge=10, le=5000)
    hybrid_margin: float = Field(0.5, ge=0)
```

- [ ] **Step 7: Implement the routers**

`backend/app/api/layouts.py`:
```python
from fastapi import APIRouter, Depends

from ..schemas import LayoutIn
from ..services import Services, get_services
from ..simulation.grid import Layout, assign_products
from ..simulation.models import Product

router = APIRouter(tags=["layouts"])


def _detail(services: Services, layout_id: str) -> dict:
    row = services.storage.get_layout(layout_id)
    layout = Layout.from_dict(row["layout"])
    return {"id": row["id"], "is_default": row["is_default"], "updated_at": row["updated_at"], **layout.to_dict(),
            "name": row["name"]}


def _build(body: LayoutIn) -> Layout:
    layout = Layout.from_dict({"name": body.name, "width": body.width, "height": body.height, "cells": body.cells})
    if body.products is None:
        layout.products = assign_products(layout)
    else:
        layout.products = [Product(p.sku, p.name, tuple(p.face), p.stock) for p in body.products]
    layout.validate()
    return layout


@router.get("/layouts")
def list_layouts(services: Services = Depends(get_services)):
    return services.storage.list_layouts()


@router.get("/layouts/{layout_id}")
def get_layout(layout_id: str, services: Services = Depends(get_services)):
    return _detail(services, layout_id)


@router.post("/layouts", status_code=201)
def create_layout(body: LayoutIn, services: Services = Depends(get_services)):
    layout = _build(body)
    return _detail(services, services.storage.create_layout(body.name, layout.to_dict()))


@router.put("/layouts/{layout_id}")
def update_layout(layout_id: str, body: LayoutIn, services: Services = Depends(get_services)):
    services.storage.get_layout(layout_id)
    layout = _build(body)
    services.storage.update_layout(layout_id, body.name, layout.to_dict())
    return _detail(services, layout_id)
```

`backend/app/api/models.py`:
```python
from fastapi import APIRouter, Body, Depends, Response
from fastapi.responses import JSONResponse

from ..errors import NotFound
from ..repository import load_layout, load_model, model_meta
from ..schemas import ModelCreate, TrainRequest
from ..services import Services, get_services
from ..simulation.models import Hyperparameters
from ..simulation.q_learning import export_model, import_model, parse_dest_key

router = APIRouter(tags=["models"])


@router.get("/models")
def list_models(services: Services = Depends(get_services)):
    return services.storage.list_models()


@router.post("/models", status_code=201)
def create_model(body: ModelCreate, services: Services = Depends(get_services)):
    layout = load_layout(services.storage, body.layout_id)
    mid = services.storage.create_model(body.name, body.layout_id, layout.fingerprint(),
                                        body.hyperparameters.model_dump())
    return services.storage.get_model(mid)


@router.get("/models/{model_id}")
def get_model(model_id: str, services: Services = Depends(get_services)):
    row, _, qtables, histories = load_model(services.storage, model_id)
    layout = load_layout(services.storage, row["layout_id"])
    return {**row, "destinations": [list(d) for d in qtables.destinations()],
            "layout_destinations": [list(d) for d in layout.destinations()],
            "layout_matches": row["layout_fingerprint"] == layout.fingerprint(),
            "training_history": histories}


@router.delete("/models/{model_id}", status_code=204)
def delete_model(model_id: str, services: Services = Depends(get_services)):
    services.storage.delete_model(model_id)
    return Response(status_code=204)


@router.post("/models/{model_id}/train", status_code=202)
def train(model_id: str, body: TrainRequest, services: Services = Depends(get_services)):
    row = services.storage.get_model(model_id)
    hp = Hyperparameters.from_dict(body.hyperparameters.model_dump() if body.hyperparameters else row["hyperparameters"])
    dests = [tuple(d) for d in body.destinations] if body.destinations else None
    return services.training.start(model_id, hp, dests, body.seed).to_dict()


@router.get("/models/{model_id}/qtable")
def get_qtable(model_id: str, dest: str, services: Services = Depends(get_services)):
    _, _, qtables, _ = load_model(services.storage, model_id)
    try:
        cell = parse_dest_key(dest)
    except ValueError as exc:
        raise ValueError('dest must look like "x,y"') from exc
    table = qtables.get(cell)
    if table is None:
        raise NotFound(f"No Q-table for destination {dest}")
    return {"destination": list(cell), "width": qtables.width, "height": qtables.height, "values": table.tolist()}


@router.get("/models/{model_id}/export")
def export(model_id: str, services: Services = Depends(get_services)):
    row, hp, qtables, histories = load_model(services.storage, model_id)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in row["name"])
    return JSONResponse(export_model(model_meta(row), hp, qtables, histories),
                        headers={"Content-Disposition": f'attachment; filename="{safe}.roboware.json"'})


@router.post("/models/import", status_code=201)
def import_(data=Body(...), services: Services = Depends(get_services)):
    meta, hp, qtables, histories = import_model(data)
    layout_id = meta.get("layout_id") or "default"
    try:
        layout = load_layout(services.storage, layout_id)
    except NotFound:
        layout_id, layout = "default", load_layout(services.storage, "default")
    if (qtables.width, qtables.height) != (layout.width, layout.height):
        raise ValueError(f"Model grid {qtables.width}x{qtables.height} does not match layout {layout.width}x{layout.height}.")
    name = f"{meta.get('name') or 'Imported model'} (imported)"
    mid = services.storage.create_model(name, layout_id, meta.get("layout_fingerprint") or layout.fingerprint(),
                                        hp.to_dict())
    row = services.storage.get_model(mid)
    services.storage.save_model_file(mid, export_model(model_meta(row), hp, qtables, histories))
    services.storage.update_model_after_training(mid, len(qtables), hp.to_dict())
    return services.storage.get_model(mid)
```

`backend/app/api/training.py`:
```python
from fastapi import APIRouter, Depends

from ..services import Services, get_services

router = APIRouter(tags=["training"])


@router.get("/training/{job_id}")
def get_job(job_id: str, services: Services = Depends(get_services)):
    return services.training.get(job_id).to_dict()
```

- [ ] **Step 8: Replace `backend/app/main.py`**

```python
"""RoboWare API: layouts, models, training jobs, automated sessions and comparisons."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import layouts, models, training
from .errors import Conflict, Forbidden, NotFound
from .services import Services
from .simulation.grid import LayoutError

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def create_app(data_dir: Path | str | None = None) -> FastAPI:
    resolved = Path(data_dir or os.environ.get("ROBOWARE_DATA_DIR") or DEFAULT_DATA_DIR)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.services = Services.create(resolved)
        yield
        await app.state.services.shutdown()

    app = FastAPI(title="RoboWare API", lifespan=lifespan)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "message": "RoboWare backend is connected"}

    for router in (layouts.router, models.router, training.router):
        app.include_router(router, prefix="/api")

    @app.exception_handler(NotFound)
    async def not_found(_: Request, exc: NotFound):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(Forbidden)
    async def forbidden(_: Request, exc: Forbidden):
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(Conflict)
    async def conflict(_: Request, exc: Conflict):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(LayoutError)
    async def bad_layout(_: Request, exc: LayoutError):
        return JSONResponse({"detail": {"message": str(exc), "unreachable": [list(c) for c in exc.unreachable]}},
                            status_code=400)

    @app.exception_handler(ValueError)
    async def bad_value(_: Request, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    return app


app = create_app()
```

`LayoutError` subclasses `ValueError`. Starlette looks up handlers along the exception's MRO, so the `LayoutError` handler wins for layout errors.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_api_models.py -q`
Expected: all pass.

- [ ] **Step 10: Run the whole suite and smoke-test the server once**

Run: `.venv\Scripts\python.exe -m pytest -q`, then `.venv\Scripts\python.exe -m uvicorn app.main:app --port 8080`, open `http://127.0.0.1:8080/api/layouts` (expect a JSON list with `default`), and stop the server.

- [ ] **Step 11: Commit**

```
git add backend/app
git commit -m "feat(backend): API for layouts, models and background training jobs"
```

---

### Task 10: Live sessions, the WebSocket stream and comparisons

**Files:**
- Create: `backend/app/sessions.py`
- Create: `backend/app/api/sessions.py`, `backend/app/api/compare.py`
- Modify: `backend/app/services.py` (construct a `SessionManager`)
- Modify: `backend/app/main.py` (register the two routers)
- Create: `backend/app/tests/test_api_sessions.py`

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces:
  - `LiveSession`, with `.state() -> {id, name, status, speed, tick, config, model_name, error}`.
  - `SessionManager(storage)`, with these methods:
    - `create(config) -> (LiveSession, warnings: list[str])`
    - `get(id)`; raises `NotFound`, or `Conflict` when the session exists in the database but isn't live
    - `async control(id, action, speed=None) -> state dict`
    - `inject(id, items, priority) -> order dict`
    - `save_model(id, name=None) -> model row`
    - `subscribe(live) -> asyncio.Queue` and `unsubscribe(live, queue)`
    - `async shutdown()`
  - Endpoints:
    - `POST /api/sessions` (201; state plus `warnings`)
    - `GET /api/sessions`; each row adds `live` and `tick`
    - `GET /api/sessions/{id}`; the row plus `metrics`, `orders`, `live` and `tick`
    - `POST /api/sessions/{id}/control`
    - `POST /api/sessions/{id}/orders` (201)
    - `POST /api/sessions/{id}/save-model` (201)
    - `WS /api/sessions/{id}/stream`
    - `POST /api/compare`, returning `{"runs": [{label, model_id, routing_mode, summary, series: [{tick, throughput_per_100, delivered}]}]}`
  - WebSocket messages, server to client:
    - `{"type": "snapshot", "session", "layout", ...frame}` once
    - then `{"type": "frame", "session", ...frame}`
    - and `{"type": "error", "message"}`
  - WebSocket messages, client to server: `{"type": "control", "action", "speed"?}`.
  - Unknown or non-live sessions: the server accepts, then closes with code 4404.

- [ ] **Step 1: Write the failing tests** — `backend/app/tests/test_api_sessions.py`:

```python
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.tests.conftest import wait_for_job


def create(client, **overrides):
    body = {"routing_mode": "astar", "robot_count": 2, "orders": {"rate_per_100": 20, "seed": 1},
            "stop": {"type": "ticks", "value": 30}} | overrides
    response = client.post("/api/sessions", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def control(client, sid, action, speed=None):
    return client.post(f"/api/sessions/{sid}/control", json={"action": action, "speed": speed})


def wait_finished(client, sid, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        detail = client.get(f"/api/sessions/{sid}").json()
        if detail["status"] == "finished":
            return detail
        time.sleep(0.05)
    raise AssertionError("session did not finish")


def test_session_lifecycle_with_steps(client):
    s = create(client)
    assert s["status"] == "created" and s["warnings"] == [] and s["tick"] == 0
    for _ in range(3):
        state = control(client, s["id"], "step").json()
    assert state["tick"] == 3 and state["status"] == "paused"
    order = client.post(f"/api/sessions/{s['id']}/orders",
                        json={"items": [{"sku": "SKU-001", "qty": 1}], "priority": "rush"})
    assert order.status_code == 201 and order.json()["priority"] == "rush"
    assert control(client, s["id"], "stop").json()["status"] == "finished"
    detail = client.get(f"/api/sessions/{s['id']}").json()
    assert detail["status"] == "finished" and detail["live"] is False
    assert detail["summary"]["ticks"] == 3
    assert detail["metrics"][-1]["tick"] == 3
    assert control(client, s["id"], "play").status_code == 409
    listed = client.get("/api/sessions").json()
    assert listed[0]["id"] == s["id"] and listed[0]["tick"] == 3


def test_play_at_max_speed_runs_to_the_stop_condition(client):
    s = create(client)
    assert control(client, s["id"], "play", "max").status_code == 200
    detail = wait_finished(client, s["id"])
    assert detail["summary"]["ticks"] == 30
    assert [m["tick"] for m in detail["metrics"]][:3] == [10, 20, 30]


def test_session_with_untrained_model_warns(client):
    model = client.post("/api/models", json={"name": "Empty"}).json()
    s = create(client, model_id=model["id"], routing_mode="q_only")
    assert any("no trained destinations" in w for w in s["warnings"])
    assert control(client, s["id"], "step").json()["tick"] == 1


def test_q_only_without_model_warns(client):
    assert any("No model selected" in w for w in create(client, routing_mode="q_only")["warnings"])


def test_invalid_session_requests(client):
    s = create(client)
    assert client.post(f"/api/sessions/{s['id']}/orders", json={"items": [{"sku": "NOPE", "qty": 1}]}).status_code == 400
    assert client.post("/api/sessions", json={"robot_count": 9}).status_code == 422
    assert client.post("/api/sessions", json={"online_learning": True}).status_code == 400
    assert control(client, "ses_missing", "play").status_code == 404
    assert control(client, s["id"], "play").status_code == 200
    assert control(client, s["id"], "step").status_code == 409
    control(client, s["id"], "stop")


def test_stream_sends_snapshot_then_frames(client):
    s = create(client)
    with client.websocket_connect(f"/api/sessions/{s['id']}/stream") as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "snapshot"
        assert snapshot["layout"]["width"] == 16 and len(snapshot["robots"]) == 2
        ws.send_json({"type": "control", "action": "step"})
        frame = ws.receive_json()
        assert frame["type"] == "frame" and frame["tick"] == 1 and frame["session"]["status"] == "paused"
        ws.send_json({"type": "control", "action": "bogus"})
        assert ws.receive_json()["type"] == "error"


def test_stream_unknown_session_closes_4404(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/sessions/ses_missing/stream") as ws:
            ws.receive_json()
    assert exc.value.code == 4404


def test_online_learning_session_saves_a_new_model_version(client):
    model = client.post("/api/models", json={"name": "Base", "hyperparameters": {"episodes_per_destination": 30}}).json()
    wait_for_job(client, client.post(f"/api/models/{model['id']}/train", json={}).json()["id"])
    s = create(client, model_id=model["id"], routing_mode="q_only", online_learning=True)
    control(client, s["id"], "play", "max")
    wait_finished(client, s["id"])
    saved = client.post(f"/api/sessions/{s['id']}/save-model", json={})
    assert saved.status_code == 201
    assert saved.json()["parent_model_id"] == model["id"] and saved.json()["version"] == 2
    assert saved.json()["trained_destinations"] == 29
    plain = create(client)
    assert client.post(f"/api/sessions/{plain['id']}/save-model", json={}).status_code == 409


def test_compare_runs_each_configuration(client):
    response = client.post("/api/compare", json={"runs": [{"routing_mode": "astar"}, {"routing_mode": "q_only"}],
                                                 "ticks": 200, "robot_count": 2})
    assert response.status_code == 200
    runs = response.json()["runs"]
    assert [r["routing_mode"] for r in runs] == ["astar", "q_only"]
    assert runs[0]["summary"]["ticks"] == 200 and runs[0]["series"][-1]["tick"] == 200
    assert runs[0]["label"] == "No model · A*"
    too_many = {"runs": [{"routing_mode": "astar"}] * 7}
    assert client.post("/api/compare", json=too_many).status_code == 422
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_api_sessions.py -q`
Expected: failures with 404 or 405 on `/api/sessions`.

- [ ] **Step 3: Implement** — `backend/app/sessions.py`:

```python
"""Live sessions: one asyncio task per running session, broadcasting frames to WebSocket subscribers."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field

from .errors import Conflict, NotFound
from .repository import load_layout, load_model, model_meta
from .simulation.models import SessionConfig
from .simulation.q_learning import export_model
from .simulation.simulator import Simulator
from .storage import Storage, now

log = logging.getLogger("roboware.sessions")

TICK_SECONDS_1X = 0.6
MAX_FPS = 20
MAX_SPEED_BATCH = 50
METRICS_FLUSH = 20
MAX_PENDING_EVENTS = 500
QUEUE_SIZE = 8
SPEEDS = (1, 2, 5, 10, "max")
MODE_LABELS = {"hybrid": "Hybrid", "q_only": "Q-only", "astar": "A*"}


@dataclass
class LiveSession:
    id: str
    name: str
    config: SessionConfig
    sim: Simulator
    model_name: str | None = None
    status: str = "created"
    speed: int | str = 1
    error: str | None = None
    task: asyncio.Task | None = None
    subscribers: set = field(default_factory=set)
    pending_events: list = field(default_factory=list)
    metrics_buffer: list = field(default_factory=list)
    last_frame: float = 0.0
    finalized: bool = False

    def state(self) -> dict:
        return {"id": self.id, "name": self.name, "status": self.status, "speed": self.speed,
                "tick": self.sim.tick, "config": self.config.to_dict(), "model_name": self.model_name,
                "error": self.error}


class SessionManager:
    def __init__(self, storage: Storage):
        self.storage = storage
        self.live: dict[str, LiveSession] = {}

    # -- lifecycle

    def create(self, config: SessionConfig) -> tuple[LiveSession, list[str]]:
        if config.online_learning and not config.model_id:
            raise ValueError("Online learning needs a model to learn into.")
        layout = load_layout(self.storage, config.layout_id)
        warnings: list[str] = []
        qtables = hp = model_name = None
        if config.model_id:
            row, hp, qtables, _ = load_model(self.storage, config.model_id)
            model_name = row["name"]
            if row["layout_fingerprint"] != layout.fingerprint():
                warnings.append("This model was trained on a different layout; destinations without a table fall back to A*.")
            if len(qtables) == 0:
                warnings.append("This model has no trained destinations yet, so every leg uses A*.")
        elif config.routing_mode != "astar":
            warnings.append("No model selected, so every leg uses A*.")
        sim = Simulator(layout, config, qtables, hp)
        name = config.name or f"{MODE_LABELS[config.routing_mode]} · {model_name or 'no model'} · {len(sim.robots)} robots"
        live = LiveSession(self.storage.create_session(name, config.to_dict()), name, config, sim, model_name)
        self.live[live.id] = live
        return live, warnings

    def get(self, session_id: str) -> LiveSession:
        live = self.live.get(session_id)
        if live is None:
            self.storage.get_session(session_id)  # raises NotFound for unknown ids
            raise Conflict("This session is no longer live (the server restarted). Start a new one.")
        return live

    async def control(self, session_id: str, action: str, speed=None) -> dict:
        live = self.get(session_id)
        if live.status in ("finished", "interrupted"):
            raise Conflict(f"This session is {live.status}.")
        if speed is not None:
            if speed not in SPEEDS:
                raise ValueError(f"Unknown speed: {speed}")
            live.speed = speed
        if action == "play":
            live.status = "running"
            if live.task is None or live.task.done():
                live.task = asyncio.create_task(self._run(live))
        elif action == "pause":
            live.status = "paused"
        elif action == "step":
            if live.status == "running":
                raise Conflict("Pause the session before stepping.")
            live.status = "paused"
            self._advance(live, 1)
        elif action == "stop":
            await self._finish(live)
            return live.state()
        elif action != "set_speed":
            raise ValueError(f"Unknown action: {action}")
        if live.sim.finished:
            await self._finish(live)
        else:
            self.storage.update_session(live.id, status=live.status)
            await self._broadcast(live, force=True)
        return live.state()

    def inject(self, session_id: str, items: list[dict] | None, priority: str) -> dict:
        live = self.get(session_id)
        if live.status in ("finished", "interrupted"):
            raise Conflict(f"This session is {live.status}.")
        if items:
            unknown = [i["sku"] for i in items if i["sku"] not in live.sim.inventory.stock]
            if unknown:
                raise ValueError(f"Unknown SKU: {', '.join(unknown)}")
        return live.sim.inject_order(items, priority).to_dict()

    def save_model(self, session_id: str, name: str | None = None) -> dict:
        live = self.get(session_id)
        if not live.config.online_learning or live.sim.qtables is None:
            raise Conflict("Online learning was off for this session, so there is nothing new to save.")
        parent = self.storage.get_model(live.config.model_id)
        _, _, _, histories = load_model(self.storage, parent["id"])
        version = parent["version"] + 1
        mid = self.storage.create_model(name or f"{parent['name']} v{version}", parent["layout_id"],
                                        parent["layout_fingerprint"], live.sim.hp.to_dict(),
                                        parent_model_id=parent["id"], version=version)
        row = self.storage.get_model(mid)
        self.storage.save_model_file(mid, export_model(model_meta(row), live.sim.hp, live.sim.qtables, histories))
        self.storage.update_model_after_training(mid, len(live.sim.qtables), live.sim.hp.to_dict())
        return self.storage.get_model(mid)

    # -- subscribers

    def subscribe(self, live: LiveSession) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        live.subscribers.add(queue)
        return queue

    def unsubscribe(self, live: LiveSession, queue: asyncio.Queue) -> None:
        live.subscribers.discard(queue)

    async def shutdown(self) -> None:
        for live in self.live.values():
            if live.task and not live.task.done():
                live.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await live.task

    # -- internals

    async def _run(self, live: LiveSession) -> None:
        try:
            while live.status == "running" and not live.sim.finished:
                if live.speed == "max":
                    self._advance(live, MAX_SPEED_BATCH)
                    await self._broadcast(live)
                    await asyncio.sleep(0)
                else:
                    self._advance(live, 1)
                    await self._broadcast(live)
                    await asyncio.sleep(TICK_SECONDS_1X / live.speed)
            if live.sim.finished and not live.finalized:
                await self._finish(live)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # keep the server alive; mark the session as broken
            log.exception("session %s crashed", live.id)
            live.status, live.error, live.finalized = "interrupted", str(exc), True
            self.storage.update_session(live.id, status="interrupted", error=str(exc), ended_at=now())
            await self._send(live, {"type": "error", "message": f"Session stopped: {exc}"})

    def _advance(self, live: LiveSession, ticks: int) -> None:
        for _ in range(ticks):
            live.pending_events.extend(live.sim.step())
            if live.sim.tick % live.config.metrics_every == 0:
                live.metrics_buffer.append(live.sim.live_stats())
            if live.sim.finished:
                break
        if len(live.pending_events) > MAX_PENDING_EVENTS:
            live.pending_events = live.pending_events[-MAX_PENDING_EVENTS:]
        if len(live.metrics_buffer) >= METRICS_FLUSH:
            self._flush_metrics(live)

    def _flush_metrics(self, live: LiveSession) -> None:
        self.storage.add_metrics(live.id, live.metrics_buffer)
        live.metrics_buffer = []

    async def _finish(self, live: LiveSession) -> None:
        if live.finalized:
            return
        live.finalized = True
        live.sim.stop()
        live.status = "finished"
        live.metrics_buffer.append(live.sim.live_stats())
        self._flush_metrics(live)
        self.storage.save_orders(live.id, [o.to_dict() for o in live.sim.orders.values()])
        self.storage.update_session(live.id, status="finished", summary=live.sim.summary(), ended_at=now())
        await self._broadcast(live, force=True)

    async def _broadcast(self, live: LiveSession, force: bool = False) -> None:
        t = time.monotonic()
        if not force and t - live.last_frame < 1 / MAX_FPS:
            return
        live.last_frame = t
        frame = {"type": "frame", "session": live.state(), **live.sim.snapshot(live.pending_events)}
        live.pending_events = []
        await self._send(live, frame)

    async def _send(self, live: LiveSession, message: dict) -> None:
        for queue in list(live.subscribers):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()  # drop the oldest frame for slow clients
            queue.put_nowait(message)
```

`backend/app/api/sessions.py`:
```python
import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from ..errors import Conflict, NotFound
from ..schemas import ControlIn, InjectOrderIn, SaveModelIn, SessionCreate
from ..services import Services, get_services
from ..simulation.models import SessionConfig

router = APIRouter(tags=["sessions"])


def _with_live(services: Services, row: dict) -> dict:
    live = services.sessions.live.get(row["id"])
    row["live"] = live is not None and not live.finalized
    if live is not None:
        row["status"] = live.status
        row["tick"] = live.sim.tick
    else:
        row["tick"] = (row["summary"] or {}).get("ticks", 0)
    return row


@router.post("/sessions", status_code=201)
async def create_session(body: SessionCreate, services: Services = Depends(get_services)):
    live, warnings = services.sessions.create(SessionConfig.from_dict(body.model_dump()))
    return {**live.state(), "warnings": warnings}


@router.get("/sessions")
async def list_sessions(services: Services = Depends(get_services)):
    return [_with_live(services, row) for row in services.storage.list_sessions()]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, services: Services = Depends(get_services)):
    row = _with_live(services, services.storage.get_session(session_id))
    row["metrics"] = services.storage.get_metrics(session_id)
    row["orders"] = services.storage.get_orders(session_id)
    live = services.sessions.live.get(session_id)
    if live is not None and not live.finalized:
        row["metrics"] += live.metrics_buffer
        row["summary"] = live.sim.summary()
    return row


@router.post("/sessions/{session_id}/control")
async def control(session_id: str, body: ControlIn, services: Services = Depends(get_services)):
    return await services.sessions.control(session_id, body.action, body.speed)


@router.post("/sessions/{session_id}/orders", status_code=201)
async def inject_order(session_id: str, body: InjectOrderIn, services: Services = Depends(get_services)):
    items = [i.model_dump() for i in body.items] if body.items else None
    return services.sessions.inject(session_id, items, body.priority)


@router.post("/sessions/{session_id}/save-model", status_code=201)
async def save_model(session_id: str, body: SaveModelIn | None = None, services: Services = Depends(get_services)):
    return services.sessions.save_model(session_id, body.name if body else None)


async def _pump(websocket: WebSocket, queue: asyncio.Queue) -> None:
    while True:
        await websocket.send_json(await queue.get())


@router.websocket("/sessions/{session_id}/stream")
async def stream(websocket: WebSocket, session_id: str):
    services: Services = websocket.app.state.services
    await websocket.accept()
    try:
        live = services.sessions.get(session_id)
    except (NotFound, Conflict) as exc:
        await websocket.close(code=4404, reason=str(exc)[:120])
        return
    queue = services.sessions.subscribe(live)
    sender = None
    try:
        await websocket.send_json({"type": "snapshot", "session": live.state(),
                                   "layout": live.sim.layout.to_dict(), **live.sim.snapshot()})
        sender = asyncio.create_task(_pump(websocket, queue))
        while True:
            message = await websocket.receive_json()
            if message.get("type") != "control":
                continue
            try:
                await services.sessions.control(session_id, message.get("action"), message.get("speed"))
            except (Conflict, NotFound, ValueError) as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        if sender is not None:
            sender.cancel()
        services.sessions.unsubscribe(live, queue)
```

`backend/app/api/compare.py`:
```python
from fastapi import APIRouter, Depends

from ..repository import load_layout, load_model
from ..schemas import CompareRequest
from ..services import Services, get_services
from ..simulation.models import OrderSettings, SessionConfig, StopCondition
from ..simulation.simulator import Simulator

router = APIRouter(tags=["compare"])
MODE_LABELS = {"hybrid": "Hybrid", "q_only": "Q-only", "astar": "A*"}


@router.post("/compare")
def compare(body: CompareRequest, services: Services = Depends(get_services)):
    """Replay one seeded workload per run, headless. A plain `def` so FastAPI runs it in the threadpool."""
    layout = load_layout(services.storage, body.layout_id)
    every = max(10, body.ticks // 100)
    results = []
    for run in body.runs:
        qtables = hp = None
        model_name = "No model"
        if run.model_id:
            row, hp, qtables, _ = load_model(services.storage, run.model_id)
            model_name = row["name"]
        config = SessionConfig(layout_id=body.layout_id, model_id=run.model_id, routing_mode=run.routing_mode,
                               hybrid_margin=body.hybrid_margin, robot_count=body.robot_count,
                               orders=OrderSettings.from_dict(body.orders.model_dump()),
                               stop=StopCondition("ticks", body.ticks), metrics_every=every)
        sim = Simulator(layout, config, qtables, hp)
        series = []
        while not sim.finished:
            sim.step()
            if sim.tick % every == 0 or sim.finished:
                series.append({"tick": sim.tick, "throughput_per_100": sim.metrics.throughput(sim.tick),
                               "delivered": sim.metrics.delivered})
        results.append({"label": f"{model_name} · {MODE_LABELS[run.routing_mode]}", "model_id": run.model_id,
                        "routing_mode": run.routing_mode, "summary": sim.summary(), "series": series})
    return {"runs": results}
```

- [ ] **Step 4: Wire everything in**

In `backend/app/services.py`, add `from .sessions import SessionManager`. Change `Services.create` to return `cls(storage, TrainingJobManager(storage), SessionManager(storage))`, and type the field as `sessions: "SessionManager | None" = None` (it no longer needs `Any`; remove that import).

In `backend/app/main.py`, change the router import and loop to:
```python
from .api import compare, layouts, models, sessions, training
...
    for router in (layouts.router, models.router, training.router, sessions.router, compare.router):
        app.include_router(router, prefix="/api")
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv\Scripts\python.exe -m pytest app/tests/test_api_sessions.py -q`, then `.venv\Scripts\python.exe -m pytest -q`
Expected: all pass. If `test_play_at_max_speed...` sees metric ticks `[10, 20, 30, 30]`, that's expected: the final row duplicates tick 30, and `INSERT OR REPLACE` keeps one copy. The test slices only the first three.

- [ ] **Step 6: Commit**

```
git add backend/app
git commit -m "feat(backend): live sessions over WebSocket, session API and seeded comparisons"
```

---

### Task 11: Frontend foundation (API client, live stream, app shell)

**Files:**
- Modify: `frontend/package.json` (add the `vitest` dev dependency and a `test` script)
- Modify: `frontend/vite.config.js` (proxy WebSockets; target taken from env)
- Modify: `frontend/eslint.config.js` (Node globals for config files)
- Modify: `frontend/index.html` (title)
- Create: `frontend/src/services/api.js`
- Create: `frontend/src/services/sessionStream.js`, `frontend/src/services/sessionStream.test.js`
- Create: `frontend/src/lib/grid.js`, `frontend/src/lib/grid.test.js`
- Create: `frontend/src/components/toastContext.js`, `frontend/src/components/Toast.jsx`
- Create: `frontend/src/components/NavRail.jsx`
- Create: `frontend/src/views/SessionView.jsx`, `ModelsView.jsx`, `LayoutsView.jsx`, `HistoryView.jsx` (placeholders here; built in Tasks 12–15)
- Modify: `frontend/src/App.jsx` (replace it with the shell)
- Modify: `frontend/src/index.css` (append shell, form, table, modal and toast styles)
- Modify: every file in `frontend/src/components/*.jsx` (remove the unused `React` default import)

**Interfaces:**
- Consumes: the backend endpoints and WebSocket messages from Tasks 9–10.
- Produces:
  - `api` (object of async functions; see Step 4), plus `ApiError` and `errorMessage`.
  - `sessionReducer(state, message)`, `initialSessionState`, `streamUrl(id, loc)` and `connectSessionStream(id, onMessage, opts) -> {send, close}`.
  - From `lib/grid.js`: `colLabel(x)`, `coordLabel(x, y)`, `ACTIONS`, `ACTION_ARROWS`, `pickFaces(cells)`, `cellKey(x, y)`.
  - `useToast() -> push(message, tone = 'error' | 'info' | 'success')`.
  - `<ToastProvider>`, `<NavRail view onChange>`.
  - The view components receive these props: `SessionView({ sessionId, onSessionChange })`, `ModelsView()`, `LayoutsView()`, `HistoryView({ onOpenSession })`.

- [ ] **Step 1: Add Vitest and configure tooling**

Run (from `frontend/`): `npm install --save-dev vitest`. Use the latest release, which supports Vite 8. If npm reports a peer conflict with `vite@8`, install the newest `vitest` major whose peer range includes Vite 8. Don't use `--force`.
In `package.json` `scripts`, add `"test": "vitest run"`.

Replace `frontend/vite.config.js`:
```js
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: "node",
  },
});
```

In `frontend/eslint.config.js`, add this config object after the existing one (inside the `defineConfig([...])` array):
```js
  {
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
```

In `frontend/index.html`, change `<title>frontend</title>` to `<title>RoboWare</title>`.

- [ ] **Step 2: Write the failing tests**

`frontend/src/services/sessionStream.test.js`:
```js
import { describe, expect, it } from 'vitest';
import { initialSessionState, sessionReducer, streamUrl } from './sessionStream';

const frame = (tick, events = []) => ({
  type: 'frame', tick, finished: false, robots: [{ id: 'R1' }], orders: [], stations: [], stock: {}, stats: { tick },
  events, session: { id: 's1', status: 'running' },
});

describe('sessionReducer', () => {
  it('stores the layout from the snapshot and keeps it across frames', () => {
    let state = sessionReducer(initialSessionState, { ...frame(0), type: 'snapshot', layout: { width: 16 } });
    expect(state.layout.width).toBe(16);
    state = sessionReducer(state, frame(1));
    expect(state.layout.width).toBe(16);
    expect(state.tick).toBe(1);
    expect(state.session.status).toBe('running');
  });

  it('prepends events newest first and caps the history', () => {
    let state = sessionReducer(initialSessionState, { ...frame(0), type: 'snapshot', layout: {} });
    for (let i = 1; i <= 60; i += 1) state = sessionReducer(state, frame(i, [{ type: 'delivered', n: i }]));
    expect(state.recentEvents).toHaveLength(50);
    expect(state.recentEvents[0].n).toBe(60);
  });

  it('tracks connection state and errors', () => {
    let state = sessionReducer(initialSessionState, { type: 'connected' });
    expect(state.connected).toBe(true);
    state = sessionReducer(state, { type: 'error', message: 'boom' });
    expect(state.error).toBe('boom');
    expect(sessionReducer(state, { type: 'reset' })).toEqual(initialSessionState);
  });
});

describe('streamUrl', () => {
  it('uses ws or wss to match the page', () => {
    expect(streamUrl('s1', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/api/sessions/s1/stream');
    expect(streamUrl('s1', { protocol: 'https:', host: 'x.dev' })).toBe('wss://x.dev/api/sessions/s1/stream');
  });
});
```

`frontend/src/lib/grid.test.js`:
```js
import { describe, expect, it } from 'vitest';
import { coordLabel, colLabel, pickFaces } from './grid';

describe('grid helpers', () => {
  it('labels columns like a spreadsheet', () => {
    expect(colLabel(0)).toBe('A');
    expect(colLabel(25)).toBe('Z');
    expect(colLabel(26)).toBe('AA');
    expect(coordLabel(3, 0)).toBe('D1');
  });

  it('finds aisle cells next to racks', () => {
    const cells = [
      ['aisle', 'rack', 'aisle'],
      ['aisle', 'aisle', 'dock'],
    ];
    expect(pickFaces(cells)).toEqual([[0, 0], [2, 0], [1, 1]]);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test`
Expected: failures resolving `./sessionStream` and `./grid`.

- [ ] **Step 4: Implement the services and helpers**

`frontend/src/services/api.js`:
```js
// Thin fetch wrapper for the RoboWare FastAPI backend (proxied at /api by Vite).
export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function errorMessage(data, status) {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;
  if (Array.isArray(detail) && detail[0]?.msg) {
    const where = (detail[0].loc ?? []).slice(1).join('.');
    return where ? `${where}: ${detail[0].msg}` : detail[0].msg;
  }
  return `Request failed (${status})`;
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status, data?.detail);
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  listLayouts: () => request('GET', '/layouts'),
  getLayout: (id) => request('GET', `/layouts/${id}`),
  createLayout: (body) => request('POST', '/layouts', body),
  updateLayout: (id, body) => request('PUT', `/layouts/${id}`, body),
  listModels: () => request('GET', '/models'),
  getModel: (id) => request('GET', `/models/${id}`),
  createModel: (body) => request('POST', '/models', body),
  deleteModel: (id) => request('DELETE', `/models/${id}`),
  trainModel: (id, body) => request('POST', `/models/${id}/train`, body),
  getTrainingJob: (jobId) => request('GET', `/training/${jobId}`),
  getQTable: (id, dest) => request('GET', `/models/${id}/qtable?dest=${dest[0]},${dest[1]}`),
  importModel: (data) => request('POST', '/models/import', data),
  exportModelUrl: (id) => `/api/models/${id}/export`,
  listSessions: () => request('GET', '/sessions'),
  getSession: (id) => request('GET', `/sessions/${id}`),
  createSession: (body) => request('POST', '/sessions', body),
  controlSession: (id, action, speed) => request('POST', `/sessions/${id}/control`, { action, speed: speed ?? null }),
  injectOrder: (id, body) => request('POST', `/sessions/${id}/orders`, body),
  saveSessionModel: (id, name) => request('POST', `/sessions/${id}/save-model`, { name: name ?? null }),
  compare: (body) => request('POST', '/compare', body),
};
```

`frontend/src/services/sessionStream.js`:
```js
// Live session state over WebSocket: a pure reducer plus a reconnecting client.
export const initialSessionState = {
  connected: false,
  session: null,
  layout: null,
  tick: 0,
  finished: false,
  robots: [],
  orders: [],
  stations: [],
  stock: {},
  stats: null,
  events: [],
  recentEvents: [],
  error: null,
};

const MAX_RECENT_EVENTS = 50;

function pickFrame(m) {
  return {
    tick: m.tick ?? 0,
    finished: Boolean(m.finished),
    robots: m.robots ?? [],
    orders: m.orders ?? [],
    stations: m.stations ?? [],
    stock: m.stock ?? {},
    stats: m.stats ?? null,
    events: m.events ?? [],
  };
}

export function sessionReducer(state, message) {
  switch (message.type) {
    case 'connected':
      return { ...state, connected: true, error: null };
    case 'disconnected':
      return { ...state, connected: false };
    case 'snapshot':
      return { ...state, ...pickFrame(message), session: message.session, layout: message.layout, recentEvents: [], error: null };
    case 'frame': {
      const newest = [...(message.events ?? [])].reverse();
      return {
        ...state,
        ...pickFrame(message),
        session: message.session ?? state.session,
        recentEvents: [...newest, ...state.recentEvents].slice(0, MAX_RECENT_EVENTS),
      };
    }
    case 'error':
      return { ...state, error: message.message };
    case 'reset':
      return initialSessionState;
    default:
      return state;
  }
}

export function streamUrl(sessionId, loc = window.location) {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/api/sessions/${sessionId}/stream`;
}

const NOT_LIVE = 4404;

export function connectSessionStream(sessionId, onMessage, { WebSocketImpl = WebSocket, maxDelay = 5000 } = {}) {
  let socket = null;
  let closed = false;
  let attempt = 0;
  let timer = null;

  const open = () => {
    socket = new WebSocketImpl(streamUrl(sessionId));
    socket.onopen = () => {
      attempt = 0;
      onMessage({ type: 'connected' });
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // ignore a malformed frame; the next one replaces it
      }
    };
    socket.onclose = (event) => {
      onMessage({ type: 'disconnected' });
      if (event.code === NOT_LIVE) {
        onMessage({ type: 'error', message: event.reason || 'This session is no longer live.' });
        return;
      }
      if (closed) return;
      const delay = Math.min(maxDelay, 500 * 2 ** attempt);
      attempt += 1;
      timer = setTimeout(open, delay);
    };
  };

  open();
  return {
    send: (msg) => {
      if (socket?.readyState === 1) socket.send(JSON.stringify(msg));
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
```

`frontend/src/lib/grid.js`:
```js
// Grid helpers shared by the map, inspector and layout editor.
export const ACTIONS = ['up', 'down', 'left', 'right'];
export const ACTION_ARROWS = { up: '↑', down: '↓', left: '←', right: '→' };
const DELTAS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export function colLabel(x) {
  let label = '';
  let n = x + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export const coordLabel = (x, y) => `${colLabel(x)}${y + 1}`;
export const cellKey = (x, y) => `${x},${y}`;

export function pickFaces(cells) {
  const faces = [];
  cells.forEach((row, y) => row.forEach((kind, x) => {
    if (kind !== 'aisle') return;
    const nextToRack = DELTAS.some(([dx, dy]) => cells[y + dy]?.[x + dx] === 'rack');
    if (nextToRack) faces.push([x, y]);
  }));
  return faces;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test`
Expected: `6 passed`.

- [ ] **Step 6: Implement the toast, nav rail, placeholder views and shell**

`frontend/src/components/toastContext.js`:
```js
import { createContext, useContext } from 'react';

export const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);
```

`frontend/src/components/Toast.jsx`:
```jsx
import { useCallback, useState } from 'react';
import { ToastContext } from './toastContext';

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'error') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone} clay-card`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

`frontend/src/components/NavRail.jsx`:
```jsx
import { Brain, History, LayoutGrid, Play } from 'lucide-react';

const VIEWS = [
  { id: 'session', label: 'Session', Icon: Play },
  { id: 'models', label: 'Models', Icon: Brain },
  { id: 'layouts', label: 'Layouts', Icon: LayoutGrid },
  { id: 'history', label: 'History', Icon: History },
];

export function NavRail({ view, onChange }) {
  return (
    <nav className="nav-rail clay-card" aria-label="Main">
      <div className="nav-brand" title="RoboWare">RW</div>
      {VIEWS.map((item) => {
        const { id, label, Icon } = item;
        return (
          <button key={id} type="button" className={`nav-item ${view === id ? 'active' : ''}`}
            onClick={() => onChange(id)} aria-current={view === id ? 'page' : undefined}>
            <Icon size={18} strokeWidth={2.2} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
```

Placeholders. Each is replaced in later tasks. `frontend/src/views/ModelsView.jsx`:
```jsx
export function ModelsView() {
  return <div className="view-scroll"><h1 className="view-title">Models</h1></div>;
}
```
`LayoutsView.jsx` and `HistoryView.jsx` follow the same pattern: export `LayoutsView` / `HistoryView` with the titles "Layouts" and "History & Compare". `SessionView.jsx`:
```jsx
export function SessionView() {
  return <div className="view-scroll"><h1 className="view-title">Session</h1></div>;
}
```

Replace `frontend/src/App.jsx`:
```jsx
import { useState } from 'react';
import { NavRail } from './components/NavRail';
import { ToastProvider } from './components/Toast';
import { HistoryView } from './views/HistoryView';
import { LayoutsView } from './views/LayoutsView';
import { ModelsView } from './views/ModelsView';
import { SessionView } from './views/SessionView';

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode); the app still works without it
  }
}

export default function App() {
  const [view, setView] = useState(() => readStored('roboware.view', 'session'));
  const [sessionId, setSessionId] = useState(() => readStored('roboware.session', null));

  const go = (next) => {
    setView(next);
    writeStored('roboware.view', next);
  };
  const changeSession = (id) => {
    setSessionId(id);
    writeStored('roboware.session', id);
  };

  return (
    <ToastProvider>
      <div className="app-shell">
        <NavRail view={view} onChange={go} />
        <main className="app-main">
          {view === 'session' && <SessionView sessionId={sessionId} onSessionChange={changeSession} />}
          {view === 'models' && <ModelsView />}
          {view === 'layouts' && <LayoutsView />}
          {view === 'history' && (
            <HistoryView onOpenSession={(id) => { changeSession(id); go('session'); }} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
```

Append to `frontend/src/index.css`:
```css
/* --------------------------------------------------------------------------
   APP SHELL, FORMS, TABLES, MODALS, TOASTS
   -------------------------------------------------------------------------- */

.app-shell { display: flex; width: 100vw; height: 100vh; }
.app-main { position: relative; flex: 1; min-width: 0; height: 100%; overflow: hidden; }
.view-scroll { height: 100%; overflow-y: auto; padding: 28px 32px 48px; user-select: text; }
.view-title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 18px; }
.view-subtitle { font-size: 12px; font-weight: 800; letter-spacing: 0.05em; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 8px; }

.nav-rail { width: 84px; margin: 12px 0 12px 12px; padding: 12px 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 60; }
.nav-brand { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 10px;
  background: linear-gradient(135deg, #FF6F3D 0%, #FF5A26 100%); color: #fff; font-weight: 800; font-size: 13px;
  box-shadow: 0 4px 10px rgba(255, 90, 38, 0.35), inset 1.5px 1.5px 3px rgba(255, 255, 255, 0.7); }
.nav-item { width: 68px; padding: 8px 4px; border: none; border-radius: 14px; background: transparent; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text-secondary);
  font-family: var(--font-ui); font-size: 10px; font-weight: 700; }
.nav-item:hover { background: #EFEAE1; }
.nav-item.active { background: #EAE5DC; color: var(--text-primary); box-shadow: inset 2px 2px 5px rgba(35, 32, 26, 0.12); }
.nav-item:focus-visible, .clay-btn:focus-visible, .clay-input:focus-visible { outline: 2px solid #FF5A26; outline-offset: 2px; }

.clay-input, .clay-select { width: 100%; padding: 7px 10px; border-radius: 10px; border: 1px solid #DDD6C7; background: #FAF8F5;
  font-family: var(--font-ui); font-size: 13px; color: var(--text-primary); box-shadow: inset 1px 1px 3px rgba(35, 32, 26, 0.08); }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 700; color: var(--text-secondary); }
.field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }

.panel { padding: 16px 18px; }
.split { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 18px; align-items: start; }
@media (max-width: 900px) { .split { grid-template-columns: 1fr; } }

.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { text-align: left; font-size: 10px; letter-spacing: 0.05em; color: var(--text-tertiary); padding: 6px 8px; border-bottom: 1px solid #E2DDD3; }
.data-table td { padding: 8px; border-bottom: 1px solid #EEE9E0; }
.data-table tr.clickable { cursor: pointer; }
.data-table tr.clickable:hover td, .data-table tr.selected td { background: #F1ECE3; }
.num { font-family: var(--font-mono); text-align: right; }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.stat { padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.stat-label { font-size: 9px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-tertiary); text-transform: uppercase; }
.stat-value { font-family: var(--font-mono); font-size: 16px; font-weight: 800; }

.badge { display: inline-block; padding: 1px 7px; border-radius: 9999px; font-size: 10px; font-weight: 800; letter-spacing: 0.03em; background: #EAE5DC; color: #736B5F; }
.badge-rush { background: #FFE7DF; color: #E84F1D; }
.badge-live { background: rgba(16, 185, 129, 0.14); color: #059669; }
.badge-warn { background: #FEF3C7; color: #B45309; }

.progress { width: 100%; height: 8px; border-radius: 9999px; background: #E6E1D6; overflow: hidden; }
.progress > div { height: 100%; background: linear-gradient(90deg, #FF6F3D, #FF5A26); transition: width 0.25s ease; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(35, 32, 26, 0.28); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; padding: 22px 24px; user-select: text; }

.toast-stack { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 300; }
.toast { padding: 10px 16px; font-size: 13px; font-weight: 600; max-width: 520px; }
.toast-error { border-left: 4px solid #EF4444; }
.toast-info { border-left: 4px solid #2563EB; }
.toast-success { border-left: 4px solid #10B981; }

.empty-state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; color: var(--text-secondary); }

@keyframes tileFlash { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.8); } 100% { box-shadow: 0 0 0 14px rgba(16, 185, 129, 0); } }
.tile-flash { animation: tileFlash 0.9s ease-out; }
.tile-error { outline: 3px solid #EF4444; outline-offset: -3px; }
```

- [ ] **Step 7: Remove the unused `React` default imports**

In each of `AgentBrainInspector.jsx`, `MapPaintToolbar.jsx`, `OrderDemandDrawer.jsx`, `PlaybackDock.jsx`, `TopMapHud.jsx` and `WarehouseMapCanvas.jsx`, change the first line:
- `import React, { useState, useRef } from 'react';` becomes `import { useState, useRef } from 'react';`
- `import React from 'react';` lines are deleted.

(These components are rewritten in Task 12. This step keeps lint noise down until then.)

- [ ] **Step 8: Build and check the shell in the browser**

Run: `npm run build`. Expected: success. Then `npm run dev`, open http://localhost:5173, and confirm the nav rail switches between the four placeholder views and the selected view survives a refresh.

- [ ] **Step 9: Commit**

```
git add frontend
git commit -m "feat(frontend): API client, live session stream, app shell and nav"
```

---

### Task 12: Session view (live map, controls, orders, inspector)

**Files:**
- Create: `frontend/src/hooks/useSessionStream.js`
- Rewrite: `frontend/src/components/WarehouseMapCanvas.jsx`, `TopMapHud.jsx`, `PlaybackDock.jsx`, `OrderDemandDrawer.jsx`, `AgentBrainInspector.jsx`
- Create: `frontend/src/components/NewSessionDialog.jsx`
- Rewrite: `frontend/src/views/SessionView.jsx`
- Modify: `frontend/src/index.css` (append map overlay styles)
- Delete: `frontend/src/services/simulationEngine.js`, `verify_simulation.mjs` (repo root), `frontend/src/App.css`, `frontend/src/assets/hero.png`, `frontend/src/assets/react.svg`, `frontend/src/assets/vite.svg`, `frontend/public/icons.svg`

**Interfaces:**
- Consumes: `api`, `sessionReducer`, `connectSessionStream`, the `lib/grid` helpers, `useToast` (Task 11); the frame and snapshot shapes (Tasks 7 and 10).
- Produces:
  - `useSessionStream(sessionId) -> [state, send]`.
  - `<WarehouseMapCanvas layout robots stations stock selectedRobotId onSelectRobot layers heatmap heatmapTarget flashCells flashToken errorCells activeBrush onPaintCell />`. Every prop except `layout` is optional. Tasks 13 and 14 reuse it.
    - `layout` is `{width, height, cells, products, pick_faces}`.
    - `heatmap` is `{values: number[W*H][4]}`.
    - `flashCells` and `errorCells` are `Set`s of `"x,y"` keys.
  - `<NewSessionDialog open onClose onCreated(sessionId) />`.

- [ ] **Step 1: Delete the retired browser engine and the unused starter files**

First confirm nothing still imports them:

Run: `git grep -n "simulationEngine\|App.css\|hero.png\|react.svg\|vite.svg\|icons.svg" -- frontend/src frontend/index.html`
Expected matches: only `frontend/src/components/*.jsx` importing `simulationEngine`. Those files are rewritten in this task.

Then run:
```
git rm frontend/src/services/simulationEngine.js verify_simulation.mjs frontend/src/App.css frontend/src/assets/hero.png frontend/src/assets/react.svg frontend/src/assets/vite.svg frontend/public/icons.svg
```

The engine's behavior is now covered by the pytest suite (Tasks 3, 5 and 7).

- [ ] **Step 2: Add the stream hook** — `frontend/src/hooks/useSessionStream.js`:

```js
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { connectSessionStream, initialSessionState, sessionReducer } from '../services/sessionStream';

export function useSessionStream(sessionId) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const clientRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    dispatch({ type: 'reset' });
    const client = connectSessionStream(sessionId, dispatch);
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [sessionId]);

  const send = useCallback((message) => clientRef.current?.send(message), []);
  return [state, send];
}
```

- [ ] **Step 3: Rewrite the map** — `frontend/src/components/WarehouseMapCanvas.jsx`:

```jsx
import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { Package } from 'lucide-react';
import { ACTION_ARROWS, ACTIONS, cellKey, colLabel, coordLabel } from '../lib/grid';

const CELL = 56;
const GAP = 6;
const PITCH = CELL + GAP;
const LABEL_W = 32;
const TILE_CLASS = { aisle: 'tile-aisle', rack: 'tile-rack', packing: 'tile-packing', dock: 'tile-delivery', charger: 'tile-charging' };
const DEFAULT_LAYERS = { paths: true, qHeatmap: false, yieldHalos: true };

const batteryColor = (level) => (level > 50 ? '#10B981' : level > 20 ? '#F59E0B' : '#EF4444');
const center = (v) => v * PITCH + CELL / 2;

function TileGlyph({ kind }) {
  if (kind === 'charger') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#FFE27A" />
      </svg>
    );
  }
  if (kind === 'packing' || kind === 'dock') {
    return <span className="tile-caption">{kind === 'packing' ? 'PACK' : 'DOCK'}</span>;
  }
  if (kind === 'rack') return <div className="rack-inset" />;
  return null;
}

function FaceMarker({ products, stock }) {
  if (!products) return <div className="face-dot" />;
  const initial = products.reduce((n, p) => n + p.stock, 0);
  const left = products.reduce((n, p) => n + (stock?.[p.sku] ?? p.stock), 0);
  return (
    <div className="face-marker" title={products.map((p) => `${p.sku} ${p.name}: ${stock?.[p.sku] ?? p.stock}`).join('\n')}>
      <span>{products[0].sku.replace('SKU-', '#')}</span>
      <div className="face-stock"><div style={{ width: `${initial ? (100 * left) / initial : 0}%` }} /></div>
    </div>
  );
}

export function WarehouseMapCanvas({
  layout,
  robots = [],
  stations = [],
  stock = null,
  selectedRobotId = null,
  onSelectRobot,
  layers = DEFAULT_LAYERS,
  heatmap = null,
  heatmapTarget = null,
  flashCells = null,
  flashToken = 0,
  errorCells = null,
  activeBrush = null,
  onPaintCell,
}) {
  const viewportRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState(null);
  const width = layout?.width ?? 0;
  const height = layout?.height ?? 0;
  const gridW = width * PITCH - GAP;
  const gridH = height * PITCH - GAP;
  const boardW = gridW + LABEL_W + 8 + 72;
  const boardH = gridH + 24 + 72;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || !width) return undefined;
    const observer = new ResizeObserver(() => {
      setScale(Math.max(0.3, Math.min(1, (el.clientWidth - 24) / boardW, (el.clientHeight - 24) / boardH)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, boardW, boardH]);

  const productsByFace = useMemo(() => {
    const map = new Map();
    for (const p of layout?.products ?? []) {
      const key = cellKey(p.face[0], p.face[1]);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [layout]);
  const faceSet = useMemo(() => new Set((layout?.pick_faces ?? []).map(([x, y]) => cellKey(x, y))), [layout]);
  const stationByCell = useMemo(() => new Map(stations.map((s) => [cellKey(s.x, s.y), s])), [stations]);
  const heat = useMemo(() => {
    if (!heatmap || !layers.qHeatmap || !layout) return null;
    const cells = new Map();
    let min = Infinity;
    let max = -Infinity;
    layout.cells.forEach((row, y) => row.forEach((kind, x) => {
      if (kind === 'rack') return;
      const q = heatmap.values[y * width + x];
      const best = Math.max(...q);
      cells.set(cellKey(x, y), { best, action: ACTIONS[q.indexOf(best)] });
      min = Math.min(min, best);
      max = Math.max(max, best);
    }));
    return { cells, min, max };
  }, [heatmap, layers.qHeatmap, layout, width]);

  if (!layout) return <div ref={viewportRef} className="map-viewport" />;

  const paint = (x, y) => {
    if (activeBrush) onPaintCell?.(x, y);
  };

  return (
    <div ref={viewportRef} className="map-viewport">
      <div className="map-board" style={{ transform: `scale(${scale})` }}>
        <div className="map-cols" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, paddingLeft: LABEL_W + 8 }}>
          {Array.from({ length: width }, (_, x) => <div key={x} className="coord-label">{colLabel(x)}</div>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="map-rows" style={{ gridTemplateRows: `repeat(${height}, ${CELL}px)`, width: LABEL_W }}>
            {Array.from({ length: height }, (_, y) => <div key={y} className="coord-label">{y + 1}</div>)}
          </div>
          <div style={{ position: 'relative' }}>
            <div className="map-grid" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, gridTemplateRows: `repeat(${height}, ${CELL}px)` }}>
              {layout.cells.map((row, y) => row.map((kind, x) => {
                const key = cellKey(x, y);
                const products = productsByFace.get(key);
                const station = stationByCell.get(key);
                const h = heat?.cells.get(key);
                const flashing = flashCells?.has(key);
                const classes = ['tile-base', 'tile-cell', TILE_CLASS[kind] ?? 'tile-aisle'];
                if (flashing) classes.push('tile-flash');
                if (errorCells?.has(key)) classes.push('tile-error');
                return (
                  <div
                    key={flashing ? `${key}-${flashToken}` : key}
                    className={classes.join(' ')}
                    style={{ cursor: activeBrush ? 'crosshair' : 'default' }}
                    onMouseDown={() => paint(x, y)}
                    onMouseEnter={(e) => {
                      setHovered({ x, y, kind, products, best: h?.best });
                      if (e.buttons === 1) paint(x, y);
                    }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <TileGlyph kind={kind} />
                    {faceSet.has(key) && <FaceMarker products={products} stock={stock} />}
                    {station?.occupant && <div className="station-ring">{station.remaining}</div>}
                    {h && <div className="heat-fill" style={{ opacity: heat.max > heat.min ? 0.1 + (0.55 * (h.best - heat.min)) / (heat.max - heat.min) : 0.1 }} />}
                    {h && <span className="heat-arrow">{ACTION_ARROWS[h.action]}</span>}
                    {heatmapTarget && heatmapTarget[0] === x && heatmapTarget[1] === y && <div className="heat-target" />}
                  </div>
                );
              }))}
            </div>

            <svg className="map-overlay" width={gridW} height={gridH}>
              {layers.paths && robots.map((robot) => {
                if (!robot.path?.length) return null;
                const d = [`M ${center(robot.x)} ${center(robot.y)}`, ...robot.path.map(([x, y]) => `L ${center(x)} ${center(y)}`)].join(' ');
                return (
                  <g key={`path-${robot.id}`}>
                    <path d={d} fill="none" stroke={robot.color} strokeWidth="5" strokeOpacity="0.2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={d} fill="none" stroke={robot.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="trajectory-path" />
                    {robot.target && <circle cx={center(robot.target[0])} cy={center(robot.target[1])} r="4" fill={robot.color} stroke="#FAF8F5" strokeWidth="2" />}
                  </g>
                );
              })}
            </svg>

            {robots.map((robot) => {
              const carried = (robot.carrying ?? []).reduce((n, i) => n + i.qty, 0);
              const circumference = 2 * Math.PI * 20;
              return (
                <button
                  type="button"
                  key={robot.id}
                  onClick={() => onSelectRobot?.(robot.id)}
                  className={`robot-puck ${selectedRobotId === robot.id ? 'selected' : ''}`}
                  style={{ left: robot.x * PITCH + 4, top: robot.y * PITCH + 4, width: CELL - 8, height: CELL - 8, zIndex: 20, border: 'none', padding: 0 }}
                  aria-label={`Robot ${robot.id}, ${robot.status}, battery ${Math.round(robot.battery)}%`}
                >
                  {layers.yieldHalos && robot.yielding && <div className="yield-ring" />}
                  <svg className="battery-ring" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(185, 176, 162, 0.2)" strokeWidth="3" />
                    <circle cx="24" cy="24" r="20" fill="none" stroke={batteryColor(robot.battery)} strokeWidth="3.2"
                      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - robot.battery / 100)} strokeLinecap="round" />
                  </svg>
                  <div className="robot-body">
                    <div className="robot-nose-wrap" style={{ transform: `rotate(${robot.heading}deg)` }}>
                      <div className="robot-nose" style={{ borderLeftColor: robot.color }} />
                    </div>
                    <span className="robot-label" style={{ color: robot.color }}>{robot.id}</span>
                  </div>
                  {(robot.package_id || carried > 0) && (
                    <span className="carry-badge" title={robot.package_id ? `Carrying ${robot.package_id}` : `${carried} item(s)`}>
                      {robot.package_id ? <Package size={10} strokeWidth={2.6} /> : carried}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {hovered && (
          <div className="clay-card-flat map-tooltip">
            <span className="font-mono">{coordLabel(hovered.x, hovered.y)}</span>
            <span style={{ textTransform: 'capitalize' }}>{hovered.kind}</span>
            {hovered.products && <span>{hovered.products.map((p) => `${p.name} (${stock?.[p.sku] ?? p.stock})`).join(', ')}</span>}
            {hovered.best !== undefined && <span className="font-mono" style={{ color: '#FF5A26' }}>max Q {hovered.best.toFixed(1)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append the map styles** to `frontend/src/index.css`:

```css
/* --------------------------------------------------------------------------
   MAP BOARD (live sessions, heatmaps, layout editor)
   -------------------------------------------------------------------------- */

.map-viewport { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;
  background-color: #F4F1EA; background-image: radial-gradient(#E2DDD3 1px, transparent 1px); background-size: 28px 28px; }
.map-board { position: relative; padding: 36px; background: rgba(246, 243, 237, 0.7); border-radius: 2rem; transform-origin: center center;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  box-shadow: 16px 24px 50px rgba(35, 32, 26, 0.12), inset 3px 3px 6px rgba(255, 255, 255, 0.95), inset -3px -3px 8px rgba(185, 176, 162, 0.35); }
.map-cols { display: grid; gap: 6px; margin-bottom: 8px; }
.map-rows { display: grid; gap: 6px; align-items: center; }
.map-grid { display: grid; gap: 6px; position: relative; }
.map-overlay { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
.tile-cell { width: 56px; height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
.tile-caption { color: #fff; font-size: 9px; font-weight: 800; letter-spacing: 0.05em; }
.rack-inset { width: 80%; height: 80%; border-radius: 4px; border: 1.5px dashed rgba(160, 150, 135, 0.45); }
.face-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255, 90, 38, 0.35); }
.face-marker { display: flex; flex-direction: column; align-items: center; gap: 3px; font-family: var(--font-mono); font-size: 10px; font-weight: 800; color: #E84F1D; }
.face-stock { width: 34px; height: 4px; border-radius: 9999px; background: #E2DDD3; overflow: hidden; }
.face-stock > div { height: 100%; background: #FF5A26; }
.station-ring { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%; background: #fff; color: #2563EB;
  font-family: var(--font-mono); font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.heat-fill { position: absolute; inset: 0; background: rgb(235, 87, 87); mix-blend-mode: multiply; pointer-events: none; border-radius: inherit; }
.heat-arrow { position: absolute; bottom: 2px; right: 4px; font-family: var(--font-mono); font-size: 12px; font-weight: 800; color: rgba(35, 32, 26, 0.75); pointer-events: none; }
.heat-target { position: absolute; inset: 3px; border: 2.5px solid #23201A; border-radius: 0.4rem; pointer-events: none; }
.battery-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.robot-body { width: 32px; height: 32px; border-radius: 50%; background: #FAF8F5; display: flex; align-items: center; justify-content: center; position: relative;
  box-shadow: inset 2px 2px 4px rgba(255, 255, 255, 0.95), inset -2px -2px 3px rgba(185, 176, 162, 0.4); }
.robot-nose-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transition: transform 0.25s ease; pointer-events: none; }
.robot-nose { position: absolute; right: -3px; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid; }
.robot-label { font-family: var(--font-mono); font-size: 11px; font-weight: 800; }
.robot-puck { transition: left 0.2s linear, top 0.2s linear; }
.carry-badge { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 9999px; background: #23201A; color: #fff;
  font-family: var(--font-mono); font-size: 9px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.map-tooltip { position: absolute; bottom: 8px; left: 42px; padding: 6px 14px; display: flex; gap: 12px; font-size: 12px; font-weight: 600; z-index: 30; }
.hud { position: absolute; z-index: 50; }
```

- [ ] **Step 5: Rewrite the HUD, dock, drawer and inspector**

`frontend/src/components/TopMapHud.jsx`:
```jsx
const MODE_LABELS = { hybrid: 'Hybrid A* + Q', q_only: 'Q-learning only', astar: 'Pure A*' };
const LAYERS = [
  { key: 'paths', label: 'Paths', color: '#10B981' },
  { key: 'qHeatmap', label: 'Q-Heatmap', color: '#FF5A26' },
  { key: 'yieldHalos', label: 'Yield Halos', color: '#F59E0B' },
];

export function TopMapHud({ session, connected, tick, layers, onToggleLayer, onNewSession, onSaveModel }) {
  const status = session?.status ?? 'created';
  const config = session?.config ?? {};
  return (
    <div className="clay-card hud" style={{ top: 20, left: 20, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', maxWidth: 'calc(100% - 420px)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>{session?.name ?? 'Session'}</span>
          <span className={`badge ${status === 'running' ? 'badge-live' : status === 'finished' ? '' : 'badge-warn'}`}>{status.toUpperCase()}</span>
          {!connected && <span className="badge badge-rush">OFFLINE</span>}
        </div>
        <div style={{ fontSize: 10, color: '#8E8578', fontWeight: 600 }}>
          {MODE_LABELS[config.routing_mode] ?? '—'} · {session?.model_name ?? 'no model'}
          {config.online_learning ? ' · learning on' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="stat-label">Tick</span>
        <span className="font-mono" style={{ fontSize: 13, fontWeight: 700 }}>{String(tick).padStart(5, '0')}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {LAYERS.map(({ key, label, color }) => (
          <button key={key} type="button" onClick={() => onToggleLayer(key)}
            className={`clay-btn clay-pill-sm ${layers[key] ? 'clay-btn-active' : ''}`} style={{ fontSize: 11, gap: 4 }}
            disabled={key === 'qHeatmap' && !config.model_id}
            title={key === 'qHeatmap' && !config.model_id ? 'Pick a model for this session to see its Q-values' : `Toggle ${label} (${label[0]})`}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: layers[key] ? color : '#B8B0A2' }} />
            {label}
          </button>
        ))}
      </div>
      {config.online_learning && onSaveModel && (
        <button type="button" className="clay-btn clay-pill-sm" onClick={onSaveModel} style={{ fontSize: 11 }}>Save learned model</button>
      )}
      <button type="button" className="clay-btn clay-pill-sm clay-btn-accent" onClick={onNewSession} style={{ fontSize: 11 }}>New session</button>
    </div>
  );
}
```

`frontend/src/components/PlaybackDock.jsx`:
```jsx
import { Pause, Play, SkipForward, Square } from 'lucide-react';

const SPEEDS = [1, 2, 5, 10, 'max'];

export function PlaybackDock({ status, speed, onPlay, onPause, onStep, onStop, onSpeed }) {
  const running = status === 'running';
  const over = status === 'finished' || status === 'interrupted';
  return (
    <div className="clay-card hud" style={{ bottom: 20, left: '50%', transform: 'translateX(-50%)', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <button type="button" onClick={running ? onPause : onPlay} disabled={over}
        className={`clay-btn ${running ? 'clay-btn-accent' : ''}`} style={{ padding: '7px 16px', fontWeight: 700, fontSize: 12, minWidth: 92 }}
        title="Play / pause (Space)">
        {running ? <><Pause size={14} /> PAUSE</> : <><Play size={14} /> PLAY</>}
      </button>
      <button type="button" onClick={onStep} disabled={running || over} className="clay-btn" style={{ fontSize: 12 }} title="Advance one tick">
        <SkipForward size={14} /> Step
      </button>
      <div style={{ display: 'flex', gap: 4, background: '#EAE5DC', padding: 3, borderRadius: 9999 }}>
        {SPEEDS.map((s) => (
          <button key={s} type="button" onClick={() => onSpeed(s)} disabled={over}
            className={`clay-btn clay-pill-sm ${speed === s ? 'active' : ''}`}
            style={{ fontFamily: 'JetBrains Mono', fontSize: 11, border: 'none', background: speed === s ? '#FAF8F5' : 'transparent' }}>
            {s === 'max' ? 'MAX' : `${s}x`}
          </button>
        ))}
      </div>
      <button type="button" onClick={onStop} disabled={over} className="clay-btn" style={{ fontSize: 12, color: '#8E8578' }} title="End the session and save its results">
        <Square size={13} /> Stop
      </button>
    </div>
  );
}
```

`frontend/src/components/OrderDemandDrawer.jsx`:
```jsx
import { useState } from 'react';

const STAGES = ['picking', 'packing', 'shipping', 'delivered'];
const STAGE_COLORS = { queued: '#B8B0A2', assigned: '#736B5F', picking: '#FF5A26', packing: '#2563EB', shipping: '#10B981', delivered: '#8E8578', failed: '#EF4444' };

function Kpi({ label, value, color }) {
  return (
    <div className="clay-card-flat stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ color, fontSize: 15 }}>{value ?? '—'}</span>
    </div>
  );
}

export function OrderDemandDrawer({ orders, stats, productNames, onInject, disabled }) {
  const [collapsed, setCollapsed] = useState(false);
  const active = orders.filter((o) => o.status !== 'delivered' && o.status !== 'failed').length;
  return (
    <div className="clay-card hud" style={{ top: 20, right: 20, width: collapsed ? 'auto' : 360, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 12 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em' }}>ORDERS <span className="badge">{active} ACTIVE</span></span>
        <button type="button" className="clay-btn clay-pill-sm" style={{ fontSize: 10 }} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▲ EXPAND' : '▼ HIDE'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            <Kpi label="Delivered" value={stats?.delivered} color="#10B981" />
            <Kpi label="Per 100 ticks" value={stats?.throughput_per_100} color="#FF5A26" />
            <Kpi label="Avg cycle" value={stats?.avg_cycle_time} color="#2563EB" />
            <Kpi label="Waits" value={stats?.wait_events} color="#F59E0B" />
            <Kpi label="Fallbacks" value={stats?.fallbacks} color="#9333EA" />
            <Kpi label="Failed" value={stats?.failed} color="#EF4444" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className="clay-btn clay-pill-sm clay-btn-accent" style={{ flex: 1, fontSize: 11 }} disabled={disabled} onClick={() => onInject('normal')}>+ Order</button>
            <button type="button" className="clay-btn clay-pill-sm" style={{ flex: 1, fontSize: 11 }} disabled={disabled} onClick={() => onInject('rush')}>+ Rush order</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
            {orders.length === 0 && <span style={{ fontSize: 12, color: '#8E8578' }}>No orders yet.</span>}
            {orders.map((order) => {
              const reached = STAGES.filter((s) => order.timeline?.[s] !== undefined);
              return (
                <div key={order.id} className="clay-card-flat" style={{ padding: '8px 10px', opacity: order.status === 'delivered' ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span className="font-mono" style={{ fontSize: 11, fontWeight: 800 }}>
                      {order.id} {order.priority === 'rush' && <span className="badge badge-rush">RUSH</span>}
                      {order.robot_id && <span className="badge" style={{ marginLeft: 4 }}>{order.robot_id}</span>}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: STAGE_COLORS[order.status] }}>{order.status.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#4A4338', marginBottom: 6 }}>
                    {order.items.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')}
                    {order.fail_reason && <span style={{ color: '#EF4444' }}> · {order.fail_reason.replace('_', ' ')}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {STAGES.map((s) => (
                      <span key={s} title={s} style={{ flex: 1, height: 4, borderRadius: 9999, background: reached.includes(s) ? STAGE_COLORS[s] : '#E2DDD3' }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
```

`frontend/src/components/AgentBrainInspector.jsx`:
```jsx
import { useState } from 'react';
import { ACTION_ARROWS, ACTIONS, coordLabel } from '../lib/grid';

const STATUS_TEXT = {
  idle: 'Idle', parking: 'Parking', to_pick: 'Going to shelf', picking: 'Picking', to_pack: 'Going to packing',
  queued_pack: 'Waiting for packing', packing: 'Packing', to_dock: 'Shipping to dock', to_charger: 'Going to charge', charging: 'Charging',
};
const PAD = { up: [1, 2], left: [2, 1], right: [2, 3], down: [3, 2] };

export function AgentBrainInspector({ robots, selectedRobotId, onSelectRobot, productNames }) {
  const [collapsed, setCollapsed] = useState(false);
  const robot = robots.find((r) => r.id === selectedRobotId) ?? robots[0];
  if (!robot) return null;
  const q = robot.q_scores;
  const best = q ? Math.max(...ACTIONS.map((a) => q[a])) : null;
  return (
    <div className="clay-card hud" style={{ bottom: 20, right: 20, width: collapsed ? 'auto' : 330, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed ? 0 : 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em' }}>ROBOT INSPECTOR</span>
        <button type="button" className="clay-btn clay-pill-sm" style={{ fontSize: 10 }} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▲ EXPAND' : '▼ HIDE'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {robots.map((r) => (
              <button key={r.id} type="button" onClick={() => onSelectRobot(r.id)}
                className={`clay-btn clay-pill-sm ${r.id === robot.id ? 'active' : ''}`}
                style={{ flex: 1, fontFamily: 'JetBrains Mono', fontSize: 11, color: r.id === robot.id ? r.color : '#736B5F' }}>
                {r.id}
              </button>
            ))}
          </div>
          <div className="clay-card-flat" style={{ padding: '10px 12px', marginBottom: 10, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>{STATUS_TEXT[robot.status] ?? robot.status}{robot.yielding ? ' (waiting)' : ''}</strong>
              <span className="font-mono">BATTERY {Math.round(robot.battery)}%</span>
            </div>
            <div className="progress" style={{ height: 5, marginBottom: 8 }}>
              <div style={{ width: `${robot.battery}%`, background: robot.battery > 50 ? '#10B981' : robot.battery > 20 ? '#F59E0B' : '#EF4444' }} />
            </div>
            <div>At <span className="font-mono">{coordLabel(robot.x, robot.y)}</span>
              {robot.target && <> → <span className="font-mono">{coordLabel(robot.target[0], robot.target[1])}</span></>}
              {robot.order_id && <> · {robot.order_id}</>}
            </div>
            <div style={{ marginTop: 4, color: '#6B6357' }}>
              {robot.package_id ? `Carrying package ${robot.package_id}`
                : robot.carrying?.length ? `Carrying ${robot.carrying.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')}`
                  : 'Empty'}
              {robot.fallback_leg && <span className="badge badge-warn" style={{ marginLeft: 6 }}>A* FALLBACK</span>}
            </div>
          </div>
          <div className="view-subtitle">Q-values at this cell</div>
          {q ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 6, width: 190, margin: '0 auto' }}>
              {ACTIONS.map((a) => (
                <div key={a} className="clay-card-flat" style={{
                  gridRow: PAD[a][0], gridColumn: PAD[a][1], padding: '6px 2px', textAlign: 'center',
                  border: q[a] === best ? '1.5px solid #FF5A26' : undefined, background: q[a] === best ? '#FFE7DF' : undefined,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#8E8578' }}>{ACTION_ARROWS[a]} {a.toUpperCase()}</div>
                  <div className="font-mono" style={{ fontSize: 11, fontWeight: 800 }}>{q[a]}</div>
                </div>
              ))}
              <div style={{ gridRow: 2, gridColumn: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono', fontWeight: 800, color: robot.color }}>{robot.id}</div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#8E8578' }}>No Q-table for this target, so this leg uses A*.</div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add the new-session dialog** — `frontend/src/components/NewSessionDialog.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useToast } from './toastContext';

const DEFAULTS = {
  name: '', layout_id: 'default', model_id: '', routing_mode: 'hybrid', robot_count: 4,
  rate_per_100: 6, rush_fraction: 0.1, seed: 42, stop_type: 'ticks', stop_value: 2000, online_learning: false,
  size_1: 50, size_2: 30, size_3: 20,
};

export function NewSessionDialog({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(DEFAULTS);
  const [layouts, setLayouts] = useState([]);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    Promise.all([api.listLayouts(), api.listModels()])
      .then(([l, m]) => {
        if (!cancelled) {
          setLayouts(l);
          setModels(m);
        }
      })
      .catch((e) => toast(e.message));
    return () => { cancelled = true; };
  }, [open, toast]);

  if (!open) return null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const layoutModels = models.filter((m) => m.layout_id === form.layout_id);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.createSession({
        name: form.name,
        layout_id: form.layout_id,
        model_id: form.model_id || null,
        routing_mode: form.routing_mode,
        robot_count: Number(form.robot_count),
        orders: {
          rate_per_100: Number(form.rate_per_100),
          rush_fraction: Number(form.rush_fraction),
          seed: Number(form.seed),
          size_weights: [Number(form.size_1), Number(form.size_2), Number(form.size_3)],
        },
        stop: { type: form.stop_type, value: form.stop_type === 'manual' ? null : Number(form.stop_value) },
        online_learning: Boolean(form.online_learning && form.model_id),
      });
      created.warnings?.forEach((w) => toast(w, 'info'));
      onCreated(created.id);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-session-title" onMouseDown={onClose}>
      <form className="modal clay-card" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="new-session-title" className="view-title" style={{ fontSize: 18 }}>New session</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">Name (optional)<input className="clay-input" value={form.name} onChange={set('name')} placeholder="Auto-named from the settings" /></label>
          <div className="field-row">
            <label className="field">Layout
              <select className="clay-select" value={form.layout_id} onChange={(e) => setForm({ ...form, layout_id: e.target.value, model_id: '' })}>
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="field">Model
              <select className="clay-select" value={form.model_id} onChange={set('model_id')}>
                <option value="">None (A* only)</option>
                {layoutModels.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.trained_destinations} trained</option>)}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">Routing
              <select className="clay-select" value={form.routing_mode} onChange={set('routing_mode')}>
                <option value="hybrid">Hybrid A* + Q</option>
                <option value="q_only">Q-learning only</option>
                <option value="astar">Pure A*</option>
              </select>
            </label>
            <label className="field">Robots<input className="clay-input" type="number" min="1" max="8" value={form.robot_count} onChange={set('robot_count')} /></label>
          </div>
          <div className="field-row">
            <label className="field">Orders per 100 ticks<input className="clay-input" type="number" min="0" max="100" step="0.5" value={form.rate_per_100} onChange={set('rate_per_100')} /></label>
            <label className="field">Rush share (0–1)<input className="clay-input" type="number" min="0" max="1" step="0.05" value={form.rush_fraction} onChange={set('rush_fraction')} /></label>
            <label className="field">Seed<input className="clay-input" type="number" value={form.seed} onChange={set('seed')} /></label>
          </div>
          <div className="field-row">
            <label className="field">% 1-item orders<input className="clay-input" type="number" min="0" value={form.size_1} onChange={set('size_1')} /></label>
            <label className="field">% 2-item<input className="clay-input" type="number" min="0" value={form.size_2} onChange={set('size_2')} /></label>
            <label className="field">% 3-item<input className="clay-input" type="number" min="0" value={form.size_3} onChange={set('size_3')} /></label>
          </div>
          <div className="field-row">
            <label className="field">Stop after
              <select className="clay-select" value={form.stop_type} onChange={set('stop_type')}>
                <option value="ticks">Ticks</option>
                <option value="orders">Delivered orders</option>
                <option value="manual">Manual stop</option>
              </select>
            </label>
            {form.stop_type !== 'manual' && (
              <label className="field">Value<input className="clay-input" type="number" min="1" value={form.stop_value} onChange={set('stop_value')} /></label>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={form.online_learning} onChange={set('online_learning')} disabled={!form.model_id} />
            Keep learning during the session (save as a new model version afterwards)
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" className="clay-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="clay-btn clay-btn-accent" disabled={busy}>{busy ? 'Creating…' : 'Create session'}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Build the view** — replace `frontend/src/views/SessionView.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentBrainInspector } from '../components/AgentBrainInspector';
import { NewSessionDialog } from '../components/NewSessionDialog';
import { OrderDemandDrawer } from '../components/OrderDemandDrawer';
import { PlaybackDock } from '../components/PlaybackDock';
import { TopMapHud } from '../components/TopMapHud';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { useSessionStream } from '../hooks/useSessionStream';
import { cellKey } from '../lib/grid';
import { api } from '../services/api';

const FLASH_EVENTS = new Set(['delivered', 'picked', 'packed']);

export function SessionView({ sessionId, onSessionChange }) {
  const toast = useToast();
  const [state] = useSessionStream(sessionId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRobotId, setSelectedRobotId] = useState('R1');
  const [layers, setLayers] = useState({ paths: true, qHeatmap: false, yieldHalos: true });
  const [heatmap, setHeatmap] = useState(null);

  const session = state.session;
  const status = session?.status;
  const modelId = session?.config?.model_id;
  const selected = state.robots.find((r) => r.id === selectedRobotId) ?? state.robots[0];
  const targetKey = selected?.target ? cellKey(selected.target[0], selected.target[1]) : null;
  const productNames = useMemo(
    () => Object.fromEntries((state.layout?.products ?? []).map((p) => [p.sku, p.name])),
    [state.layout],
  );
  const flashCells = useMemo(
    () => new Set(state.events.filter((e) => FLASH_EVENTS.has(e.type) && e.at).map((e) => cellKey(e.at[0], e.at[1]))),
    [state.events],
  );

  useEffect(() => {
    if (!layers.qHeatmap || !modelId || !targetKey) return undefined;
    let cancelled = false;
    api.getQTable(modelId, targetKey.split(',').map(Number))
      .then((table) => { if (!cancelled) setHeatmap(table); })
      .catch(() => { if (!cancelled) setHeatmap(null); });
    return () => { cancelled = true; };
  }, [layers.qHeatmap, modelId, targetKey]);

  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state.error, toast]);

  const run = useCallback(async (fn) => {
    try {
      await fn();
    } catch (err) {
      toast(err.message);
    }
  }, [toast]);

  const control = useCallback((action, speed) => run(() => api.controlSession(sessionId, action, speed)), [run, sessionId]);
  const toggleLayer = useCallback((key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] })), []);

  useEffect(() => {
    if (!sessionId) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        control(status === 'running' ? 'pause' : 'play');
      } else if (/^[1-8]$/.test(e.key)) {
        setSelectedRobotId(`R${e.key}`);
      } else if (e.key.toLowerCase() === 'p') {
        toggleLayer('paths');
      } else if (e.key.toLowerCase() === 'q') {
        toggleLayer('qHeatmap');
      } else if (e.key.toLowerCase() === 'h') {
        toggleLayer('yieldHalos');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionId, status, control, toggleLayer]);

  const created = (id) => {
    setDialogOpen(false);
    onSessionChange(id);
  };

  const dialog = <NewSessionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={created} />;

  if (!sessionId || (!state.layout && state.error)) {
    return (
      <div className="empty-state">
        <h1 className="view-title">{state.error ? 'That session is no longer live' : 'No session running'}</h1>
        <p style={{ maxWidth: 420, fontSize: 13 }}>
          Start a session to watch the robots pick, pack and ship orders. Train a model in Models first if you want them to use Q-learning.
        </p>
        <button type="button" className="clay-btn clay-btn-accent" onClick={() => setDialogOpen(true)}>New session</button>
        {dialog}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <WarehouseMapCanvas
        layout={state.layout}
        robots={state.robots}
        stations={state.stations}
        stock={state.stock}
        selectedRobotId={selected?.id}
        onSelectRobot={setSelectedRobotId}
        layers={layers}
        heatmap={heatmap}
        heatmapTarget={layers.qHeatmap ? selected?.target : null}
        flashCells={flashCells}
        flashToken={state.tick}
      />
      <TopMapHud
        session={session}
        connected={state.connected}
        tick={state.tick}
        layers={layers}
        onToggleLayer={toggleLayer}
        onNewSession={() => setDialogOpen(true)}
        onSaveModel={() => run(async () => {
          const saved = await api.saveSessionModel(sessionId);
          toast(`Saved "${saved.name}"`, 'success');
        })}
      />
      <PlaybackDock
        status={status}
        speed={session?.speed ?? 1}
        onPlay={() => control('play')}
        onPause={() => control('pause')}
        onStep={() => control('step')}
        onStop={() => control('stop')}
        onSpeed={(s) => control('set_speed', s)}
      />
      <OrderDemandDrawer
        orders={state.orders}
        stats={state.stats}
        productNames={productNames}
        disabled={status === 'finished' || status === 'interrupted'}
        onInject={(priority) => run(() => api.injectOrder(sessionId, { priority }))}
      />
      <AgentBrainInspector robots={state.robots} selectedRobotId={selected?.id} onSelectRobot={setSelectedRobotId} productNames={productNames} />
      {dialog}
    </div>
  );
}
```

- [ ] **Step 8: Lint, test and build**

Run: `npm run lint && npm test && npm run build`
Expected: no lint errors, all tests pass, and the build succeeds. Fix every lint finding; these files are new or rewritten, so there's nothing to grandfather in.

- [ ] **Step 9: Check it end to end**

Start the backend (`backend\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8080 --app-dir backend`) and the frontend (`npm run dev`), then open http://localhost:5173 and check each of these:
1. The empty state appears, and New session opens the dialog.
2. Create a session with A\* and 4 robots, press Play, and switch to 10× speed. Robots move, orders progress through their stages, and deliveries make the dock flash.
3. "+ Rush order" puts a RUSH order at the top of the queue.
4. Press Space to pause and Step to advance one tick.
5. Reload the page: the stream reconnects to the same session.
6. Stop: the status shows FINISHED and the controls are disabled.

- [ ] **Step 10: Commit**

```
git add -A frontend verify_simulation.mjs
git commit -m "feat(frontend): live session view on the backend stream; retire the browser engine"
```

---

### Task 13: Models view (create, train, learning curves, heatmaps, import/export)

**Files:**
- Create: `frontend/src/lib/curves.js`, `frontend/src/lib/curves.test.js`
- Create: `frontend/src/components/LineChart.jsx`
- Create: `frontend/src/components/HyperparameterFields.jsx`
- Create: `frontend/src/hooks/useTrainingJob.js`
- Rewrite: `frontend/src/views/ModelsView.jsx`

**Interfaces:**
- Consumes: `api`, `useToast`, `WarehouseMapCanvas` (Tasks 11–12); the model, job and qtable responses (Task 9).
- Produces:
  - `resample(values, points)` and `averageCurve(histories, field, points)`.
  - `<LineChart series={[{label, color, points: [{x, y}]}]} height xLabel yLabel />`. Task 15 reuses it.
  - `<HyperparameterFields value onChange />`.
  - `useTrainingJob(jobId, onFinished) -> job | null`.

- [ ] **Step 1: Write the failing tests** — `frontend/src/lib/curves.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { averageCurve, resample } from './curves';

describe('curves', () => {
  it('resamples by linear interpolation', () => {
    expect(resample([0, 10], 3)).toEqual([0, 5, 10]);
    expect(resample([4], 3)).toEqual([4, 4, 4]);
    expect(resample([], 3)).toEqual([]);
  });

  it('averages curves of different lengths point by point', () => {
    const histories = { '1,1': { rewards: [0, 10] }, '2,2': { rewards: [10, 10, 10] } };
    expect(averageCurve(histories, 'rewards', 3)).toEqual([5, 7.5, 10]);
    expect(averageCurve({}, 'rewards', 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`. Expected: it cannot resolve `./curves`.

- [ ] **Step 3: Implement** — `frontend/src/lib/curves.js`:

```js
// Learning-curve helpers: each destination's history has a different length, so curves are resampled before averaging.
export function resample(values, points = 100) {
  if (!values?.length) return [];
  if (values.length === 1) return Array(points).fill(values[0]);
  return Array.from({ length: points }, (_, i) => {
    const pos = (i * (values.length - 1)) / (points - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const t = pos - lo;
    return values[lo] * (1 - t) + values[hi] * t;
  });
}

export function averageCurve(histories, field = 'rewards', points = 100) {
  const curves = Object.values(histories ?? {})
    .map((h) => resample(h?.[field] ?? [], points))
    .filter((c) => c.length);
  if (!curves.length) return [];
  return Array.from({ length: points }, (_, i) => curves.reduce((sum, c) => sum + c[i], 0) / curves.length);
}
```

Run: `npm test`. Expected: all pass.

- [ ] **Step 4: Add the chart, the hyperparameter fields and the job hook**

`frontend/src/components/LineChart.jsx`:
```jsx
const W = 560;
const PAD = { left: 48, right: 12, top: 10, bottom: 26 };

const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(1)));

export function LineChart({ series, height = 180, xLabel = '', yLabel = '' }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#8E8578' }}>No data yet</div>;
  }
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const sx = (x) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right);
  const sy = (y) => height - PAD.bottom - ((y - y0) / (y1 - y0)) * (height - PAD.top - PAD.bottom);
  const yTicks = [y0, (y0 + y1) / 2, y1];
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="#E6E1D6" />
            <text x={PAD.left - 6} y={sy(t) + 4} textAnchor="end" fontSize="10" fill="#8E8578" fontFamily="JetBrains Mono">{fmt(t)}</text>
          </g>
        ))}
        <text x={PAD.left} y={height - 6} fontSize="10" fill="#8E8578" fontFamily="JetBrains Mono">{fmt(x0)}</text>
        <text x={W - PAD.right} y={height - 6} textAnchor="end" fontSize="10" fill="#8E8578" fontFamily="JetBrains Mono">{fmt(x1)}</text>
        <text x={(W + PAD.left) / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="#8E8578">{xLabel}</text>
        {series.map((s) => (
          <polyline key={s.label} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"
            points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
        ))}
      </svg>
      <figcaption style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: '#6B6357', marginTop: 4 }}>
        {yLabel && <span style={{ fontWeight: 700 }}>{yLabel}</span>}
        {series.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 3, background: s.color, borderRadius: 2 }} />{s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
```

`frontend/src/components/HyperparameterFields.jsx`:
```jsx
const SLIDERS = [
  { key: 'learning_rate', label: 'Learning rate (α)', min: 0.01, max: 1, step: 0.01 },
  { key: 'discount_factor', label: 'Discount factor (γ)', min: 0.5, max: 0.99, step: 0.01 },
  { key: 'exploration_rate', label: 'Exploration rate (ε)', min: 0, max: 1, step: 0.01 },
];

export const DEFAULT_HYPERPARAMETERS = {
  learning_rate: 0.1, discount_factor: 0.95, exploration_rate: 0.3, epsilon_decay: false, epsilon_min: 0.05,
  step_reward: -1, goal_reward: 10, episodes_per_destination: 3000, max_steps: 200,
};

export function HyperparameterFields({ value, onChange }) {
  const set = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {SLIDERS.map(({ key, label, min, max, step }) => (
        <label key={key} className="field">
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>{label}<span className="font-mono">{value[key]}</span></span>
          <input type="range" className="clay-slider" min={min} max={max} step={step} value={value[key]}
            onChange={(e) => set(key, Number(e.target.value))} />
        </label>
      ))}
      <div className="field-row">
        <label className="field">Episodes per destination
          <input className="clay-input" type="number" min="1" max="50000" value={value.episodes_per_destination}
            onChange={(e) => set('episodes_per_destination', Number(e.target.value))} />
        </label>
        <label className="field">Max steps per episode
          <input className="clay-input" type="number" min="1" max="5000" value={value.max_steps}
            onChange={(e) => set('max_steps', Number(e.target.value))} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={value.epsilon_decay} onChange={(e) => set('epsilon_decay', e.target.checked)} />
        Decay ε linearly to {value.epsilon_min} over training
      </label>
    </div>
  );
}
```

`frontend/src/hooks/useTrainingJob.js`:
```js
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

const POLL_MS = 400;

export function useTrainingJob(jobId, onFinished) {
  const [job, setJob] = useState(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  });

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const next = await api.getTrainingJob(jobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === 'completed' || next.status === 'failed') {
          finishedRef.current?.(next);
          return;
        }
      } catch (err) {
        if (!cancelled) setJob((prev) => ({ ...(prev ?? {}), status: 'failed', error: err.message }));
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  return jobId ? job : null;
}
```

- [ ] **Step 5: Build the view** — replace `frontend/src/views/ModelsView.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_HYPERPARAMETERS, HyperparameterFields } from '../components/HyperparameterFields';
import { LineChart } from '../components/LineChart';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { useTrainingJob } from '../hooks/useTrainingJob';
import { averageCurve } from '../lib/curves';
import { coordLabel } from '../lib/grid';
import { api } from '../services/api';

const HEAT_LAYERS = { paths: false, qHeatmap: true, yieldHalos: false };

function toPoints(values, episodes) {
  const n = values.length;
  return values.map((y, i) => ({ x: n > 1 ? Math.round((i / (n - 1)) * episodes) : episodes, y }));
}

export function ModelsView() {
  const toast = useToast();
  const fileRef = useRef(null);
  const [models, setModels] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [layout, setLayout] = useState(null);
  const [newModel, setNewModel] = useState({ name: '', layout_id: 'default', hyperparameters: DEFAULT_HYPERPARAMETERS });
  const [trainHp, setTrainHp] = useState(DEFAULT_HYPERPARAMETERS);
  const [jobId, setJobId] = useState(null);
  const [heatDest, setHeatDest] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([api.listModels(), api.listLayouts()]);
      setModels(m);
      setLayouts(l);
    } catch (err) {
      toast(err.message);
    }
  }, [toast]);

  const loadDetail = useCallback(async (id) => {
    try {
      const d = await api.getModel(id);
      setDetail(d);
      setTrainHp({ ...DEFAULT_HYPERPARAMETERS, ...d.hyperparameters });
      setLayout(await api.getLayout(d.layout_id));
      setHeatDest(d.destinations[0] ?? null);
    } catch (err) {
      toast(err.message);
    }
  }, [toast]);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const job = useTrainingJob(jobId, (finished) => {
    if (finished.status === 'completed') toast(`Training finished: ${finished.total} destinations`, 'success');
    else toast(`Training failed: ${finished.error}`);
    setJobId(null);
    refreshList();
    if (selectedId) loadDetail(selectedId);
  });

  useEffect(() => {
    if (!selectedId || !heatDest) return undefined;
    let cancelled = false;
    api.getQTable(selectedId, heatDest)
      .then((t) => { if (!cancelled) setHeatmap(t); })
      .catch(() => { if (!cancelled) setHeatmap(null); });
    return () => { cancelled = true; };
  }, [selectedId, heatDest, detail]);

  const curves = job?.curves && Object.keys(job.curves).length ? job.curves : detail?.training_history;
  const episodes = trainHp.episodes_per_destination;
  const chartSeries = useMemo(() => {
    const rewards = averageCurve(curves, 'rewards', 100);
    const steps = averageCurve(curves, 'steps', 100);
    const n = Object.values(curves ?? {})[0]?.episodes ?? episodes;
    return {
      rewards: rewards.length ? [{ label: 'Average reward per episode', color: '#FF5A26', points: toPoints(rewards, n) }] : [],
      steps: steps.length ? [{ label: 'Average steps to reach the goal', color: '#2563EB', points: toPoints(steps, n) }] : [],
    };
  }, [curves, episodes]);

  const create = async (e) => {
    e.preventDefault();
    try {
      const model = await api.createModel(newModel);
      setNewModel({ ...newModel, name: '' });
      await refreshList();
      setSelectedId(model.id);
      toast(`Created "${model.name}"`, 'success');
    } catch (err) {
      toast(err.message);
    }
  };

  const train = async () => {
    try {
      const started = await api.trainModel(selectedId, { hyperparameters: trainHp });
      setJobId(started.id);
    } catch (err) {
      toast(err.message);
    }
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const model = await api.importModel(JSON.parse(await file.text()));
      await refreshList();
      setSelectedId(model.id);
      toast(`Imported "${model.name}"`, 'success');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteModel(selectedId);
      setSelectedId(null);
      setDetail(null);
      setConfirmDelete(false);
      refreshList();
    } catch (err) {
      toast(err.message);
    }
  };

  const layoutName = (id) => layouts.find((l) => l.id === id)?.name ?? id;
  const training = job && (job.status === 'queued' || job.status === 'running');

  return (
    <div className="view-scroll">
      <h1 className="view-title">Models</h1>
      <div className="split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form className="clay-card panel" onSubmit={create}>
            <div className="view-subtitle">New model</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="field">Name
                <input className="clay-input" required maxLength={80} value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} />
              </label>
              <label className="field">Layout
                <select className="clay-select" value={newModel.layout_id} onChange={(e) => setNewModel({ ...newModel, layout_id: e.target.value })}>
                  {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <HyperparameterFields value={newModel.hyperparameters} onChange={(hp) => setNewModel({ ...newModel, hyperparameters: hp })} />
              <button type="submit" className="clay-btn clay-btn-accent">Create model</button>
            </div>
          </form>
          <div className="clay-card panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="view-subtitle" style={{ margin: 0 }}>Saved models</div>
              <button type="button" className="clay-btn clay-pill-sm" onClick={() => fileRef.current?.click()}>Import JSON</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
            </div>
            {models.length === 0 && <p style={{ fontSize: 12, color: '#8E8578' }}>No models yet. Create one above, then train it.</p>}
            <table className="data-table">
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className={`clickable ${m.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(m.id); setConfirmDelete(false); }}>
                    <td><strong>{m.name}</strong><div style={{ fontSize: 10, color: '#8E8578' }}>v{m.version} · {layoutName(m.layout_id)}</div></td>
                    <td className="num">{m.trained_destinations} trained</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!detail ? (
          <div className="clay-card panel empty-state" style={{ minHeight: 300 }}>Select a model to train it and inspect what it learned.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="clay-card panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800 }}>{detail.name} <span className="badge">v{detail.version}</span></h2>
                  <div style={{ fontSize: 12, color: '#6B6357' }}>
                    {layoutName(detail.layout_id)} · {detail.trained_destinations} / {detail.layout_destinations.length} destinations trained
                    {detail.last_trained_at && ` · last trained ${new Date(detail.last_trained_at).toLocaleString()}`}
                  </div>
                  {!detail.layout_matches && <span className="badge badge-warn">Layout changed since this model was created; retrain it.</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a className="clay-btn clay-pill-sm" href={api.exportModelUrl(detail.id)} download>Export JSON</a>
                  <button type="button" className="clay-btn clay-pill-sm" onClick={remove}>{confirmDelete ? 'Click again to delete' : 'Delete'}</button>
                </div>
              </div>
            </div>

            <div className="clay-card panel">
              <div className="view-subtitle">Train</div>
              <HyperparameterFields value={trainHp} onChange={setTrainHp} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button type="button" className="clay-btn clay-btn-accent" onClick={train} disabled={training}>
                  {training ? 'Training…' : detail.trained_destinations ? 'Train more' : 'Train all destinations'}
                </button>
                {job && (
                  <div style={{ flex: 1 }}>
                    <div className="progress"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
                    <div style={{ fontSize: 11, color: '#6B6357', marginTop: 4 }}>
                      {job.done} / {job.total} destinations
                      {job.current_destination && ` · ${coordLabel(job.current_destination[0], job.current_destination[1])}`}
                    </div>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11, color: '#8E8578', marginTop: 8 }}>
                Training continues from the current Q-values, so pressing Train more adds episodes on top.
              </p>
            </div>

            <div className="clay-card panel">
              <div className="view-subtitle">Learning curve (averaged over destinations)</div>
              <LineChart series={chartSeries.rewards} xLabel="episode" yLabel="Reward" />
              <LineChart series={chartSeries.steps} xLabel="episode" yLabel="Steps" height={150} />
            </div>

            <div className="clay-card panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div className="view-subtitle" style={{ margin: 0 }}>What the robot learned for one destination</div>
                <select className="clay-select" style={{ width: 'auto' }} value={heatDest ? heatDest.join(',') : ''}
                  onChange={(e) => setHeatDest(e.target.value.split(',').map(Number))} disabled={!detail.destinations.length}>
                  {detail.destinations.map(([x, y]) => <option key={`${x},${y}`} value={`${x},${y}`}>{coordLabel(x, y)}</option>)}
                </select>
              </div>
              {detail.destinations.length ? (
                <div style={{ height: 460 }}>
                  <WarehouseMapCanvas layout={layout} layers={HEAT_LAYERS} heatmap={heatmap} heatmapTarget={heatDest} />
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#8E8578' }}>Train the model to see its Q-value heatmap and policy arrows.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Lint, test, build and check in the browser**

Run: `npm run lint && npm test && npm run build`. Then, with both servers running, go to the Models view:
1. Create a model. The default 3000 episodes takes about 3 s; you can use 300 for a quicker check.
2. Train it, and watch the progress bar fill and the learning curve appear.
3. Pick destinations in the heatmap selector; the arrows should point toward the outlined cell.
4. Export, then re-import the file; a copy appears in the list.
5. Delete the copy with the two clicks.

- [ ] **Step 7: Commit**

```
git add frontend
git commit -m "feat(frontend): models view with training progress, learning curves and Q heatmaps"
```

---

### Task 14: Layouts view (paint, validate, save)

**Files:**
- Rewrite: `frontend/src/components/MapPaintToolbar.jsx`
- Rewrite: `frontend/src/views/LayoutsView.jsx`

**Interfaces:**
- Consumes: `api.listLayouts`, `getLayout`, `createLayout` and `updateLayout`. A 400 response's `detail` is `{message, unreachable}`. Also `pickFaces` and `cellKey` (Task 11) and `WarehouseMapCanvas` (Task 12).
- Produces: `<MapPaintToolbar activeBrush onSelectBrush onReset disabled />`.

- [ ] **Step 1: Rewrite the toolbar** — `frontend/src/components/MapPaintToolbar.jsx`:

```jsx
const TOOLS = [
  { id: 'rack', label: 'Rack', color: '#DDD6C7' },
  { id: 'packing', label: 'Packing', color: '#2563EB' },
  { id: 'dock', label: 'Dock', color: '#10B981' },
  { id: 'charger', label: 'Charger', color: '#F59E0B' },
  { id: 'aisle', label: 'Erase', color: '#EFECE4' },
];

export function MapPaintToolbar({ activeBrush, onSelectBrush, onReset, disabled }) {
  return (
    <div className="clay-card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="view-subtitle" style={{ margin: 0 }}>Paint</span>
      {TOOLS.map((tool) => (
        <button key={tool.id} type="button" disabled={disabled}
          onClick={() => onSelectBrush(activeBrush === tool.id ? null : tool.id)}
          className={`clay-btn clay-pill-sm ${activeBrush === tool.id ? 'clay-btn-active' : ''}`}
          style={{ fontSize: 11, gap: 6, border: activeBrush === tool.id ? '1.5px solid #23201A' : undefined }}
          aria-pressed={activeBrush === tool.id}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: tool.color }} />
          {tool.label}
        </button>
      ))}
      <button type="button" className="clay-btn clay-pill-sm" style={{ fontSize: 11, color: '#8E8578' }} onClick={onReset} disabled={disabled}>
        Undo all changes
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Build the view** — replace `frontend/src/views/LayoutsView.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPaintToolbar } from '../components/MapPaintToolbar';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { cellKey, pickFaces } from '../lib/grid';
import { api } from '../services/api';

const NO_LAYERS = { paths: false, qHeatmap: false, yieldHalos: false };

export function LayoutsView() {
  const toast = useToast();
  const [layouts, setLayouts] = useState([]);
  const [selectedId, setSelectedId] = useState('default');
  const [saved, setSaved] = useState(null);
  const [cells, setCells] = useState(null);
  const [name, setName] = useState('');
  const [brush, setBrush] = useState(null);
  const [errorCells, setErrorCells] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLayouts(await api.listLayouts());
    } catch (err) {
      toast(err.message);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    api.getLayout(selectedId)
      .then((layout) => {
        if (cancelled) return;
        setSaved(layout);
        setCells(layout.cells.map((row) => [...row]));
        setName(layout.is_default ? `${layout.name} copy` : layout.name);
        setErrorCells(null);
      })
      .catch((err) => toast(err.message));
    return () => { cancelled = true; };
  }, [selectedId, toast]);

  const dirty = useMemo(() => saved && cells && JSON.stringify(saved.cells) !== JSON.stringify(cells), [saved, cells]);
  const preview = useMemo(() => {
    if (!saved || !cells) return null;
    return { ...saved, cells, products: dirty ? [] : saved.products, pick_faces: pickFaces(cells) };
  }, [saved, cells, dirty]);
  const counts = useMemo(() => {
    const c = { rack: 0, packing: 0, dock: 0, charger: 0 };
    cells?.forEach((row) => row.forEach((kind) => { if (kind in c) c[kind] += 1; }));
    return c;
  }, [cells]);

  const paint = (x, y) => {
    if (!brush || !saved) return;
    setCells((prev) => {
      if (prev[y][x] === brush) return prev;
      const next = prev.map((row) => [...row]);
      next[y][x] = brush;
      return next;
    });
    setErrorCells(null);
  };

  const save = async (asNew) => {
    const body = { name: name.trim() || 'Untitled layout', width: saved.width, height: saved.height, cells, products: null };
    try {
      const result = asNew ? await api.createLayout(body) : await api.updateLayout(saved.id, body);
      toast(asNew ? `Saved new layout "${result.name}"` : 'Layout saved', 'success');
      await refresh();
      if (asNew) setSelectedId(result.id);
      else {
        setSaved(result);
        setCells(result.cells.map((row) => [...row]));
      }
    } catch (err) {
      const unreachable = err.detail?.unreachable;
      if (unreachable?.length) setErrorCells(new Set(unreachable.map(([x, y]) => cellKey(x, y))));
      toast(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '24px 32px 12px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <h1 className="view-title" style={{ margin: 0, marginRight: 8 }}>Layouts</h1>
        <label className="field">Layout
          <select className="clay-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}{l.is_default ? ' (built-in)' : ''}</option>)}
          </select>
        </label>
        <label className="field" style={{ minWidth: 220 }}>Name
          <input className="clay-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {!saved?.is_default && (
          <button type="button" className="clay-btn clay-btn-accent" onClick={() => save(false)} disabled={!dirty && name === saved?.name}>Save</button>
        )}
        <button type="button" className="clay-btn" onClick={() => save(true)}>Save as new layout</button>
      </div>
      <div style={{ padding: '0 32px 8px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <MapPaintToolbar activeBrush={brush} onSelectBrush={setBrush} disabled={!cells}
          onReset={() => { setCells(saved.cells.map((row) => [...row])); setErrorCells(null); }} />
        <span style={{ fontSize: 12, color: '#6B6357' }}>
          {counts.rack} racks · {preview?.pick_faces.length ?? 0} pick faces · {counts.packing} packing · {counts.dock} docks · {counts.charger} chargers
          {dirty && ' · unsaved changes'}
        </span>
      </div>
      <p style={{ padding: '0 32px', fontSize: 11, color: '#8E8578' }}>
        {saved?.is_default ? 'The built-in layout is read-only; paint on it and use "Save as new layout". ' : ''}
        Products are spread over the pick faces automatically when you save. Models are tied to a layout, so retrain after editing one.
      </p>
      <div style={{ flex: 1, minHeight: 0 }}>
        <WarehouseMapCanvas layout={preview} layers={NO_LAYERS} activeBrush={brush} onPaintCell={paint} errorCells={errorCells} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Lint, build and check in the browser**

Run: `npm run lint && npm run build`. Then, in the Layouts view:
1. Paint a few racks onto the built-in layout and press "Save as new layout"; it appears in the selector.
2. Wall in the dock with racks and press Save. You get a toast error and the dock gets a red outline.
3. "Undo all changes" restores the layout.

- [ ] **Step 4: Commit**

```
git add frontend
git commit -m "feat(frontend): layout editor with validation feedback"
```

---

### Task 15: History & Compare view

**Files:**
- Create: `frontend/src/components/BarCompare.jsx`
- Rewrite: `frontend/src/views/HistoryView.jsx`

**Interfaces:**
- Consumes: `api.listSessions`, `getSession`, `listModels`, `listLayouts` and `compare` (Tasks 9–10); `LineChart` (Task 13); `useToast`.
- Produces: `<BarCompare runs={[{label, color, summary}]} metrics={[{key, label, better: 'high' | 'low'}]} />`.

- [ ] **Step 1: Add the bar comparison** — `frontend/src/components/BarCompare.jsx`:

```jsx
export function BarCompare({ runs, metrics }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
      {metrics.map(({ key, label, better }) => {
        const values = runs.map((r) => r.summary?.[key] ?? 0);
        const max = Math.max(...values, 1e-9);
        const best = better === 'low' ? Math.min(...values) : Math.max(...values);
        return (
          <div key={key}>
            <div className="stat-label" style={{ marginBottom: 6 }}>{label} ({better === 'low' ? 'lower' : 'higher'} is better)</div>
            {runs.map((run, i) => (
              <div key={`${run.label}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 14, background: '#EEE9E0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(100 * values[i]) / max}%`, height: '100%', background: run.color, opacity: values[i] === best ? 1 : 0.55 }} />
                </div>
                <span className="font-mono" style={{ fontSize: 11, width: 56, textAlign: 'right' }}>{Number(values[i].toFixed(3))}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build the view** — replace `frontend/src/views/HistoryView.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { BarCompare } from '../components/BarCompare';
import { LineChart } from '../components/LineChart';
import { useToast } from '../components/toastContext';
import { api } from '../services/api';

const COLORS = ['#FF5A26', '#2563EB', '#10B981', '#9333EA', '#E11D48', '#0891B2'];
const MODE_LABELS = { hybrid: 'Hybrid', q_only: 'Q-only', astar: 'A*' };
const METRICS = [
  { key: 'throughput_per_100', label: 'Orders per 100 ticks', better: 'high' },
  { key: 'p95_cycle_time', label: 'p95 order time (ticks)', better: 'low' },
  { key: 'fallback_share', label: 'Fallback share of legs', better: 'low' },
  { key: 'avg_extra_steps_per_leg', label: 'Extra steps per leg vs A*', better: 'low' },
  { key: 'wait_events', label: 'Collision waits', better: 'low' },
  { key: 'failed', label: 'Failed orders', better: 'low' },
];
const SUMMARY_STATS = [
  ['delivered', 'Delivered'], ['throughput_per_100', 'Per 100 ticks'], ['avg_cycle_time', 'Avg order time'],
  ['p95_cycle_time', 'p95 order time'], ['steps_per_delivery', 'Steps / delivery'], ['fallback_share', 'Fallback share'],
  ['q_step_share', 'Q-routed steps'], ['wait_events', 'Waits'], ['failed', 'Failed'],
];

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? Number(v.toFixed(3)) : v);

export function HistoryView({ onOpenSession }) {
  const toast = useToast();
  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ layout_id: 'default', robot_count: 4, rate_per_100: 20, ticks: 2000, seed: 42 });
  const [runs, setRuns] = useState([{ model_id: '', routing_mode: 'astar' }, { model_id: '', routing_mode: 'q_only' }]);
  const [results, setResults] = useState(null);
  const [comparing, setComparing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, m, l] = await Promise.all([api.listSessions(), api.listModels(), api.listLayouts()]);
      setSessions(s);
      setModels(m);
      setLayouts(l);
    } catch (err) {
      toast(err.message);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const open = async (id) => {
    try {
      setSelected(await api.getSession(id));
    } catch (err) {
      toast(err.message);
    }
  };

  const modelName = (id) => (id ? models.find((m) => m.id === id)?.name ?? 'deleted model' : 'no model');

  const runCompare = async (e) => {
    e.preventDefault();
    setComparing(true);
    try {
      const response = await api.compare({
        layout_id: form.layout_id,
        robot_count: Number(form.robot_count),
        ticks: Number(form.ticks),
        orders: { rate_per_100: Number(form.rate_per_100), seed: Number(form.seed) },
        runs: runs.map((r) => ({ model_id: r.model_id || null, routing_mode: r.routing_mode })),
      });
      setResults(response.runs.map((r, i) => ({ ...r, color: COLORS[i % COLORS.length] })));
    } catch (err) {
      toast(err.message);
    } finally {
      setComparing(false);
    }
  };

  const setRun = (i, patch) => setRuns(runs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="view-scroll">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 className="view-title" style={{ margin: 0 }}>History & Compare</h1>
        <button type="button" className="clay-btn clay-pill-sm" onClick={refresh}>Refresh</button>
      </div>

      <div className="clay-card panel" style={{ marginBottom: 16 }}>
        <div className="view-subtitle">Sessions</div>
        {sessions.length === 0 ? (
          <p style={{ fontSize: 12, color: '#8E8578' }}>No sessions yet. Start one from the Session view.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Status</th><th>Model</th><th className="num">Ticks</th><th className="num">Delivered</th>
                  <th className="num">Per 100</th><th className="num">p95</th><th className="num">Fallbacks</th><th>Started</th></tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className={`clickable ${selected?.id === s.id ? 'selected' : ''}`} onClick={() => open(s.id)}>
                    <td>{s.name}</td>
                    <td><span className={`badge ${s.live ? 'badge-live' : ''}`}>{s.status}</span></td>
                    <td>{modelName(s.config.model_id)} · {MODE_LABELS[s.config.routing_mode]}</td>
                    <td className="num">{s.tick}</td>
                    <td className="num">{fmt(s.summary?.delivered)}</td>
                    <td className="num">{fmt(s.summary?.throughput_per_100)}</td>
                    <td className="num">{fmt(s.summary?.p95_cycle_time)}</td>
                    <td className="num">{fmt(s.summary?.fallbacks)}</td>
                    <td>{new Date(s.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="clay-card panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800 }}>{selected.name}</h2>
            {selected.live && <button type="button" className="clay-btn clay-btn-accent clay-pill-sm" onClick={() => onOpenSession(selected.id)}>Open live view</button>}
          </div>
          {selected.error && <p style={{ color: '#EF4444', fontSize: 12 }}>{selected.error}</p>}
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            {SUMMARY_STATS.map(([key, label]) => (
              <div key={key} className="clay-card-flat stat"><span className="stat-label">{label}</span><span className="stat-value">{fmt(selected.summary?.[key])}</span></div>
            ))}
          </div>
          <LineChart xLabel="tick" yLabel="Orders per 100 ticks"
            series={[{ label: 'Throughput', color: '#FF5A26', points: selected.metrics.map((m) => ({ x: m.tick, y: m.throughput_per_100 })) }]} />
          <LineChart xLabel="tick" yLabel="Orders" height={150}
            series={[
              { label: 'Delivered', color: '#10B981', points: selected.metrics.map((m) => ({ x: m.tick, y: m.delivered })) },
              { label: 'Queued', color: '#B8B0A2', points: selected.metrics.map((m) => ({ x: m.tick, y: m.queued })) },
            ]} />
        </div>
      )}

      <form className="clay-card panel" onSubmit={runCompare}>
        <div className="view-subtitle">Compare models on the same orders</div>
        <p style={{ fontSize: 11, color: '#8E8578', marginBottom: 10 }}>
          Every run replays the same seeded order stream headless, so differences come from the routing alone.
        </p>
        <div className="field-row" style={{ marginBottom: 12 }}>
          <label className="field">Layout
            <select className="clay-select" value={form.layout_id} onChange={(e) => setForm({ ...form, layout_id: e.target.value })}>
              {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="field">Robots<input className="clay-input" type="number" min="1" max="8" value={form.robot_count} onChange={(e) => setForm({ ...form, robot_count: e.target.value })} /></label>
          <label className="field">Orders / 100 ticks<input className="clay-input" type="number" min="0" max="100" value={form.rate_per_100} onChange={(e) => setForm({ ...form, rate_per_100: e.target.value })} /></label>
          <label className="field">Ticks<input className="clay-input" type="number" min="10" max="5000" value={form.ticks} onChange={(e) => setForm({ ...form, ticks: e.target.value })} /></label>
          <label className="field">Seed<input className="clay-input" type="number" value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} /></label>
        </div>
        {runs.map((run, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i] }} />
            <select className="clay-select" value={run.model_id} onChange={(e) => setRun(i, { model_id: e.target.value })}>
              <option value="">No model</option>
              {models.filter((m) => m.layout_id === form.layout_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select className="clay-select" value={run.routing_mode} onChange={(e) => setRun(i, { routing_mode: e.target.value })}>
              <option value="astar">Pure A*</option>
              <option value="q_only">Q-learning only</option>
              <option value="hybrid">Hybrid</option>
            </select>
            <button type="button" className="clay-btn clay-pill-sm" disabled={runs.length <= 1} onClick={() => setRuns(runs.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" className="clay-btn" disabled={runs.length >= 6} onClick={() => setRuns([...runs, { model_id: '', routing_mode: 'astar' }])}>Add run</button>
          <button type="submit" className="clay-btn clay-btn-accent" disabled={comparing}>{comparing ? 'Running…' : 'Run comparison'}</button>
        </div>

        {results && (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <BarCompare runs={results} metrics={METRICS} />
            <LineChart xLabel="tick" yLabel="Orders per 100 ticks"
              series={results.map((r) => ({ label: r.label, color: r.color, points: r.series.map((p) => ({ x: p.tick, y: p.throughput_per_100 })) }))} />
          </div>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Lint, build and check in the browser**

Run: `npm run lint && npm run build`. Then, in History & Compare:
1. Finished sessions are listed. Clicking one shows its stats and charts.
2. A live session shows "Open live view".
3. A comparison of "No model · A\*" vs a trained model in Q-only vs an untrained model in Q-only returns bars and lines within a few seconds.

- [ ] **Step 4: Commit**

```
git add frontend
git commit -m "feat(frontend): session history and seeded model comparison"
```

---

### Task 16: Acceptance test, local run scripts, Docker and docs

**Files:**
- Create: `backend/app/tests/test_acceptance.py`
- Create: `dev.ps1`
- Modify: `docker-compose.yml`
- Modify: `README.md`, `frontend/README.md`
- Delete: `docs/superpowers/plans/2026-10-14-training-sessions-CHECKPOINT.md` (superseded by this plan)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write the acceptance test** — `backend/app/tests/test_acceptance.py`:

```python
"""The project's headline claim: trained agents follow their policy and keep up with A*."""

import pytest

from app.simulation.grid import default_layout
from app.simulation.models import Hyperparameters, OrderSettings, SessionConfig, StopCondition
from app.simulation.q_learning import train_model
from app.simulation.simulator import Simulator


def _run(layout, mode, qtables):
    config = SessionConfig(routing_mode=mode, robot_count=4, orders=OrderSettings(rate_per_100=20, seed=42),
                           stop=StopCondition("ticks", 2000))
    sim = Simulator(layout, config, qtables)
    while not sim.finished:
        sim.step()
    return sim.summary()


@pytest.mark.slow
def test_trained_model_beats_undertrained_and_keeps_up_with_astar():
    layout = default_layout()
    full, _ = train_model(layout, Hyperparameters(), seed=1)
    under, _ = train_model(layout, Hyperparameters(episodes_per_destination=300), seed=1)
    astar = _run(layout, "astar", None)
    trained = _run(layout, "q_only", full)
    weak = _run(layout, "q_only", under)
    print("\nA*:", astar, "\ntrained:", trained, "\nundertrained:", weak)
    assert trained["fallback_share"] < 0.10
    assert weak["fallback_share"] >= 0.30
    assert trained["throughput_per_100"] >= 0.85 * astar["throughput_per_100"]
```

- [ ] **Step 2: Run it**

Run: `.venv\Scripts\python.exe -m pytest -m slow -s -q`
Expected: pass in under a minute, printing the three summaries.

If `weak["fallback_share"] >= 0.30` fails, try the undertrained model with fewer episodes (150, then 100) until the contrast holds. Record the value you used in the spec's acceptance section, in the same commit. If either of the other two assertions fails, that's a real defect: debug the simulator with superpowers:systematic-debugging, and don't relax the threshold.

- [ ] **Step 3: Add the Windows launcher** — `dev.ps1` at the repo root:

```powershell
# Starts the RoboWare backend (port 8080) and frontend (port 5173) in two new PowerShell windows,
# installing dependencies on the first run, then opens the app in the browser.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
    python -m venv (Join-Path $backend '.venv')
    & $python -m pip install -r (Join-Path $backend 'requirements.txt')
}
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Push-Location $frontend
    npm install
    Pop-Location
}

Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$backend'; & '$python' -m uvicorn app.main:app --reload --port 8080"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$frontend'; npm run dev"
Start-Sleep -Seconds 4
Start-Process 'http://localhost:5173'
```

- [ ] **Step 4: Replace the placeholder Docker service** — `docker-compose.yml`:

```yaml
services:
  backend:
    image: python:3.13-slim
    working_dir: /app
    volumes:
      - ./backend:/app
    ports:
      - "8080:8080"
    command: sh -c "pip install --no-cache-dir -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload"

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      - CHOKIDAR_USEPOLLING=true
      - VITE_API_TARGET=http://backend:8080
    depends_on:
      - backend
    command: npm run dev -- --host 0.0.0.0
```

Only validate the file (`docker compose config`) if Docker is installed. Don't install Docker.

- [ ] **Step 5: Update the docs**

Replace `README.md` with:

````markdown
# RoboWare

RoboWare is a warehouse simulation where robot agents learn to move around a warehouse floor and then work on their own: they pick multi-item orders from shelves, pack them at packing stations, and ship them from the dock. Their batteries drain as they work and they recharge at chargers when they run low.

- **Models:** each model holds one Q-table per destination (every stocked shelf face, packing station, dock and charger). They are trained with the tabular Q-learning rule from `base_reference_model.ipynb`.
- **Sessions:** an automated run with a fleet of 1–8 robots, a stream of orders, and live metrics. Robots route with Pure A\*, Q-learning only (falling back to A\* when the policy loops), or a hybrid of the two.
- **Compare:** replays the same seeded orders with different models and routing modes, so you can see how much the training helps.

## Run it locally (Windows)

```powershell
.\dev.ps1
```

On the first run this creates `backend\.venv`, installs the Python and npm dependencies, starts both servers, and opens http://localhost:5173.

To run each part by hand:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8080
```

```powershell
cd frontend
npm install
npm run dev
```

Or run both in Docker with `docker compose up`.

## Using it

1. **Models:** create a model and train it. Watch the learning curve, and inspect the heatmap and policy arrows for any destination.
2. **Session:** start a new session with that model, press Play (Space), and change the speed. You can add orders by hand, inspect a robot, and toggle the paths and Q-heatmap layers.
3. **Layouts:** paint racks, packing stations, docks and chargers, then save the result as a new layout. Retrain a model for it.
4. **History & Compare:** review finished sessions, and compare models on the same orders.

## Tests

```powershell
cd backend
.venv\Scripts\python.exe -m pytest                # fast suite
.venv\Scripts\python.exe -m pytest -m slow -s     # acceptance: trained vs undertrained vs A*
cd ..\frontend
npm test
npm run lint
```

## Where things live

- `backend/app/simulation/`: the simulation core (grid, A\*, Q-learning, orders, collisions, metrics, simulator). It does no I/O and is fully tested.
- `backend/app/`: the FastAPI app, SQLite storage, training jobs, and live sessions over a WebSocket.
- `backend/data/`: the local database and trained models (git-ignored).
- `frontend/src/`: the React UI (views, components, API and stream clients).
- `docs/superpowers/`: the design spec and implementation plan.
````

Replace `frontend/README.md` with:
```markdown
# RoboWare Frontend

React 19 + Vite UI for RoboWare. It talks to the FastAPI backend on port 8080 through Vite's `/api` proxy, which also carries the live session WebSocket. Set `VITE_API_TARGET` to point the proxy somewhere else.

- `npm run dev` — dev server on http://localhost:5173
- `npm test` — Vitest unit tests (stream reducer, grid and curve helpers)
- `npm run lint` / `npm run build`

Views: `src/views/` (Session, Models, Layouts, History & Compare). Map and panels: `src/components/`.
```

Run: `git rm docs/superpowers/plans/2026-10-14-training-sessions-CHECKPOINT.md`

- [ ] **Step 6: Full verification (use superpowers:verification-before-completion)**

Run each of these and read the output:
- `backend`: `.venv\Scripts\python.exe -m pytest -q` (all pass) and `.venv\Scripts\python.exe -m pytest -m slow -q` (pass)
- `frontend`: `npm run lint`, `npm test` and `npm run build` (all clean)
- `git status` (clean apart from your intended changes; `backend/data/` must not show up)

Then start the app with `.\dev.ps1` and run one smoke check against the live servers from a scratchpad script. It doesn't belong in the repo. Use the Python standard library (`urllib`) for REST and `websockets` (already installed) for the stream:
1. `POST /api/models`, `POST /api/models/{id}/train` with 300 episodes, and poll until the job completes.
2. `POST /api/sessions` with that model in Q-only mode.
3. Open `ws://localhost:5173/api/sessions/{id}/stream` through the Vite proxy, send `{"type":"control","action":"play","speed":"max"}`, and read frames until `finished` or 15 s pass. Assert that at least one `delivered` event arrived.

Report the results. Tell the user the app is running at http://localhost:5173 and ask them to click through the four views themselves; the browser checks in Tasks 11–15 are their visual confirmation.

- [ ] **Step 7: Commit (do NOT push)**

```
git add -A
git commit -m "test: acceptance test; docs, dev.ps1 launcher and Docker backend service"
```

Then run `git log --oneline main..HEAD` and show it to the user. **Do not push.**
