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
        # Stagger the patience by robot so two blocked robots never back off in the same tick
        # (that livelocks): the lowest-priority robot gives way first, the other holds its ground.
        patience = MAX_WAIT + 2 * (len(self.robots) - 1 - self.robots.index(r))
        if r.wait_ticks > patience:
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
        """After waiting too long: route around the other robots, or sidestep if fully boxed in.

        A target occupied by another robot counts as blocked too, so the waiting robot backs off
        instead of pushing into it forever (that deadlocks one-wide aisles).
        """
        others = {pos for rid, pos in positions.items() if rid != r.id}
        path = find_path(self.layout, r.pos, r.target, frozenset(others))
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
