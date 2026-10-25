# Backend capabilities needed for future playback

The frontend uses existing REST endpoints and WebSocket messages unchanged. No backend implementation is part of this redesign.

## Persistent session replay

- **Why:** Review a finished run with a scrubber showing historical robot positions, payloads, and station state.
- **Related endpoints:** `GET /api/sessions/{id}` provides summaries, orders, and metrics; `/api/sessions/{id}/stream` provides live snapshots/frames only.
- **Missing data:** Time-indexed historical robot and station snapshots. Aggregate metrics and order timelines cannot reconstruct exact robot positions.
- **Proposed requirements:** An optional read-only, paginated frame endpoint with tick ranges and stable snapshot schemas, plus recording availability in session detail. Storage limits and retention need backend design.
- **Priority:** Medium.
- **Frontend fallback:** Current summary charts and order history remain available. Persistent replay cannot be faithfully implemented from these aggregates. No replay control is shown.

## Training episode playback

- **Why:** Inspect how an individual destination policy improves across episodes.
- **Related endpoints:** `GET /api/training/{job_id}`, `GET /api/models/{id}`, and `GET /api/models/{id}/qtable?dest=x,y` provide progress, aggregate learning curves, and current Q-values.
- **Missing data:** Sampled trajectories and versioned policy snapshots for historical episodes.
- **Proposed requirements:** Opt-in bounded trajectory recording during training, an episode index per destination, and a read-only sample endpoint with states/actions/rewards and episode identifiers.
- **Priority:** Low.
- **Frontend fallback:** Current learning curves and destination policy heatmaps remain available. They are not presented as recorded episode playback.
