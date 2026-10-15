"""Plain data objects shared by the simulation modules."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields

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


ORDER_STATUSES = ("queued", "assigned", "picking", "packing", "shipping", "delivered", "failed")


@dataclass
class OrderItem:
    sku: str
    qty: int

    def to_dict(self) -> dict:
        return {"sku": self.sku, "qty": self.qty}


@dataclass
class Order:
    id: str
    items: list[OrderItem]
    priority: str  # "normal" | "rush"
    created_tick: int
    status: str = "queued"
    robot_id: str | None = None
    timeline: dict[str, int] = field(default_factory=dict)
    package_id: str | None = None
    fail_reason: str | None = None

    def __post_init__(self) -> None:
        self.timeline.setdefault("queued", self.created_tick)

    def set_status(self, status: str, tick: int) -> None:
        if status not in ORDER_STATUSES:
            raise ValueError(f"Unknown order status: {status}")
        self.status = status
        self.timeline[status] = tick

    @property
    def is_open(self) -> bool:
        return self.status not in ("delivered", "failed")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "items": [i.to_dict() for i in self.items],
            "priority": self.priority,
            "created_tick": self.created_tick,
            "status": self.status,
            "robot_id": self.robot_id,
            "timeline": dict(self.timeline),
            "package_id": self.package_id,
            "fail_reason": self.fail_reason,
        }


@dataclass
class Package:
    id: str
    order_id: str
    station: Cell
    packed_tick: int
    delivered_tick: int | None = None

    def to_dict(self) -> dict:
        return {"id": self.id, "order_id": self.order_id, "station": list(self.station),
                "packed_tick": self.packed_tick, "delivered_tick": self.delivered_tick}


@dataclass
class OrderSettings:
    rate_per_100: float = 6.0
    size_weights: list[float] = field(default_factory=lambda: [0.5, 0.3, 0.2])
    rush_fraction: float = 0.1
    seed: int = 42

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "OrderSettings":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})
