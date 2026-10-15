"""Plain data objects shared by the simulation modules."""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields

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


@dataclass
class Hyperparameters:
    learning_rate: float = 0.1
    discount_factor: float = 0.95
    exploration_rate: float = 0.3
    epsilon_decay: bool = False
    epsilon_min: float = 0.05
    step_reward: float = -1.0
    goal_reward: float = 10.0
    episodes_per_destination: int = 3000
    max_steps: int = 200

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "Hyperparameters":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})
