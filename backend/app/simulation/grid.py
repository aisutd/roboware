"""Warehouse floor layout: cell types, pick faces, destinations and validation."""

from __future__ import annotations

import hashlib
from collections import deque
from dataclasses import dataclass, field

from .models import Cell, Product

AISLE = "aisle"
RACK = "rack"
PACKING = "packing"
DOCK = "dock"  # dock station: a single drop-off square, anywhere on the floor
SHIPPING = "shipping"  # drop-off zone: like a dock, but a zone on the outside edge that parcels leave through
CHARGER = "charger"
UNLOAD = "unload"  # receiving bay: trucks drop pallets here; must touch the outside of the warehouse
VOID = "void"  # no floor here: lets a warehouse take any shape inside its bounding grid
CELL_TYPES = (AISLE, RACK, PACKING, DOCK, SHIPPING, CHARGER, UNLOAD, VOID)
BLOCKED = (RACK, VOID)

# Same action order as the notebook and the original JS engine.
ACTIONS = ("up", "down", "left", "right")
DELTAS = ((0, -1), (0, 1), (-1, 0), (1, 0))

DEFAULT_WIDTH = 16
DEFAULT_HEIGHT = 10
DEFAULT_RACKS = [(x, y) for x0 in (4, 7, 10) for x in (x0, x0 + 1) for y in (1, 2, 3, 5, 6, 7)]
DEFAULT_PACKING = [(14, 2), (14, 5)]
DEFAULT_SHIPPING = [(x, y) for x in (14, 15) for y in (8, 9)]  # a 2x2 drop-off zone in the bottom-right corner
DEFAULT_CHARGERS = [(0, 2), (0, 7)]
DEFAULT_UNLOAD = [(x, y) for x in range(3) for y in range(2)]  # a 3x2 receiving bay on the top edge

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
        return self.in_bounds(c) and self.cell_type(c) not in BLOCKED

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
        return (dests + self.cells_of(PACKING) + self.cells_of(DOCK) + self.cells_of(SHIPPING) + self.cells_of(CHARGER)
                + self.cells_of(UNLOAD))

    def drop_offs(self) -> list[Cell]:
        """Where robots deliver packed orders: dock stations and drop-off zone squares."""
        return self.cells_of(DOCK) + self.cells_of(SHIPPING)

    def _exterior_void(self) -> set[Cell]:
        """Empty floor connected to the grid border: the outside of a shaped warehouse."""
        border = [(x, y) for y in range(self.height) for x in range(self.width)
                  if self.cells[y][x] == VOID and (x in (0, self.width - 1) or y in (0, self.height - 1))]
        seen = set(border)
        queue = deque(border)
        while queue:
            x, y = queue.popleft()
            for dx, dy in DELTAS:
                n = (x + dx, y + dy)
                if self.in_bounds(n) and n not in seen and self.cell_type(n) == VOID:
                    seen.add(n)
                    queue.append(n)
        return seen

    def bays(self) -> list[dict]:
        """Receiving bays: groups of touching unload cells. `side` is where trucks dock (the outside the bay
        touches most; None when it touches no outside at all) and `mouth` lists the bay cells along that side."""
        return self.zones(UNLOAD)

    def shipping_zones(self) -> list[dict]:
        """Drop-off zones: groups of touching shipping cells, opening to the outside on `side`, like the bays."""
        return self.zones(SHIPPING)

    def zones(self, kind: str) -> list[dict]:
        outside = self._exterior_void()

        def out(c: Cell) -> bool:
            return not self.in_bounds(c) or c in outside

        result, seen = [], set()
        for start in self.cells_of(kind):
            if start in seen:
                continue
            group, queue = [], deque([start])
            seen.add(start)
            while queue:
                c = queue.popleft()
                group.append(c)
                for dx, dy in DELTAS:
                    n = (c[0] + dx, c[1] + dy)
                    if self.in_bounds(n) and n not in seen and self.cell_type(n) == kind:
                        seen.add(n)
                        queue.append(n)
            group.sort(key=lambda c: (c[1], c[0]))
            sides = {name: [c for c in group if out((c[0] + dx, c[1] + dy))] for name, (dx, dy) in zip(ACTIONS, DELTAS)}
            side = max(ACTIONS, key=lambda name: len(sides[name]))
            result.append({"cells": group, "side": side if sides[side] else None, "mouth": sides[side]})
        return result

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
        for kind, label in ((PACKING, "packing station"), (CHARGER, "charger")):
            if not self.cells_of(kind):
                raise LayoutError(f"Layout needs at least one {label}.")
        if not self.drop_offs():
            raise LayoutError("Layout needs at least one shipping dock or drop-off zone.")
        faces = set(self.pick_faces())
        misplaced = [p.sku for p in self.products if p.face not in faces]
        if misplaced:
            raise LayoutError(f"Products are not on a pick face: {', '.join(misplaced)}")
        if not self.cells_of(UNLOAD):
            raise LayoutError("Layout needs at least one unload bay for delivery trucks.")
        stranded = [c for bay in self.bays() if bay["side"] is None for c in bay["cells"]]
        if stranded:
            raise LayoutError("Unload bays must touch the outside edge of the warehouse so trucks can reach them.",
                              stranded)
        stranded = [c for zone in self.shipping_zones() if zone["side"] is None for c in zone["cells"]]
        if stranded:
            raise LayoutError("Drop-off zones must touch the outside edge of the warehouse so parcels can leave.",
                              stranded)
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
            "bays": [{"cells": [list(c) for c in b["cells"]], "side": b["side"], "mouth": [list(c) for c in b["mouth"]]}
                     for b in self.bays()],
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
    products = []
    for i in range(count):
        capacity = 8 + (i * 5) % 9  # small shelves, so delivery trucks have work to do
        # Every third shelf starts half empty, so the first truck shows up early in a run.
        stock = capacity if i % 3 else max(2, capacity // 2 - 1)
        products.append(Product(f"SKU-{i + 1:03d}", PRODUCT_NAMES[i], faces[(i * len(faces)) // count], stock, capacity))
    return products


def default_layout() -> Layout:
    cells = [[AISLE] * DEFAULT_WIDTH for _ in range(DEFAULT_HEIGHT)]
    for kind, coords in ((RACK, DEFAULT_RACKS), (PACKING, DEFAULT_PACKING), (SHIPPING, DEFAULT_SHIPPING),
                         (CHARGER, DEFAULT_CHARGERS), (UNLOAD, DEFAULT_UNLOAD)):
        for x, y in coords:
            cells[y][x] = kind
    layout = Layout(DEFAULT_WIDTH, DEFAULT_HEIGHT, cells, name="Default warehouse")
    layout.products = assign_products(layout)
    return layout
