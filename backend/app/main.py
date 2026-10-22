"""RoboWare API: warehouse layout, Q-learning training and saved models.

This is the web server the frontend talks to. FastAPI turns each decorated function below into
an HTTP endpoint and checks incoming JSON against the pydantic classes. In development, Vite
forwards every /api/... request from the browser (port 5173) to this server (port 8080).

Endpoints:
    GET    /api/health        is the backend up?
    GET    /api/layout        the warehouse floor (cells, products, destinations)
    POST   /api/models        train a new model and save it
    GET    /api/models        list saved models (summaries only)
    GET    /api/models/{id}   one saved model, including its Q-table
    DELETE /api/models/{id}   delete a saved model

Run it with:  .venv\\Scripts\\python -m uvicorn app.main:app --port 8080
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .model_store import ModelNotFound, ModelStore
from .simulation.grid import default_layout
from .simulation.models import Hyperparameters
from .simulation.q_learning import downsample, evaluate, to_notebook_format, train_destination

# Saved models go in backend/data/ unless the ROBOWARE_DATA environment variable says otherwise.
DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


# --- Request bodies -------------------------------------------------------------------------
# These describe the JSON the frontend may send. Field(...) sets the default and the allowed
# range. If a value is out of range, FastAPI rejects the request with a 422 error explaining
# which field was wrong, before our code ever runs.

class HyperparametersIn(BaseModel):
    learning_rate: float = Field(0.1, gt=0, le=1)       # 0 would mean "never learn"
    discount_factor: float = Field(0.95, ge=0, lt=1)    # must stay below 1 so future rewards shrink
    exploration_rate: float = Field(0.3, ge=0, le=1)    # a probability
    epsilon_decay: bool = False
    epsilon_min: float = Field(0.05, ge=0, le=1)
    step_reward: float = -1.0
    goal_reward: float = 10.0
    episodes: int = Field(3000, ge=1, le=20_000)        # capped so one request can't run for minutes
    max_steps: int = Field(200, ge=1, le=2_000)


class TrainRequest(BaseModel):
    name: str = Field("", max_length=80)          # empty -> we generate a name
    goal: tuple[int, int] = (14, 8)               # (x, y); default is the shipping dock
    hyperparameters: HyperparametersIn = Field(default_factory=HyperparametersIn)
    seed: int = 0                                 # same seed + same settings = same model


def create_app(data_dir: Path | str | None = None) -> FastAPI:
    """Build the app.

    This is a function rather than a module-level app, so tests can point each app at its
    own temporary folder and never touch the real saved models.
    """
    app = FastAPI(title="RoboWare API")
    store = ModelStore(Path(data_dir or os.environ.get("ROBOWARE_DATA", DEFAULT_DATA_DIR)) / "models")
    # One fixed warehouse for now; custom layouts are future work.
    layout = default_layout()

    def get_or_404(model_id: str) -> dict:
        # Turn "no such model" into a proper HTTP 404 instead of a server crash (500).
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
        """Train a Q-table for one destination, evaluate it, save it and return the full model.

        Training runs right here inside the request. Up to 20,000 episodes on this small grid
        takes a few seconds at most, so the browser just waits for the answer.
        """
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
            "evaluation": evaluate(layout, q, goal),  # how good the learned policy is vs. A*
            "history": downsample(history),            # learning curve, trimmed for the chart
            # q_table, goal, actions, rewards, discount: the notebook's model format,
            # so the frontend engine can import the model as-is.
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
        get_or_404(model_id)  # 404 if it doesn't exist
        store.delete(model_id)

    return app


# The app uvicorn serves ("app.main:app"), saving models in the default data folder.
app = create_app()
