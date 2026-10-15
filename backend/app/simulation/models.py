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


ROUTING_MODES = ("hybrid", "q_only", "astar")
ROBOT_STATUSES = ("idle", "parking", "to_pick", "picking", "to_pack", "queued_pack", "packing",
                  "to_dock", "to_charger", "charging")
ROBOT_COLORS = ["#FF5A26", "#2563EB", "#10B981", "#9333EA", "#E11D48", "#0891B2", "#CA8A04", "#4B5563"]


@dataclass
class Task:
    order_id: str
    picks: list[tuple[Cell, list[OrderItem]]]  # remaining pick stops: (face, items there)
    station: Cell | None = None
    dock: Cell | None = None


@dataclass
class Robot:
    id: str
    pos: Cell
    color: str
    battery: float = 100.0
    status: str = "idle"
    yielding: bool = False
    task: Task | None = None
    target: Cell | None = None
    carrying: list[OrderItem] = field(default_factory=list)
    package_id: str | None = None
    work_ticks: int = 0
    wait_ticks: int = 0
    charge_after_task: bool = False
    heading: int = 0
    path: list[Cell] = field(default_factory=list)  # cached A* path, starting at pos
    detour: list[Cell] = field(default_factory=list)  # path around blocking robots, starting at pos
    visit_counts: dict[Cell, int] = field(default_factory=dict)
    fallback_leg: bool = False
    leg_steps: int = 0
    leg_optimal: int = 0
    q_step: tuple[int, int] | None = None  # (state, action) chosen by the Q-table this tick


@dataclass
class StopCondition:
    type: str = "ticks"  # "ticks" | "orders" | "manual"
    value: int | None = 2000


@dataclass
class SessionConfig:
    layout_id: str = "default"
    model_id: str | None = None
    routing_mode: str = "hybrid"
    hybrid_margin: float = 0.5
    robot_count: int = 4
    orders: OrderSettings = field(default_factory=OrderSettings)
    stop: StopCondition = field(default_factory=StopCondition)
    online_learning: bool = False
    metrics_every: int = 10
    name: str = ""

    def __post_init__(self) -> None:
        if self.routing_mode not in ROUTING_MODES:
            raise ValueError(f"Unknown routing mode: {self.routing_mode}")

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "SessionConfig":
        known = {f.name for f in fields(cls)}
        values = {k: v for k, v in (data or {}).items() if k in known}
        values["orders"] = OrderSettings.from_dict(values.get("orders"))
        stop = values.get("stop") or {}
        values["stop"] = StopCondition(stop.get("type", "ticks"), stop.get("value", 2000))
        return cls(**values)
