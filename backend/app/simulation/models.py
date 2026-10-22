"""Plain data objects shared by the simulation modules.

These are "dumb" containers: they hold values and know how to turn themselves into
JSON-friendly dicts (to_dict) and back (from_dict). All the actual logic lives in
grid.py, astar.py and q_learning.py.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields

# A cell on the warehouse floor, written as (x, y).
# x grows to the right (columns), y grows downward (rows), and (0, 0) is the top-left corner.
Cell = tuple[int, int]


@dataclass
class Product:
    """One kind of item stored in the warehouse.

    `face` is the aisle cell a robot has to stand on to pick this product off the rack
    next to it (robots can't drive onto racks, so they pick from the side).
    """

    sku: str      # stock-keeping unit, e.g. "SKU-001"
    name: str     # human-readable name, e.g. "Wireless Mouse"
    face: Cell    # where a robot stands to pick it
    stock: int    # how many units are on the shelf

    def to_dict(self) -> dict:
        # Tuples become lists so the result is valid JSON.
        return {"sku": self.sku, "name": self.name, "face": list(self.face), "stock": self.stock}

    @classmethod
    def from_dict(cls, data: dict) -> "Product":
        # Coerce every field to the right type, because JSON gives us lists instead of tuples
        # and numbers might arrive as strings.
        face = data["face"]
        return cls(str(data["sku"]), str(data["name"]), (int(face[0]), int(face[1])), int(data["stock"]))


@dataclass
class Hyperparameters:
    """The knobs that control Q-learning training. Defaults match base_reference_model.ipynb."""

    learning_rate: float = 0.1     # alpha: how far each update moves a Q-value toward its new estimate
    discount_factor: float = 0.95  # gamma: how much future rewards count compared with immediate ones
    exploration_rate: float = 0.3  # epsilon: chance of taking a random move instead of the best known one
    epsilon_decay: bool = False    # if True, epsilon shrinks linearly from exploration_rate to epsilon_min
    epsilon_min: float = 0.05      # the floor epsilon decays to
    step_reward: float = -1.0      # reward for every move that doesn't reach the goal (pushes toward short paths)
    goal_reward: float = 10.0      # reward for arriving at the goal
    episodes: int = 3000           # how many practice runs to train for
    max_steps: int = 200           # give up on an episode after this many moves

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "Hyperparameters":
        # Ignore unknown keys so older or newer model files still load; missing keys use the defaults.
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})
