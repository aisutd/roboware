"""Live sessions: one asyncio task per running session, broadcasting frames to WebSocket subscribers."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field

from .errors import Conflict
from .repository import load_layout, load_model, model_meta, model_status
from .simulation.models import SessionConfig
from .simulation.q_learning import export_model
from .simulation.simulator import Simulator
from .storage import Storage, now

log = logging.getLogger("roboware.sessions")

TICK_SECONDS_1X = 0.6
MAX_FPS = 20
MAX_SPEED_BATCH = 50
METRICS_FLUSH = 20
MAX_PENDING_EVENTS = 500
QUEUE_SIZE = 8
SPEEDS = (1, 2, 5, 10, "max")
MODE_LABELS = {"hybrid": "Hybrid", "q_only": "Q-only", "astar": "A*"}


@dataclass
class LiveSession:
    id: str
    name: str
    config: SessionConfig
    sim: Simulator
    model_name: str | None = None
    status: str = "created"
    speed: int | str = 1
    error: str | None = None
    task: asyncio.Task | None = None
    subscribers: set = field(default_factory=set)
    pending_events: list = field(default_factory=list)
    metrics_buffer: list = field(default_factory=list)
    last_frame: float = 0.0
    finalized: bool = False

    def state(self) -> dict:
        return {"id": self.id, "name": self.name, "status": self.status, "speed": self.speed,
                "tick": self.sim.tick, "config": self.config.to_dict(), "model_name": self.model_name,
                "error": self.error}


class SessionManager:
    def __init__(self, storage: Storage):
        self.storage = storage
        self.live: dict[str, LiveSession] = {}

    # -- lifecycle

    def create(self, config: SessionConfig) -> tuple[LiveSession, list[str]]:
        if config.online_learning and not config.model_id:
            raise ValueError("Online learning needs a model to learn into.")
        layout = load_layout(self.storage, config.layout_id)
        warnings: list[str] = []
        # Every warehouse runs with its own model, trained on its current floor plan.
        if not config.model_id:
            config.model_id = model_status(self.storage, config.layout_id, layout)["model_id"]
            if not config.model_id:
                raise ValueError("This warehouse has no trained model yet. Train one in the Training Lab first.")
        row, hp, qtables, _ = load_model(self.storage, config.model_id)
        model_name = row["name"]
        if row["layout_id"] != config.layout_id:
            raise ValueError("That model was trained for a different warehouse.")
        if row["layout_fingerprint"] != layout.fingerprint() or (qtables.width, qtables.height) != (layout.width, layout.height):
            raise ValueError("This warehouse changed since its model was trained. Retrain it first.")
        if len(qtables) == 0:
            raise ValueError("This model has not been trained yet.")
        sim = Simulator(layout, config, qtables, hp)
        name = config.name or f"{MODE_LABELS[config.routing_mode]} · {model_name or 'no model'} · {len(sim.robots)} robots"
        live = LiveSession(self.storage.create_session(name, config.to_dict()), name, config, sim, model_name)
        self.live[live.id] = live
        return live, warnings

    def get(self, session_id: str) -> LiveSession:
        live = self.live.get(session_id)
        if live is None:
            self.storage.get_session(session_id)  # raises NotFound for unknown ids
            raise Conflict("This session is no longer live (the server restarted). Start a new one.")
        return live

    async def control(self, session_id: str, action: str, speed=None) -> dict:
        live = self.get(session_id)
        if live.status in ("finished", "interrupted"):
            raise Conflict(f"This session is {live.status}.")
        if speed is not None:
            if speed not in SPEEDS:
                raise ValueError(f"Unknown speed: {speed}")
            live.speed = speed
        if action == "play":
            live.status = "running"
            if live.task is None or live.task.done():
                live.task = asyncio.create_task(self._run(live))
        elif action == "pause":
            live.status = "paused"
        elif action == "step":
            if live.status == "running":
                raise Conflict("Pause the session before stepping.")
            live.status = "paused"
            self._advance(live, 1)
        elif action == "stop":
            await self._finish(live)
            return live.state()
        elif action != "set_speed":
            raise ValueError(f"Unknown action: {action}")
        if live.sim.finished:
            await self._finish(live)
        else:
            self.storage.update_session(live.id, status=live.status)
            await self._broadcast(live, force=True)
        return live.state()

    def inject(self, session_id: str, items: list[dict] | None, priority: str) -> dict:
        live = self.get(session_id)
        if live.status in ("finished", "interrupted"):
            raise Conflict(f"This session is {live.status}.")
        if items:
            unknown = [i["sku"] for i in items if i["sku"] not in live.sim.inventory.stock]
            if unknown:
                raise ValueError(f"Unknown SKU: {', '.join(unknown)}")
        return live.sim.inject_order(items, priority).to_dict()

    def save_model(self, session_id: str, name: str | None = None) -> dict:
        live = self.get(session_id)
        if not live.config.online_learning or live.sim.qtables is None:
            raise Conflict("Online learning was off for this session, so there is nothing new to save.")
        parent = self.storage.get_model(live.config.model_id)
        _, _, _, histories = load_model(self.storage, parent["id"])
        version = parent["version"] + 1
        mid = self.storage.create_model(name or f"{parent['name']} v{version}", parent["layout_id"],
                                        parent["layout_fingerprint"], live.sim.hp.to_dict(),
                                        parent_model_id=parent["id"], version=version)
        row = self.storage.get_model(mid)
        self.storage.save_model_file(mid, export_model(model_meta(row), live.sim.hp, live.sim.qtables, histories))
        self.storage.update_model_after_training(mid, len(live.sim.qtables), live.sim.hp.to_dict())
        return self.storage.get_model(mid)

    # -- subscribers

    def subscribe(self, live: LiveSession) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        live.subscribers.add(queue)
        return queue

    def unsubscribe(self, live: LiveSession, queue: asyncio.Queue) -> None:
        live.subscribers.discard(queue)

    async def shutdown(self) -> None:
        for live in self.live.values():
            if live.task and not live.task.done():
                live.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await live.task

    # -- internals

    async def _run(self, live: LiveSession) -> None:
        try:
            while live.status == "running" and not live.sim.finished:
                if live.speed == "max":
                    self._advance(live, MAX_SPEED_BATCH)
                    await self._broadcast(live)
                    await asyncio.sleep(0)
                else:
                    self._advance(live, 1)
                    await self._broadcast(live)
                    await asyncio.sleep(TICK_SECONDS_1X / live.speed)
            if live.sim.finished and not live.finalized:
                await self._finish(live)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # keep the server alive; mark the session as broken
            log.exception("session %s crashed", live.id)
            live.status, live.error, live.finalized = "interrupted", str(exc), True
            self.storage.update_session(live.id, status="interrupted", error=str(exc), ended_at=now())
            await self._send(live, {"type": "error", "message": f"Session stopped: {exc}"})

    def _advance(self, live: LiveSession, ticks: int) -> None:
        for _ in range(ticks):
            live.pending_events.extend(live.sim.step())
            if live.sim.tick % live.config.metrics_every == 0:
                live.metrics_buffer.append(live.sim.live_stats())
            if live.sim.finished:
                break
        if len(live.pending_events) > MAX_PENDING_EVENTS:
            live.pending_events = live.pending_events[-MAX_PENDING_EVENTS:]
        if len(live.metrics_buffer) >= METRICS_FLUSH:
            self._flush_metrics(live)

    def _flush_metrics(self, live: LiveSession) -> None:
        self.storage.add_metrics(live.id, live.metrics_buffer)
        live.metrics_buffer = []

    async def _finish(self, live: LiveSession) -> None:
        if live.finalized:
            return
        live.finalized = True
        live.sim.stop()
        live.status = "finished"
        live.metrics_buffer.append(live.sim.live_stats())
        self._flush_metrics(live)
        self.storage.save_orders(live.id, [o.to_dict() for o in live.sim.orders.values()])
        self.storage.update_session(live.id, status="finished", summary=live.sim.summary(), ended_at=now())
        await self._broadcast(live, force=True)

    async def _broadcast(self, live: LiveSession, force: bool = False) -> None:
        t = time.monotonic()
        if not force and t - live.last_frame < 1 / MAX_FPS:
            return
        live.last_frame = t
        frame = {"type": "frame", "session": live.state(), **live.sim.snapshot(live.pending_events)}
        live.pending_events = []
        await self._send(live, frame)

    async def _send(self, live: LiveSession, message: dict) -> None:
        for queue in list(live.subscribers):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()  # drop the oldest frame for slow clients
            queue.put_nowait(message)
