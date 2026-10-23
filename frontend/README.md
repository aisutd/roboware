# RoboWare Frontend

React 19 + Vite UI for RoboWare. It talks to the FastAPI backend on port 8080 through Vite's `/api` proxy, which also carries the live session WebSocket. Set `VITE_API_TARGET` to point the proxy somewhere else.

- `npm run dev` — dev server on http://localhost:5173
- `npm test` — Vitest unit tests (stream reducer, grid and curve helpers)
- `npm run lint` / `npm run build`

Views: `src/views/` (Session, Models, Layouts, History & Compare). Map and panels: `src/components/`.
