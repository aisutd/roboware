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
    for kind, coords in ((RACK, DEFAULT_RACKS), (PACKING, DEFAULT_PACKING), (DOCK, DEFAULT_DOCKS),
                         (CHARGER, DEFAULT_CHARGERS)):
        for x, y in coords:
            cells[y][x] = kind
    layout = Layout(DEFAULT_WIDTH, DEFAULT_HEIGHT, cells, name="Default warehouse")
    layout.products = assign_products(layout)
    return layout
