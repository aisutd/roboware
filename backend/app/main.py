"""RoboWare API: warehouse layout, Q-learning training and saved models."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .model_store import ModelNotFound, ModelStore
from .simulation.grid import default_layout
from .simulation.models import Hyperparameters
from .simulation.q_learning import downsample, evaluate, to_notebook_format, train_destination

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


class HyperparametersIn(BaseModel):
    learning_rate: float = Field(0.1, gt=0, le=1)
    discount_factor: float = Field(0.95, ge=0, lt=1)
    exploration_rate: float = Field(0.3, ge=0, le=1)
    epsilon_decay: bool = False
    epsilon_min: float = Field(0.05, ge=0, le=1)
    step_reward: float = -1.0
    goal_reward: float = 10.0
    episodes: int = Field(3000, ge=1, le=20_000)
    max_steps: int = Field(200, ge=1, le=2_000)


class TrainRequest(BaseModel):
    name: str = Field("", max_length=80)
    goal: tuple[int, int] = (14, 8)
    hyperparameters: HyperparametersIn = Field(default_factory=HyperparametersIn)
    seed: int = 0


def create_app(data_dir: Path | str | None = None) -> FastAPI:
    app = FastAPI(title="RoboWare API")
    store = ModelStore(Path(data_dir or os.environ.get("ROBOWARE_DATA", DEFAULT_DATA_DIR)) / "models")
    layout = default_layout()

    def get_or_404(model_id: str) -> dict:
        try:
            return store.get(model_id)
        except ModelNotFound:
            raise HTTPException(404, "Model not found.") from None

    @app.get("/api/health")
    def health():
        return {"status": "ok", "message": "RoboWare backend is connected"}

    @app.get("/api/layout")
    def get_layout():
        return layout.to_dict()

    @app.post("/api/models", status_code=201)
    def train(req: TrainRequest):
        goal = tuple(req.goal)
        if goal not in layout.destinations():
            raise HTTPException(400, f"Goal {list(goal)} is not a destination on this layout.")
        hp = Hyperparameters.from_dict(req.hyperparameters.model_dump())
        q, history = train_destination(layout, goal, hp, req.seed)
        return store.save({
            "name": req.name.strip() or f"Goal {goal[0]},{goal[1]} · {hp.episodes} episodes",
            "hyperparameters": hp.to_dict(),
            "seed": req.seed,
            "episodes": hp.episodes,
            "success_rate": round(history["success_rate"], 4),
            "evaluation": evaluate(layout, q, goal),
            "history": downsample(history),
            **to_notebook_format(q, goal, hp),
        })

    @app.get("/api/models")
    def list_models():
        return store.list()

    @app.get("/api/models/{model_id}")
    def get_model(model_id: str):
        return get_or_404(model_id)

    @app.delete("/api/models/{model_id}", status_code=204)
    def delete_model(model_id: str):
        get_or_404(model_id)
        store.delete(model_id)

    return app


app = create_app()
