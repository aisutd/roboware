"""Warehouse floor layout: cell types, pick faces, destinations and validation.

The warehouse is a rectangle of square cells. Each cell has a type (aisle, rack, packing
station, shipping dock or charger). Robots can drive on every type except racks.
This module describes that floor and answers questions about it, such as "can a robot stand
here?", "which cells are next to this one?" and "where are the places robots need to go?".
"""

from __future__ import annotations

import hashlib
from collections import deque
from dataclasses import dataclass, field

from .models import Cell, Product

# Cell types, stored as plain strings so layouts serialize straight to JSON.
AISLE = "aisle"      # open floor
RACK = "rack"        # shelving; robots can't drive through it
PACKING = "packing"  # where picked items get packed into a package
DOCK = "dock"        # where finished packages are shipped out
CHARGER = "charger"  # where robots recharge their batteries
CELL_TYPES = (AISLE, RACK, PACKING, DOCK, CHARGER)

# The four moves a robot can make. ACTIONS[i] is the name and DELTAS[i] is the (dx, dy) change,
# so action index 0 is "up", which subtracts 1 from y (y grows downward).
# Same action order as the notebook and the original JS engine, so their Q-tables line up.
ACTIONS = ("up", "down", "left", "right")
DELTAS = ((0, -1), (0, 1), (-1, 0), (1, 0))

# The default warehouse, the same 16x10 floor the frontend prototype draws.
DEFAULT_WIDTH = 16
DEFAULT_HEIGHT = 10
# Three rack blocks, each two columns wide (x = 4-5, 7-8, 10-11). Every block has a top half
# (y = 1-3) and a bottom half (y = 5-7), leaving a cross-aisle at y = 4.
DEFAULT_RACKS = [(x, y) for x0 in (4, 7, 10) for x in (x0, x0 + 1) for y in (1, 2, 3, 5, 6, 7)]
DEFAULT_PACKING = [(14, 2), (14, 5)]
DEFAULT_DOCKS = [(14, 8)]
DEFAULT_CHARGERS = [(0, 2), (0, 7)]

# Names for the demo products, handed out in order by assign_products().
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
    """A warehouse floor plan plus the products stored on it."""

    width: int
    height: int
    cells: list[list[str]]  # cells[y][x]: row first, then column (like reading a page)
    products: list[Product] = field(default_factory=list)
    name: str = "Untitled layout"

    def in_bounds(self, c: Cell) -> bool:
        """Is the cell inside the warehouse walls?"""
        return 0 <= c[0] < self.width and 0 <= c[1] < self.height

    def cell_type(self, c: Cell) -> str:
        # Note the [y][x] order: the outer list is rows.
        return self.cells[c[1]][c[0]]

    def driveable(self, c: Cell) -> bool:
        """Can a robot stand on this cell? Anything inside the walls that isn't a rack."""
        return self.in_bounds(c) and self.cell_type(c) != RACK

    def neighbors(self, c: Cell) -> list[Cell]:
        """The driveable cells one up/down/left/right move away (no diagonals)."""
        return [(c[0] + dx, c[1] + dy) for dx, dy in DELTAS if self.driveable((c[0] + dx, c[1] + dy))]

    def cells_of(self, kind: str) -> list[Cell]:
        """Every cell of one type, scanned row by row from the top-left."""
        return [(x, y) for y in range(self.height) for x in range(self.width) if self.cells[y][x] == kind]

    def pick_faces(self) -> list[Cell]:
        """Aisle cells that touch at least one rack: the spots where a robot can pick an item."""
        faces = []
        for x, y in self.cells_of(AISLE):
            for dx, dy in DELTAS:
                n = (x + dx, y + dy)
                if self.in_bounds(n) and self.cell_type(n) == RACK:
                    faces.append((x, y))
                    break  # one adjacent rack is enough; don't add the same cell twice
        return faces

    def destinations(self) -> list[Cell]:
        """Every place a robot might be sent: stocked pick faces, packing stations, docks and chargers.

        These are the goals a Q-learning model can be trained for.
        """
        stocked = {p.face for p in self.products}
        dests = [c for c in self.pick_faces() if c in stocked]
        return dests + self.cells_of(PACKING) + self.cells_of(DOCK) + self.cells_of(CHARGER)

    def fingerprint(self) -> str:
        """A short ID that changes whenever the floor plan changes.

        A Q-table only makes sense on the floor it was trained on, so this lets us detect a
        model being used on a different layout.
        """
        rows = ";".join(",".join(row) for row in self.cells)
        return hashlib.sha256(f"{self.width}x{self.height}:{rows}".encode()).hexdigest()

    def reachable_from(self, start: Cell) -> set[Cell]:
        """All cells a robot could drive to from `start` (a flood fill / breadth-first search)."""
        seen = {start}
        queue = deque([start])
        while queue:
            for n in self.neighbors(queue.popleft()):
                if n not in seen:
                    seen.add(n)
                    queue.append(n)
        return seen

    def validate(self) -> None:
        """Raise LayoutError if robots couldn't actually work on this floor."""
        # The warehouse needs at least one of each work area.
        for kind, label in ((PACKING, "packing station"), (DOCK, "shipping dock"), (CHARGER, "charger")):
            if not self.cells_of(kind):
                raise LayoutError(f"Layout needs at least one {label}.")
        # Every product has to sit on a real pick face, or no robot could ever pick it.
        faces = set(self.pick_faces())
        misplaced = [p.sku for p in self.products if p.face not in faces]
        if misplaced:
            raise LayoutError(f"Products are not on a pick face: {', '.join(misplaced)}")
        # Every destination must be reachable from a charger (where robots start out).
        # Racks placed badly could wall off part of the floor.
        reach = self.reachable_from(self.cells_of(CHARGER)[0])
        unreachable = [c for c in self.destinations() if c not in reach]
        if unreachable:
            raise LayoutError("Some destinations cannot be reached from the chargers.", unreachable)

    def to_dict(self) -> dict:
        """JSON form sent to the frontend. Includes derived info so the UI doesn't recompute it."""
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
        """Build a Layout from JSON, checking the grid's shape and cell types first."""
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
    # Can't place more products than there are faces or names.
    count = min(count, len(faces), len(PRODUCT_NAMES))
    return [
        Product(
            sku=f"SKU-{i + 1:03d}",  # SKU-001, SKU-002, ...
            name=PRODUCT_NAMES[i],
            # Step through the face list in even jumps so products are spread over the whole floor
            # instead of all bunched at the first faces.
            face=faces[(i * len(faces)) // count],
            stock=20 + (i * 7) % 21,  # a deterministic mix of stock levels between 20 and 40
        )
        for i in range(count)
    ]


def default_layout() -> Layout:
    """The standard demo warehouse: start with all aisles, then place racks, stations, dock and chargers."""
    cells = [[AISLE] * DEFAULT_WIDTH for _ in range(DEFAULT_HEIGHT)]
    for kind, coords in ((RACK, DEFAULT_RACKS), (PACKING, DEFAULT_PACKING), (DOCK, DEFAULT_DOCKS),
                         (CHARGER, DEFAULT_CHARGERS)):
        for x, y in coords:
            cells[y][x] = kind
    layout = Layout(DEFAULT_WIDTH, DEFAULT_HEIGHT, cells, name="Default warehouse")
    layout.products = assign_products(layout)
    return layout
