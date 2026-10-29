import numpy as np
import pytest

from app.simulation.grid import AISLE, VOID, Layout, assign_products, default_layout
from app.simulation.models import Hyperparameters, OrderSettings, SessionConfig, StopCondition
from app.simulation.q_learning import QTableSet, train_model
from app.simulation.simulator import Simulator


def make(robots=4, mode="astar", rate=0.0, ticks=2000, layout=None, qtables=None, stop=None, trucks=True, **kw):
    cfg = SessionConfig(routing_mode=mode, robot_count=robots, orders=OrderSettings(rate_per_100=rate, seed=42),
                        stop=stop or StopCondition("ticks", ticks), **kw)
    sim = Simulator(layout or default_layout(), cfg, qtables)
    if not trucks:  # movement tests: keep idle robots from being sent off to restock
        sim.receiving.bays = []
    return sim


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


def test_out_of_stock_order_waits_for_a_truck_then_ships():
    layout = default_layout()
    layout.products[0].stock = 0
    sim = make(robots=2, layout=layout)
    order = sim.inject_order([{"sku": "SKU-001", "qty": 1}])
    seen = [e["type"] for e in sim.step()]
    assert order.status == "queued" and order.waiting_stock
    assert run_until(sim, lambda: order.status == "delivered", 400, on_step=lambda s, ev: seen.extend(e["type"] for e in ev))
    for kind in ("truck_called", "truck_arriving", "truck_docked", "pallet_dropped", "pallet_loaded", "restocked"):
        assert kind in seen
    assert seen.index("truck_called") < seen.index("truck_docked") < seen.index("pallet_dropped") < seen.index("restocked")
    assert not order.waiting_stock and sim.metrics.failed == 0


def test_out_of_stock_order_fails_without_an_unload_bay():
    layout = default_layout()
    layout.products[0].stock = 0
    sim = make(robots=1, layout=layout, trucks=False)
    order = sim.inject_order([{"sku": "SKU-001", "qty": 1}])
    sim.step()
    assert order.status == "failed" and order.fail_reason == "out_of_stock"
    assert sim.metrics.failed == 1


def test_trucks_keep_the_shelves_stocked_within_capacity():
    sim = make(robots=4, rate=8.0, ticks=1500)
    caps = {p.sku: p.capacity for p in sim.layout.products}
    bay = set(sim.layout.cells_of("unload"))

    def check(s, _events):
        assert all(0 <= s.inventory.stock[k] <= caps[k] for k in caps)
        assert all(p.cell in bay for p in s.receiving.pallets.values())
        assert len(s.receiving.pallets) <= len(bay)
        assert len({p.cell for p in s.receiving.pallets.values()}) == len(s.receiving.pallets)
        assert sum(t.state != "en_route" for t in s.trucks_on_bay(0)) <= 1

    sim.trucks_on_bay = lambda b: [t for t in sim.receiving.trucks if t.bay == b]
    run_until(sim, lambda: sim.finished, 1600, on_step=check)
    assert sim.receiving.restocked > 50 and sim.receiving.deliveries >= 3
    assert sim.metrics.failed == 0 and sim.metrics.delivered > 60


def test_restocking_robot_carries_the_pallet_to_its_shelf():
    sim = make(robots=1)
    robot = sim.robots[0]
    statuses = []
    run_until(sim, lambda: sim.receiving.restocked > 0, 400, on_step=lambda s, ev: statuses.append(robot.status))
    order = [s for i, s in enumerate(statuses) if i == 0 or statuses[i - 1] != s]
    assert ["to_unload", "loading", "to_shelf", "restocking"] == [s for s in order if s in ("to_unload", "loading", "to_shelf", "restocking")][:4]


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
    sim = make(robots=2, trucks=False)
    r1, r2 = sim.robots
    r1.pos, r2.pos = (6, 1), (6, 3)
    sim._go(r1, "parking", (6, 4))
    sim._go(r2, "parking", (6, 0))
    assert run_until(sim, lambda: r1.pos == (6, 4) and r2.pos == (6, 0), 80)


def test_robot_blocking_a_shared_target_in_a_one_wide_aisle_is_not_deadlocked():
    # Seen in the acceptance run: R1 sits on the face (6,7) and wants out upward, while R2 above it
    # and R3 below it both want (6,7). Nobody may wait forever.
    sim = make(robots=3, trucks=False)
    r1, r2, r3 = sim.robots
    r1.pos, r2.pos, r3.pos = (6, 7), (6, 6), (6, 8)
    sim._go(r1, "parking", (6, 3))
    sim._go(r2, "parking", (6, 7))
    sim._go(r3, "parking", (6, 7))
    assert run_until(sim, lambda: r1.pos == (6, 3), 120)


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
    assert set(snap) == {"tick", "finished", "routing_mode", "robots", "orders", "stations", "stock", "receiving",
                         "stats", "events"}
    assert set(snap["receiving"]) == {"trucks", "pallets", "backlog", "incoming", "restocked", "deliveries"}
    robot = snap["robots"][0]
    assert {"id", "x", "y", "battery", "status", "path", "q_scores", "carrying", "target", "heading"} <= set(robot)
    assert snap["stations"][0].keys() == {"x", "y", "occupant", "remaining"}
    assert snap["stats"]["tick"] == 30


def test_deadlock_patience_follows_collision_priority_not_list_order():
    sim = make(robots=8)
    r1, r8 = sim.robots[0], sim.robots[7]
    r8.package_id = "PKG-X"  # carrying outranks the empty robots
    priority = {r.id: sim._priority(r, i) for i, r in enumerate(sim.robots)}
    # Higher priority holds its ground longer; the lowest-priority robot gives way after MAX_WAIT.
    assert sim._patience(r8, priority) > sim._patience(r1, priority)
    lowest = max(sim.robots, key=lambda r: priority[r.id])
    assert sim._patience(lowest, priority) == 3


def test_robots_never_drive_onto_void_cells():
    cells = [[AISLE] * 8 for _ in range(6)]
    for y in range(3):
        for x in range(4, 8):
            cells[y][x] = VOID  # an L-shaped floor
    cells[4][2] = cells[4][3] = "rack"
    cells[5][0], cells[5][7], cells[3][7], cells[0][0] = "charger", "packing", "dock", "unload"
    layout = Layout(8, 6, cells)
    layout.products = assign_products(layout)
    layout.validate()
    sim = make(robots=3, rate=30.0, layout=layout)
    for _ in range(300):
        sim.step()
        assert all(layout.cell_type(r.pos) != VOID for r in sim.robots)
    assert sim.metrics.delivered > 0
