# RoboWare

RoboWare is a warehouse simulation where robot agents learn to move around a warehouse floor and then work on their own: they pick multi-item orders from shelves, pack them at packing stations, and ship them from the dock. Their batteries drain as they work and they recharge at chargers when they run low.

- **Models:** each model holds one Q-table per destination (every stocked shelf face, packing station, dock and charger). They are trained with the tabular Q-learning rule from `base_reference_model.ipynb`.
- **Sessions:** an automated run with a fleet of 1–8 robots, a stream of orders, and live metrics. Robots route with Pure A\*, Q-learning only (falling back to A\* when the policy loops), or a hybrid of the two.
- **Compare:** replays the same seeded orders with different models and routing modes, so you can see how much the training helps.

## Run it locally (Windows)

```powershell
.\dev.ps1
```

On the first run this creates `backend\.venv`, installs the Python and npm dependencies, starts both servers, and opens http://localhost:5173.

To run each part by hand:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8080
```

```powershell
cd frontend
npm install
npm run dev
```

Or run both in Docker with `docker compose up`.

## Using it

1. **Models:** create a model and train it. Watch the learning curve, and inspect the heatmap and policy arrows for any destination.
2. **Session:** start a new session with that model, press Play (Space), and change the speed. You can add orders by hand, inspect a robot, and toggle the paths and Q-heatmap layers.
3. **Layouts:** paint racks, packing stations, docks and chargers, then save the result as a new layout. Retrain a model for it.
4. **History & Compare:** review finished sessions, and compare models on the same orders.

## Tests

```powershell
cd backend
.venv\Scripts\python.exe -m pytest                # fast suite
.venv\Scripts\python.exe -m pytest -m slow -s     # acceptance: trained vs undertrained vs A*
cd ..\frontend
npm test
npm run lint
```

## Where things live

- `backend/app/simulation/`: the simulation core (grid, A\*, Q-learning, orders, collisions, metrics, simulator). It does no I/O and is fully tested.
- `backend/app/`: the FastAPI app, SQLite storage, training jobs, and live sessions over a WebSocket.
- `backend/data/`: the local database and trained models (git-ignored).
- `frontend/src/`: the React UI (views, components, API and stream clients).
- `docs/superpowers/`: the design spec and implementation plan.
