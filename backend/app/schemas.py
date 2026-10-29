"""Request bodies (pydantic) for the RoboWare API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class HyperparametersIn(BaseModel):
    learning_rate: float = Field(0.1, gt=0, le=1)
    discount_factor: float = Field(0.95, ge=0, lt=1)
    exploration_rate: float = Field(0.3, ge=0, le=1)
    epsilon_decay: bool = False
    epsilon_min: float = Field(0.05, ge=0, le=1)
    step_reward: float = -1.0
    goal_reward: float = 10.0
    episodes_per_destination: int = Field(3000, ge=1, le=50_000)
    max_steps: int = Field(200, ge=1, le=5_000)


class ProductIn(BaseModel):
    sku: str
    name: str
    face: tuple[int, int]
    stock: int = Field(ge=0)
    capacity: int = Field(0, ge=0)  # 0: the shelf holds what it starts with


class LayoutIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    width: int = Field(ge=4, le=40)
    height: int = Field(ge=4, le=40)
    cells: list[list[str]]
    products: list[ProductIn] | None = None  # None: assign products automatically


class ModelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    layout_id: str = "default"
    hyperparameters: HyperparametersIn = Field(default_factory=HyperparametersIn)


class TrainRequest(BaseModel):
    hyperparameters: HyperparametersIn | None = None
    destinations: list[tuple[int, int]] | None = None
    seed: int = 0


class OrderSettingsIn(BaseModel):
    rate_per_100: float = Field(6.0, ge=0, le=100)
    size_weights: list[float] = Field(default_factory=lambda: [0.5, 0.3, 0.2], min_length=1, max_length=3)
    rush_fraction: float = Field(0.1, ge=0, le=1)
    seed: int = 42

    @field_validator("size_weights")
    @classmethod
    def _weights_usable(cls, weights: list[float]) -> list[float]:
        if any(w < 0 for w in weights) or sum(weights) <= 0:
            raise ValueError("order-size weights must be non-negative and add up to more than zero")
        return weights


class StopIn(BaseModel):
    type: Literal["ticks", "orders", "manual"] = "ticks"
    value: int | None = Field(2000, ge=1)


RoutingMode = Literal["hybrid", "q_only", "astar"]
Speed = Literal[1, 2, 5, 10, "max"]


class SessionCreate(BaseModel):
    name: str = Field("", max_length=80)
    layout_id: str = "default"
    model_id: str | None = None
    routing_mode: RoutingMode = "hybrid"
    hybrid_margin: float = Field(0.5, ge=0)
    robot_count: int = Field(4, ge=1, le=8)
    orders: OrderSettingsIn = Field(default_factory=OrderSettingsIn)
    stop: StopIn = Field(default_factory=StopIn)
    online_learning: bool = False
    metrics_every: int = Field(10, ge=1, le=1000)


class ControlIn(BaseModel):
    action: Literal["play", "pause", "step", "stop", "set_speed"]
    speed: Speed | None = None


class OrderItemIn(BaseModel):
    sku: str
    qty: int = Field(1, ge=1, le=10)


class InjectOrderIn(BaseModel):
    items: list[OrderItemIn] | None = Field(None, min_length=1, max_length=3)
    priority: Literal["normal", "rush"] = "normal"


class SaveModelIn(BaseModel):
    name: str | None = Field(None, max_length=80)


class CompareRun(BaseModel):
    model_id: str | None = None
    routing_mode: RoutingMode = "astar"


class CompareRequest(BaseModel):
    layout_id: str = "default"
    runs: list[CompareRun] = Field(min_length=1, max_length=6)
    robot_count: int = Field(4, ge=1, le=8)
    orders: OrderSettingsIn = Field(default_factory=lambda: OrderSettingsIn(rate_per_100=20))
    ticks: int = Field(2000, ge=10, le=5000)
    hybrid_margin: float = Field(0.5, ge=0)
