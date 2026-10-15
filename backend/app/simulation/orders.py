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
