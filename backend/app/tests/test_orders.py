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
