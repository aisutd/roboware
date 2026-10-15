# RoboWare: Agent Training & Automated Warehouse Sessions â€” Design

**Date:** 2026-10-14
**Status:** Draft, awaiting review
**Branch:** `feature/training-sessions` (local only; never pushed)

## 1. Goal

Turn RoboWare from a single-page browser demo into the final project. In the finished app you can:

1. **Train agents from the UI.** Create named models, train them on a warehouse layout, watch the learning curves, and save them.
2. **Run automated sessions.** Pick a model, a layout and an order workload, then let a robot fleet run hands-free. Robots pick multi-item orders from shelves, pack them at stations, and ship them from docks.
3. **Measure and compare.** Every session records metrics, and the same seeded workload can be replayed with different models or routing modes. This shows that trained agents beat untrained ones and come close to the A\* baseline.

**Success criteria:**
- A user can train a model, save it, start a session with it, and see it deliver orders autonomously.
- On a seeded comparison, a fully trained model in Q-only mode has far fewer fallbacks (under 10% of legs) than an undertrained one (300 episodes per destination). An untrained model has no tables, so in Q-only mode every leg falls back to A*.
- A session's throughput is within roughly 15% of Pure A\* on the default layout.
- Everything runs locally with one command per service, or with `docker compose up`.

**Non-goals:** user accounts, deployment, a learned dispatcher, deep RL, restocking, and a UI for resizing the grid.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Where it runs | **Python backend** (FastAPI). The browser is a control panel and viewer. |
| What is learned | **Navigation per destination**: one tabular Q-table per destination cell, using the notebook's Q-learning rule. |
| Warehouse detail | **Multi-item orders** (1â€“3 products), stock counts, packing stations, shipping docks, no restocking. |
| Live updates | The server streams state to the browser over a **WebSocket**. Training runs in a background worker. Storage is model JSON files plus a **SQLite** database. |
| Dispatcher | Rule-based and the same for every model, so comparisons stay fair. |
| Repo | Work on a local branch and commit locally. **Never push.** |

## 3. Domain model

### 3.1 Layout (grid)
- The default is 16Ã—10 and reproduces today's default layout: racks in three bays, packing stations at (14,2) and (14,5), a shipping dock at (14,8), and chargers at (0,2) and (0,7).
- Cell types: `aisle`, `rack` (blocks movement), `packing`, `dock`, `charger`.
  - Packing, dock and charger cells can be driven on.
- **Pick faces** are derived automatically: every aisle cell directly next to a rack.
  - Each product is assigned to one pick face.
  - Several products can share a face.
- **Layout fingerprint:** a SHA-256 hash of the size plus the cell grid. It's used to check that a model matches its layout.
- **Validation:** every destination must be reachable from every charger, checked with a flood fill. A layout that fails can't be saved and the API returns an error listing the unreachable cells.

### 3.2 Products and inventory
- The default layout comes with 24 products (`SKU-001`â€¦`SKU-024`, with readable names), spread across the pick faces, each with 20â€“40 units in stock.
- Picking reduces stock. An order that needs a product with zero stock becomes `failed` when it's dispatched. Nothing is restocked.

### 3.3 Order
- **Fields:** `id`, `items: [{sku, qty}]` (1â€“3 distinct SKUs, qty 1â€“2), `priority` (`normal` | `rush`), `created_tick`, `status`, `robot_id`, a timeline that records the tick of each state change, and `package_id`.
- **Lifecycle:** `queued â†’ assigned â†’ picking â†’ packing â†’ shipping â†’ delivered`, or `failed`.

### 3.4 Package
- Created when packing finishes.
- **Fields:** `id`, `order_id`, `station`, `packed_tick`, `delivered_tick`.

### 3.5 Robot
- **Fields:** `id`, `pos`, `battery` (0â€“100), `status`, `task`, `carrying`, `wait_ticks`, `visit_counts`, and per-robot stats.
- **`status`** is one of `idle`, `to_pick`, `picking`, `to_pack`, `queued_pack`, `packing`, `to_dock`, `to_charger`, `charging`, or `parking` (moving off a station, dock or charger cell when idle). A separate `yielding` flag marks a robot that waited this tick.
- **`task`** holds the order, its remaining pick stops, and the current target.
- **`carrying`** is either a list of picked items or a package.
- **`visit_counts`** tracks visits per cell on the current leg, for loop detection.
- A session has 1â€“8 robots (4 by default). Robots start at the chargers and nearby aisle cells.

### 3.6 Model
- **Metadata:** `id`, `name`, `layout_id`, `layout_fingerprint`, `created_at`, `updated_at`, `version`, and `parent_model_id`, which is set when a session saves a model that kept learning as a new version.
- **Hyperparameters:**
  - `learning_rate` Î± = 0.1
  - `discount_factor` Î³ = 0.95
  - `exploration_rate` Îµ = 0.3
  - `epsilon_decay`: off by default; when on, Îµ decays linearly to `epsilon_min` = 0.05
  - `step_reward` = âˆ’1
  - `goal_reward` = 10
  - `episodes_per_destination` = 3000 (calibration: 300 episodes reach the goal from ~55% of cells, 3000 from 98–100%, ~0.1 s per destination)
  - `max_steps` = 200
- **Q-tables:** a mapping from destination (`"x,y"`) to a `[W*H][4]` array of floats. The state index is `y*W + x` and the actions are `[up, down, left, right]`, matching the current JS engine.
- **Training history:** for each destination, the reward and step count of every episode. These are downsampled to at most 300 points per destination when stored.
- **File format** (`backend/data/models/<id>.json`): the notebook export's keys (`q_table`, `actions`, `goal`, `step_reward`, `goal_reward`, `discount_factor`) appear once per destination under `destinations`, alongside the metadata above.
  - Import accepts both this format and the original single-goal notebook or browser export. The old format is imported as a model with one destination.

### 3.7 Session
- **Config:**
  - `layout_id` and `model_id`; the model is optional, and Pure A\* doesn't need one.
  - `routing_mode` (`hybrid` | `q_only` | `astar`), `hybrid_margin` (default 0.5), and `robot_count`.
  - `orders`: arrival rate (orders per 100 ticks), mix of order sizes, fraction of rush orders, and `seed`.
  - `stop`: `{type: ticks|orders|manual, value}`.
  - `online_learning` (bool).
  - `metrics_every` = 10 ticks.
- **State:** `created`, `running`, `paused`, `finished`, or `interrupted` (the server restarted mid-run).
- Each session records its stats every `metrics_every` ticks, plus a final summary and each finished order's timeline.

## 4. Simulation

### 4.1 Tick order
The simulator is deterministic: it takes `(state, rng)` and returns the new state plus a list of events. It does no I/O.

1. **Arrivals.** Generate orders from the seeded generator, then add any orders injected by hand.
2. **Dispatch.** Take queued orders, rush first and then oldest first. For each one:
   - Fail it if stock is short.
   - Otherwise, assign it to the nearest idle robot (by A\* distance) whose battery is above 35%.
   - Order its pick stops with a nearest-neighbor heuristic.
   - Reserve the stock.
3. **Plan.** Each moving robot picks one step toward its target, depending on the routing mode (see 4.3).
4. **Resolve collisions.** Robots claim the cells they want next, in priority order:
   1. battery below 10%
   2. rush order
   3. carrying something
   4. everyone else
   5. ties broken by robot ID

   A robot can't move when:
   - a higher-priority robot claimed the same cell
   - the move is a head-on swap
   - its target cell is occupied by a robot that isn't moving

   That robot waits and is marked `yielding`. If it has waited more than 3 ticks, it re-plans with A\* that treats the other robots as obstacles.
5. **Move and battery.** Each step costs 0.8% battery, and waiting costs 0.1%.
   - If a robot's battery drops below 20% while it isn't carrying anything, it goes to the least busy charger.
   - If it is carrying something, it finishes the current order and then charges.
   - At a charger it gains 5% per tick up to 100%, then returns to idle.
6. **Arrival work.**
   - **At a pick face:** picking takes 1 tick, and stock moves into `carrying`.
   - **At a packing station:** packing takes 3 ticks and the station handles one robot at a time. Robots queue first-in first-out on the station cell or next to it.
   - **At the dock:** the package is delivered, the order is marked `delivered`, and the times are recorded.
7. **Stop check.** The session ends when its stop condition is met.

### 4.2 Destinations
A model's destinations are every pick face that holds at least one product, plus every packing station, dock, and charger in its layout. The default layout has 29: 24 stocked faces, 2 packing stations, 1 dock and 2 chargers.

### 4.3 Routing modes
- **astar:** a Manhattan A\* over cells that can be driven on, ignoring other robots (they're handled by collision resolution).
- **q_only:** a greedy argmax over the destination's Q-table. Equal values are tied-broken by action order.
  - It **falls back** to A\* for the rest of the leg if:
    - the destination has no table, or
    - the robot revisits the same cell 3 times on one leg, or
    - the chosen action hits a wall or rack.
  - Each fallback is counted.
- **hybrid:** uses the Q action when the best value beats the second-best by at least `hybrid_margin` (default 0.5) and the Q action is valid. Otherwise it uses A\*. Neither choice is counted as a fallback. A separate counter records the share of steps that used Q.

### 4.4 Training (`q_learning.py`)
- For each selected destination, run `episodes_per_destination` episodes.
- Each episode starts at a random aisle cell that can be driven on (not the destination) and ends at the destination or after `max_steps` steps.
- The action is chosen Îµ-greedily. Taking it gives a step reward of âˆ’1, or the goal reward of 10 for reaching the destination. Bumping into a wall or rack keeps the robot in place and costs âˆ’1.
- The update rule is the notebook's exactly:
  - `target = r` if finished, else `r + Î³Â·max Q(s')`
  - `Q += Î±(target âˆ’ Q)`
- Training uses NumPy arrays and a seeded RNG, and reports progress after each destination.
- **Online learning:** when it's on in a session, each Q-routed step also applies the update to the live model copy. Steps routed by A\* don't. At the end of the session the user can save the copy as a new model version.

### 4.5 Metrics
- **Recorded every `metrics_every` ticks:**
  - `delivered`, `failed`, `queued`, `in_progress`
  - `throughput_per_100` over a rolling window
  - `avg_cycle_time`
  - `wait_events`, `fallbacks`, `q_step_share`
  - `avg_battery`, `charging_count`, `idle_count`
- **Final summary:** totals plus:
  - p50 and p95 cycle time
  - steps per delivery
  - average extra steps per leg compared with A\*
  - per-robot utilization (share of ticks spent moving or working)

## 5. Backend architecture

### 5.1 Modules
The existing empty files are filled in, and `init.py` is renamed to `__init__.py`.

| File | Responsibility |
|---|---|
| `simulation/grid.py` | Layout, cell types, driveable check, pick faces, destinations, fingerprint, validation, the default layout and products |
| `simulation/models.py` | Dataclasses: Product, OrderItem, Order, Package, Robot, Task, SessionConfig, Hyperparameters |
| `simulation/astar.py` | `find_path(layout, start, goal, blocked=frozenset())` and `distance()` |
| `simulation/q_learning.py` | QTableSet, `train_destination`, `train_model` (generator that yields progress), `greedy_action`, `q_update`, notebook-compatible import and export |
| `simulation/orders.py` | Seeded OrderGenerator, Inventory (reserve, pick, check stock) |
| `simulation/collisions.py` | `resolve_moves(robots, intents) -> (moves, yielded)` |
| `simulation/metrics.py` | MetricsTracker (snapshots and summary) |
| `simulation/simulator.py` | `Simulator(layout, products, config, qtables, rng)` with `step() -> list[Event]` and `snapshot() -> dict` |
| `app/storage.py` | SQLite (stdlib `sqlite3`) and model JSON files under `backend/data/`, created on startup |
| `app/training.py` | TrainingJobManager: runs `train_model` in a `ThreadPoolExecutor`; job status and progress are kept in memory |
| `app/sessions.py` | SessionManager: one asyncio task per running session, speed control, WebSocket subscribers, writes metrics |
| `app/schemas.py` | Pydantic request and response models |
| `app/api/*.py` | Routers for layouts, models, training, sessions, and compare |
| `app/main.py` | App factory, routers, startup (initialize the database, add the default layout, mark leftover `running` sessions as `interrupted`) |

`backend/data/` is added to `.gitignore`.

### 5.2 Session speed
- At 1Ã— the session advances 1 tick every 600 ms, matching the current UI.
- The speeds are 1Ã—, 2Ã—, 5Ã—, 10Ã—, and **max**. Max runs as fast as possible and yields to the event loop every 50 ticks.
- WebSocket frames are capped at 20 per second. At high speeds intermediate ticks are skipped, but event logs are batched so nothing is lost.

### 5.3 API (all under `/api`)
| Method & path | Purpose |
|---|---|
| `GET /health` | Already exists |
| `GET /layouts`, `GET /layouts/{id}`, `POST /layouts`, `PUT /layouts/{id}` | Layout CRUD. The default layout can't be edited; "Save as" makes a copy |
| `GET /models`, `POST /models`, `GET /models/{id}`, `DELETE /models/{id}` | Model CRUD. `POST` creates an untrained model |
| `POST /models/{id}/train` | Body: hyperparameter overrides and destinations. Returns `job_id` |
| `GET /training/{job_id}` | Status, current destination, progress fraction, curve so far |
| `GET /models/{id}/qtable?dest=x,y` | One destination's table, for the heatmap |
| `GET /models/{id}/export`, `POST /models/import` | Download or upload JSON |
| `POST /sessions` | Create a session (starts paused) |
| `GET /sessions`, `GET /sessions/{id}` | List with summaries; detail with config, metric series, and orders |
| `POST /sessions/{id}/control` | `{action: play\|pause\|step\|stop, speed?}` |
| `POST /sessions/{id}/orders` | Inject an order (random, or with given items) |
| `POST /sessions/{id}/save-model` | When online learning is on: save as a new model version |
| `WS /sessions/{id}/stream` | Server sends a `snapshot` once and then `frame` messages: tick, robots, active orders, stations, stock, stats, events. The client may send `control` messages |
| `POST /compare` | `{layout_id, runs: [{model_id?, routing_mode}], robot_count, orders, ticks}`. Runs each configuration headless with the same seed and returns the summaries, plus series for the chart. Max 6 runs and 5,000 ticks per run |

### 5.4 Error handling
- Pydantic validation errors return 422.
- An unknown ID returns 404.
- An invalid layout returns 400 with the unreachable cells.
- A control action that isn't valid in the current state (for example `play` on a finished session) returns 409.
- A training job that fails is marked `failed` with its error message, and the model is left unchanged. Trained tables are written in one step: to a temporary file, then renamed into place.
- If a session's loop throws an error, the session is marked `interrupted`, the error is sent to WebSocket subscribers, and it is logged.
- The frontend shows errors as toasts instead of `alert()`.

## 6. Frontend

The existing visual design and components are kept and wired to the backend. `simulationEngine.js` and `verify_simulation.mjs` are retired: their checks are ported to pytest (section 7) and the files are removed.

**New services**
- `services/api.js`: a fetch wrapper with JSON error handling.
- `services/sessionStream.js`: a WebSocket client that reconnects with backoff. It applies `snapshot` and `frame` messages to a session-state reducer.

**App shell.** A slim left navigation with four views. The keyboard shortcuts are kept on the Session view.

1. **Models**
   - Shows a list of models (name, layout, version, trained destinations, last trained).
   - **New model** creates one with a name, layout and hyperparameters, reusing the inspector's sliders.
   - **Train** shows a progress bar for each destination and a learning curve (reward per episode). The curve is an inline SVG chart; no chart library is added.
   - Also has export and import.
   - A heatmap preview of a selected destination reuses the map's Q-heatmap and arrow layer.
2. **Session**: the existing full-screen map experience.
   - **New session** dialog: layout, model, routing mode, robot count, order rate, size mix, rush %, seed, stop condition, online learning.
   - The map adds:
     - shelf labels with stock bars
     - packing station queue and progress rings
     - icons showing what each robot carries (items or a package)
     - dock delivery pulses
     - each robot's current target
   - `TopMapHud` shows the session name, state, tick, and mode. The routing mode is fixed once a session starts.
   - `PlaybackDock` controls the session: play, pause, step, stop, and speeds including Max. Fast Train is removed here; training now lives in Models.
   - `OrderDemandDrawer` shows real orders with their items and lifecycle state, plus key stats and an Inject order button. The auto-demand toggle is replaced by the session's arrival settings.
   - `AgentBrainInspector` shows the selected robot's status, task, carrying, battery, and the Q compass for its current target. Its hyperparameter sliders move to Models.
   - When online learning is on, a **Save learned model** button appears.
3. **Layouts**
   - `MapPaintToolbar` paints rack, packing, dock, charger and aisle cells. Pick faces are shown automatically.
   - Products are assigned to faces automatically, with an optional override.
   - Has Save and Save-as, plus validation feedback.
4. **History & Compare**
   - A table of past sessions with their summaries. Clicking one opens its metric charts.
   - A **Compare** form chooses a layout, workload, and 2â€“6 model and mode runs. It shows grouped bars (throughput, p95 cycle time, fallbacks, waits) and throughput-over-time lines.

**Fixes included:** clearing the 25 lint errors, removing leftover Vite template assets, and adding `ws: true` to the Vite proxy for `/api`.

## 7. Testing

**Backend (pytest)**
- **`test_grid.py`**
  - pick-face derivation
  - fingerprint stability
  - reachability validation that rejects a sealed-off cell
  - the default layout matches today's coordinates
- **`test_astar.py`** (renamed from `test-astar.py`)
  - shortest-path length on the default layout
  - no path into a rack
  - an unreachable goal returns `None`
  - avoiding `blocked` cells
- **`test_q_learning.py`**
  - **notebook parity:** the 1D 5-cell environment with the notebook's numbers gives the same updates
  - after training, following the greedy policy from every aisle cell reaches each destination within (A\* length + 2) steps
  - the Q-value next to the goal converges to a positive value (ported from the JS Test 8)
  - export and import round-trip exactly, including the old single-goal format (ported from the JS Test 9)
- **`test_collisions.py`**
  - a property test over 1,000 seeded random ticks with 8 robots: no two robots in one cell, no swaps
  - the priority order is respected
  - deadlock re-planning kicks in after 3 waits
- **`test_orders.py`**
  - a single order goes through every state in order
  - stock decrements
  - shortages fail the order
  - rush orders are dispatched first
  - seeded generation is reproducible
- **`test_simulator.py`**
  - same seed and config give an identical summary (determinism)
  - battery: below 20% the robot goes to a charger and resumes afterward (ported from the JS Test 7)
  - packing holds one robot at a time for 3 ticks
  - the stop conditions work
- **`test_metrics.py`:** cycle-time percentiles and throughput window math.
- **`test_api.py`** (FastAPI `TestClient`, temporary data directory)
  - layout CRUD and validation errors
  - create, train, and read a model
  - the session lifecycle with `step` controls
  - the WebSocket stream sends a snapshot and then frames
  - 409 on invalid control actions
  - compare returns one summary per run
- **Acceptance test (`test_acceptance.py`, marked `slow`):** on the default layout, seed 42, 4 robots, 2,000 ticks, a saturating arrival rate of 20 orders per 100 ticks:
  - a trained model in Q-only mode delivers at least 2Ã— the orders of an untrained Q-only model
  - its fallbacks are under 10% of legs
  - its throughput is within 15% of Pure A\*

**Frontend**
- `npm run lint` and `npm run build` must pass.
- The reducer in `sessionStream.js` is a pure function and gets a few Vitest unit tests (adds `vitest` as a dev dependency).

**End to end:** a manual smoke run driven in a real browser.
1. Create a model and train it.
2. Start a session at 10Ã— and watch orders get delivered.
3. Inject a rush order.
4. Pause, resume, then stop.
5. Run a comparison of untrained vs trained vs A\*.

## 8. Running locally
- **Backend:**
  ```
  cd backend
  python -m venv .venv
  .venv\Scripts\activate
  pip install -r requirements.txt
  uvicorn app.main:app --reload --port 8080
  ```
- **Frontend:**
  ```
  cd frontend
  npm install
  npm run dev
  ```
  Then open http://localhost:5173.
- **Both at once:**
  - `dev.ps1` at the repo root starts both in separate windows.
  - Or use `docker compose up`, which replaces the placeholder Alpine `app` service with a `backend` service (Python image, port 8080, `backend/` mounted).
- The local Python is 3.14. If any pinned version in `requirements.txt` doesn't install on it, it's updated to the nearest compatible release. Only that pin changes; nothing else is upgraded.
- The root `README.md` gets updated: what the project is, how to run it, and the training, session and compare workflow.

## 9. Build order (for the implementation plan)
1. Backend core: grid, models, A\*, Q-learning, orders, collisions, metrics, and simulator, test-first.
2. Storage, training jobs, the session manager, and the API with its tests.
3. The frontend API and stream services, the app shell, and the Session view connected to live sessions.
4. The Models view with training progress, curves, and heatmaps.
5. The Layouts view.
6. History & Compare.
7. Cleanup (lint, assets, retiring the JS engine), docs, Docker, `dev.ps1`, the acceptance test, and the end-to-end smoke run.

Each step ends with tests passing and a local commit. Nothing is pushed.
