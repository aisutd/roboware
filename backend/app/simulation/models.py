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
