# RoboWare Frontend — Module 1: Tactile Spatial Map UI

Module 1 implements the full-bleed tactile cartographic spatial map and interactive frontend for autonomous warehouse robot fleets.

## Features
- **Tactile Cartography & Claymorphism**: Warm Alabaster Concrete canvas (`#F4F1EA`), ceramic HUD surfaces (`.clay-card`), and squishy depressible buttons (`.clay-btn`).
- **3D Miniature Floorplan**: Recessed aisles, raised sandstone storage racks, orange picking bays, cobalt packing stations, sage emerald delivery goal `(14, 8)`, and amber charging docks at `x = 0`.
- **Autonomous Multi-Robot Fleet (R1–R4)**:
  - 2D Q-learning reinforcement learning engine with exact Bellman updates ($Q(s, a) \leftarrow Q(s, a) + \alpha [r + \gamma \max Q(s') - Q(s, a)]$).
  - 2D Manhattan A* pathfinding around storage racks.
  - Priority collision avoidance with 1-tick pulsing amber yield halos.
  - Dynamic battery drainage (0.8% per movement step) and auto-docking (< 20% battery) to chargers.
  - Fast Train (+100 Episodes) batch convergence.
- **Cartographic Overlays**: Animated dashed A* trajectory paths, pulsing yield rings, and toggleable Q-value heatmap with directional policy arrows (`↑`, `→`, `↓`, `←`).
- **Interactive Controls**:
  - `TopMapHud`: Tick/Episode counters, routing mode switcher (`Hybrid A* + Q-Learn`, `Q-Learning Only`, `Pure A*`), layer toggles.
  - `PlaybackDock`: Play/Pause, Step (+1 Tick), Fast Train (+100 Episodes), Reset, Speed multipliers (`1x`, `2x`, `5x`, `10x`).
  - `MapPaintToolbar`: Layout tile painter (Rack, Pick, Pack, Goal, Charger, Erase).
  - `OrderDemandDrawer`: Real-time KPI pills, live demand queue, manual order injection, auto-demand wave toggle.
  - `AgentBrainInspector`: Real-time robot inspector, 4-Way Q-Score Compass Pad, interactive Bellman hyperparameter sliders, model JSON export/import.

## Getting Started

### Local Development
```bash
cd frontend
npm install
npm run dev
```

The application runs at `http://localhost:5173/`. Proxies API calls under `/api` to the backend on `http://127.0.0.1:8080`.

### Production Build
```bash
npm run build
npm run preview
```

### Docker
```bash
docker compose up -d
```
