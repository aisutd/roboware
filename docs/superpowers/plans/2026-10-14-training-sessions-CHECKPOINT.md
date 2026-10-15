# Checkpoint: Training & Sessions Plan (work in progress)

**Saved:** 2026-10-14. Paused at the user's request partway through writing the implementation plan.
**Branch:** `feature/training-sessions` (local only, **never push**)
**Spec (approved):** `docs/superpowers/specs/2026-10-14-training-sessions-design.md`

## Where things stand

- [x] The spec is written, approved, and calibrated (commits `0997607`, `4f1b8ac`).
- [x] Calibration spike: 300 episodes per destination reaches the goal from about 55% of cells; 3000 reaches it from 98–100%. Training takes about 0.1 s per destination.
- [ ] Implementation plan: the header is drafted (below). The tasks still need writing out with full code.
- [ ] The user picks an execution method (subagent-driven or native).
- [ ] Implementation: nothing built yet.

**To resume:** finish writing the plan from the task list and the decisions below, save it as `2026-10-14-training-sessions.md`, and ask the user to review it and choose an execution method.

## Task list (planned order)

1. `grid.py` plus `Product` in `models.py`: the default layout, pick faces, destinations (29), fingerprint, and validation. Also set up `pytest.ini` (`pythonpath = .`, `slow` marker, `addopts = -m "not slow"`), rename `init.py` to `__init__.py`, and rename `test-astar.py` to `test_astar.py`.
2. `astar.py`: `find_path(layout, start, goal, blocked)`, `distance_map(layout, target)` (BFS), `manhattan`.
3. `q_learning.py` plus `Hyperparameters`: `QTableSet`, `train_destination` (Python lists with a precomputed transition table, for speed), `train_model(..., on_progress)`, `downsample` (at most 300 points), `export_model` / `import_model` (both v2 and the legacy `q_table` format), `greedy_action`, `q_update`.
4. `orders.py` plus `OrderItem`, `Order`, `Package`, `OrderSettings`: `Inventory` (reserve, release, pick) and `OrderGenerator` (Bernoulli arrivals with p = rate/100, seeded).
5. `collisions.py`: `resolve_moves(positions, intents, priority)`. Robots claim cells in priority order. A robot can't enter a cell claimed by someone else or occupied by a stationary robot, and both robots in a head-on swap wait. Then a fixpoint pass cancels any move into the cell of a robot that stays.
6. `metrics.py`: `MetricsTracker` (live stats, summary, nearest-rank percentiles, rolling 100-tick throughput).
7. `simulator.py` plus `Robot`, `Task`, `SessionConfig`, `StopCondition`: the deterministic `step()` and `snapshot()`.
8. `storage.py`: SQLite tables `layouts`, `models`, `sessions`, `session_metrics`, `orders`. Model JSON files are written atomically (to a temp file, then renamed).
9. `errors.py`, `repository.py`, `services.py`, `schemas.py`, `training.py`, and the routers for layouts, models and training, with app-factory exception handlers.
10. `sessions.py` (`SessionManager`, `LiveSession`), the sessions REST API, the WebSocket (accept, then close 4404 for unknown sessions), and `/compare` (a sync endpoint so it runs in the threadpool).
11. Frontend foundation:
    - `api.js`, `sessionStream.js` (reducer and reconnecting client), and Vitest
    - Toast, with the provider and the hook in separate files to satisfy react-refresh lint
    - `NavRail` and the app shell
    - the Vite proxy with `ws: true`, and the target taken from the `VITE_API_TARGET` env var
    - Node globals for `vite.config.js` in the eslint config
12. Session view:
    - rewire the map, HUD, playback dock, orders drawer and inspector
    - `NewSessionDialog` and `useSessionStream`
    - delete `simulationEngine.js`, `verify_simulation.mjs`, `App.css` and the unused assets (keep `favicon.svg`)
    - lint must pass
13. Models view: create, train (poll the job every 400 ms), `LineChart` (SVG), averaged curves (`lib/curves.js` with tests), a destination heatmap, and import/export/delete.
14. Layouts view: paint rack, packing, dock, charger and aisle cells; Save / Save as; products auto-assigned; unreachable cells highlighted.
15. History & Compare: the sessions table, a detail view with charts, and the compare form with bar and line charts.
16. Finish:
    - the slow acceptance test
    - Docker: a `backend` service on `python:3.13-slim`, and the frontend's `VITE_API_TARGET=http://backend:8080`
    - `dev.ps1`
    - add `backend/data/` to `.gitignore`
    - update the README
    - an API and WebSocket smoke script, then open the browser for the user's visual check

## Simulator decisions worked out (not yet written into the plan)

- **Spawn:** robots start on plain aisle cells (not destinations), found by BFS from the chargers. IDs are R1..Rn, with 8 colors.
- **Statuses and transitions** (the `_go(robot, status, target)` helper starts a new leg):
  - `idle` / `parking` → dispatch → `to_pick`.
  - At the pick face → `picking` (1 tick) → the next pick, or `to_pack`. The station is chosen by (queue length, distance).
  - Arriving at the station → `packing` (3 ticks, station `occupant` set). When it finishes it creates a `Package` and the order becomes `shipping`.
  - `to_dock` → delivered → `idle`, or straight to the charger if `charge_after_task` is set.
  - An `idle` robot standing on a non-aisle cell or a destination cell → `parking`, to the nearest plain aisle cell that's free.
  - A robot next to an occupied station or charger waits without moving (`queued_pack` when the target is a station) and doesn't count as waiting.
- **Battery:**
  - An `idle` robot below 35% goes to charge.
  - Below 20%: if it's carrying something, `charge_after_task = True`. If it has a task but has picked nothing yet, release the reservations, requeue the order, and send the robot to charge.
  - The charger is chosen by (current load, distance).
- **Dispatch:** queued orders are sorted rush first, then by created tick, then by ID. An order fails as `out_of_stock` when stock can't cover it. Otherwise it goes to the nearest free robot (by BFS distance to the nearest face) with battery above 35%. Its pick stops are ordered by nearest neighbor.
- **Routing:**
  - **A\*:** a cached path.
  - **Q-only:** greedy argmax. It falls back to A\* for the rest of the leg (counted as a fallback) when there's no table, the action hits a wall, or the robot would enter the same cell a third time on the leg (`REVISIT_LIMIT = 2`).
  - **Hybrid:** uses the Q action when it's valid and its value beats the second-best by at least the margin; otherwise A\*.
  - Legs to cells that aren't destinations (parking) always use A\* and are not counted.
- **Waits:** after more than 3, re-plan with A\* treating the other robots as obstacles (the target itself is allowed). If there's no path, sidestep to a free neighbor; this breaks deadlocks in 1-wide aisles.
- **Online learning:** after a move driven by a Q action, apply `q_update` to the session's copy of the tables.
- **Frame contents:**
  - tick, finished, routing_mode
  - robots, each with x, y, battery, status, yielding, heading, target, order_id, carrying, package_id, path preview (A\* path or a greedy rollout of up to 30 steps), q_scores, fallback_leg
  - open orders plus the last 20 finished
  - stations, stock, stats, events
- **Acceptance test** (slow): default layout, seed 42, 4 robots, 2000 ticks, 20 orders per 100 ticks.
  - The fully trained model's fallback share is under 10%.
  - The undertrained model's (300 episodes) is at least 30%.
  - Trained Q-only throughput is at least 0.85× A\*.
  - If the undertrained contrast doesn't hold, lower its episode count and record that in the spec.

## Plan header drafted so far

See `scratchpad/plan/01-header.md` from the session. Its content is reproduced here so it isn't lost:

- **Global Constraints:** never push; the commit trailer; the grid, action and hyperparameter defaults; the battery and timing constants; speeds; compare limits; `backend/data/`; ports 8080 and 5173; no new runtime dependencies (only `vitest` for dev).
- **Review Focus:**
  1. a head-on deadlock in a 1-wide aisle
  2. low battery before the first pick requeues the order
  3. an untrained or other-layout model warns but runs
  4. a WebSocket for a session that isn't live closes with 4404
  5. importing a malformed model returns 400
