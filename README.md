# RoboWare

## Description

RoboWare is an AI-powered warehouse simulation where autonomous robot agents work together to pick, pack, and deliver orders efficiently. It combines A* pathfinding, Q-learning, collision avoidance, charging traffic management, and live order demand to study warehouse routing and task assignment.

## Planned Technologies

- Python, SQL, JavaScript
- React, Streamlit, or Gradio
- A* search and Q-learning
- NumPy, pandas, scikit-learn, XGBoost, and Optuna

## Docker Setup

Make sure Docker Desktop is installed and running.

```bash
docker compose up -d
docker compose down
docker compose ps
```

This is a generic starter configuration. The team can add project-specific dependencies and startup commands later.

## Checkpoint: Training Backend (Module 2, in progress)

This checkpoint moves Q-learning training out of the browser and into a Python backend, and adds a **Training Lab** to the UI.

### What works now

- **Python simulation core** (`backend/app/simulation/`): the warehouse grid (same 16x10 layout as the frontend prototype), A* pathfinding, and the notebook's Q-learning update rule.
- **Train from the UI**: open **Training Lab** (top-center button), pick a destination (shipping dock, packing stations or chargers) and hyperparameters (episodes, α, γ, ε, optional ε decay), then click **Train & save model**.
- **Learning curve and evaluation**: every trained model shows its reward-per-episode curve, its episode success rate, the share of floor cells whose greedy policy reaches the goal, and the extra steps it takes compared with A*.
- **Saved models**: models are stored as JSON under `backend/data/models/` and survive restarts. The list supports viewing a model's curve, loading it, and deleting it.
- **Load into the map**: loading a model imports its Q-table into the existing simulation and turns on the Q-heatmap layer, so the learned policy arrows show on the grid.
- **API**: `GET /api/layout`, `POST /api/models` (train and save), `GET /api/models`, `GET /api/models/{id}` and `DELETE /api/models/{id}`. Saved models use the notebook's JSON schema (`q_table`, `goal`, `actions`, rewards, `discount_factor`).

### Not done yet

- Running full automated sessions (robots, orders, packages, packing and charging) on the backend. The robot simulation still runs in the browser prototype.
- One model covering every pick face, so robots can use learned routes for whole multi-stop orders.
- Live streaming of sessions over WebSockets, session history, and run comparisons.

### Run it locally

```powershell
# Backend (port 8080)
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8080

# Frontend (port 5173, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

Run the backend tests with `cd backend; .venv\Scripts\python -m pytest`.
