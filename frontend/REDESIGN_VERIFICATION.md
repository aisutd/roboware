# Frontend redesign verification

Run from `frontend/`: `npm run build`, `npm run lint`, `npm test`.
No dependencies, backend code, model files, database files, API payloads, or WebSocket message formats were changed.

## Manual checks with a running backend

1. **Session:** Start a session. Confirm connection/status/routing information and all controls: Play/Pause, Step, Stop, speed, layers, Save learned model (online learning), and New session. Check Space and 1–8/P/Q/H shortcuts. Shortcuts must not act while a dialog or form field is active.
2. **Camera:** Zoom with buttons, use Fit warehouse, pan with buttons, then activate Pan and drag the floor. Select another robot and enable Follow. Focus the map and test +/−, arrows, 0, and F. Toggle the grid. Cells and robot positions must remain aligned at all zoom levels.
3. **Floor:** Inspect adjacent rack bridges, station labels, stock labels, carrying badges, selected route and target marker, Q heatmap and policy arrows. Check yielding indicators and reduced-motion OS settings.
4. **Fleet/orders:** Select every robot from map and roster. Verify task ID, cell, target, battery, payload, Q-values and fallback label against actual streamed data. Inject normal/rush orders and check stages. Scroll to all orders. Collapse and restore the inspector.
5. **Analytics:** A trend appears after two observed metric samples. It contains only samples received by this client, not historical reconstruction; reload/reconnect resets the observation window.
6. **Demo:** Enter and exit fullscreen, use the shortcut dialog, and press Escape. Verify dialog focus containment and return focus. Fullscreen depends on browser support.
7. **Training Lab:** Create/import/select models, change hyperparameters, train, inspect progress/curves and different policy destinations, export JSON, and test the existing two-step deletion confirmation. Confirm library selection is protected during active training. Missing or failed data must show feedback instead of stale telemetry.
8. **Layout studio:** Paint/drag every brush, erase, undo/redo paint strokes (Ctrl/Cmd+Z, Shift+Z or Y), reset to saved, rename, Save, and Save as new. Test the built-in copy workflow. Submit an invalid layout to check backend validation and red cells. Deselect the brush before drag-panning. Undo history is per stroke, bounded to 100 undo entries, and resets on load/save; it is not persisted. Browser refresh/close warns for unsaved changes; in-app navigation away is not guarded.
9. **History:** Search and filter sessions, keyboard-select a row with Enter, inspect metrics and recorded charts, and open a live session. Compare all routing modes. Inspect completed workload settings, per-metric best values/ties, and throughput deltas against the first A* run. Zero baselines and missing data must never produce fabricated gains.
10. **Responsive:** Check 1600px, 1280px, 900px, and 390px widths. Navigation retains labels; the operational inspector stacks beneath the floor on phones; the Training Lab and comparison cards stack. Test scrolling and keyboard focus throughout.

## Remaining limitations

- End-to-end backend and browser checks require a running backend and a connected browser; automated unit/build/lint checks alone do not certify those interactions.
- Historical session replay and training episode playback require additional backend data; see `BACKEND_REQUESTS.md`.
- Optional model thumbnails, extra telemetry, and sample-path playback were not added. Model cards show only existing trained counts; full readiness/layout compatibility comes from selected model detail.
- Camera controls are frontend-only; camera position is not persisted. No wheel/pinch zoom or one-gesture touch painting was added.

## Phase status

- **1 — Shell:** Retains the branded sidebar/docked layout and adds keyboard skip navigation, safe view restoration, guided empty-state links, and session reset isolation.
- **2–4 — Twin, robots, interaction:** Preserves industrial SVG robots and station graphics; adds connected shelving, rack coordinate labels, an optional grid, zoom, drag/button/keyboard pan, fit, follow, and an unscaled inspection readout. All logical coordinates remain unchanged.
- **5–7 — Fleet, analytics, orders:** Adds task/location/destination and numeric battery details, bounded observed throughput trends, metric descriptions, order-stage labels and accessible progress summaries.
- **8 — Training Lab:** Adds a model-card library, create dialog, training bench/policy layout, field explanations, readiness badges, and loading/error handling. Existing import/export/delete/train actions remain.
- **9–11 — Comparison, editor, history:** Adds actual-result cards, metric-specific best marks and valid baseline deltas; stroke-based undo/redo and inline backend validation; searchable/filterable and keyboard-accessible session history.
- **12 — Demo:** Adds inspector collapse, fullscreen, and a shortcut reference. Native dialogs contain focus and expose inline errors.
- **13 — Quality:** Build/lint/tests pass. Static station SVGs are memoized. Reduced motion is retained. Browser rendering, responsive behavior, live API actions, focus, pointer interactions, and runtime performance still need the manual checks above; no connected browser was available.

No optional playback controls or unsupported telemetry were implemented. Only read-only Git status/diff inspection was performed; no branch changes, commits, pushes, pulls, or merges.

## Complete working-tree file inventory

This list includes the earlier design iterations already present when this pass began, as well as this pass. All paths are inside `frontend/`.

- `frontend/BACKEND_REQUESTS.md`
- `frontend/REDESIGN_VERIFICATION.md`
- `frontend/src/App.jsx`
- `frontend/src/components/BarCompare.jsx`
- `frontend/src/components/Dialog.jsx`
- `frontend/src/components/HyperparameterFields.jsx`
- `frontend/src/components/LineChart.jsx`
- `frontend/src/components/MapPaintToolbar.jsx`
- `frontend/src/components/NavRail.jsx`
- `frontend/src/components/NewSessionDialog.jsx`
- `frontend/src/components/OrdersPanel.jsx`
- `frontend/src/components/RobotsPanel.jsx`
- `frontend/src/components/SessionBar.jsx`
- `frontend/src/components/Toast.jsx`
- `frontend/src/components/WarehouseMapCanvas.jsx`
- `frontend/src/components/WarehouseMapCanvas.test.jsx`
- `frontend/src/components/Window.jsx`
- `frontend/src/hooks/useTrainingJob.js`
- `frontend/src/index.css`
- `frontend/src/lib/comparison.js`
- `frontend/src/lib/comparison.test.js`
- `frontend/src/lib/layoutHistory.js`
- `frontend/src/lib/layoutHistory.test.js`
- `frontend/src/lib/mapCamera.js`
- `frontend/src/lib/mapCamera.test.js`
- `frontend/src/services/sessionMetrics.test.js`
- `frontend/src/services/sessionStream.js`
- `frontend/src/views/HistoryView.jsx`
- `frontend/src/views/LayoutsView.jsx`
- `frontend/src/views/ModelsView.jsx`
- `frontend/src/views/SessionView.jsx`

## Blueprint Studio MVP checks

- Use **New blueprint** to create a local blank floor with integer dimensions from 4 to 40 cells per axis. Test 4×4, 40×4, 4×40 and 40×40. Values outside these limits or fractional values must be rejected. These are logical cells, not meters or feet. Existing saved warehouses are not resized.
- Paint a long rack row with a fast drag, then undo and redo the entire stroke. Paint walkable aisles to erase. Pan remains available after deselecting the brush.
- Place at least one packing station, charging station and shipping dock. Keep destinations connected by walkable paths. Save uses the unchanged backend validator and persistence contract. The equipment count is guidance, not a substitute for backend validation.
- Try saving a missing-station or unreachable layout. Check the returned message, coordinate list, and red destination outlines.
- Save the draft, then use **Train a model** or **Configure simulation**. The relevant creation dialog must open with the newly saved warehouse selected. The built-in warehouse still requires Save as new layout; local drafts always create a new saved layout.
- Racks are storage obstacles; arbitrary walls/obstacles, imported floor plans, and physical measurements require future backend support and are not represented as supported capabilities.

This focused MVP also modifies `frontend/src/lib/grid.js` and adds `frontend/src/lib/blueprint.test.js`; the earlier working-tree inventory above records the preceding redesign pass.
