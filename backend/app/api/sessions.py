import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from ..errors import Conflict, NotFound
from ..schemas import ControlIn, InjectOrderIn, SaveModelIn, SessionCreate
from ..services import Services, get_services
from ..simulation.models import SessionConfig

router = APIRouter(tags=["sessions"])


def _with_live(services: Services, row: dict) -> dict:
    live = services.sessions.live.get(row["id"])
    row["live"] = live is not None and not live.finalized
    if live is not None:
        row["status"] = live.status
        row["tick"] = live.sim.tick
    else:
        row["tick"] = (row["summary"] or {}).get("ticks", 0)
    return row


@router.post("/sessions", status_code=201)
async def create_session(body: SessionCreate, services: Services = Depends(get_services)):
    live, warnings = services.sessions.create(SessionConfig.from_dict(body.model_dump()))
    return {**live.state(), "warnings": warnings}


@router.get("/sessions")
async def list_sessions(services: Services = Depends(get_services)):
    return [_with_live(services, row) for row in services.storage.list_sessions()]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, services: Services = Depends(get_services)):
    row = _with_live(services, services.storage.get_session(session_id))
    row["metrics"] = services.storage.get_metrics(session_id)
    row["orders"] = services.storage.get_orders(session_id)
    live = services.sessions.live.get(session_id)
    if live is not None and not live.finalized:
        row["metrics"] += live.metrics_buffer
        row["summary"] = live.sim.summary()
    return row


@router.post("/sessions/{session_id}/control")
async def control(session_id: str, body: ControlIn, services: Services = Depends(get_services)):
    return await services.sessions.control(session_id, body.action, body.speed)


@router.post("/sessions/{session_id}/orders", status_code=201)
async def inject_order(session_id: str, body: InjectOrderIn, services: Services = Depends(get_services)):
    items = [i.model_dump() for i in body.items] if body.items else None
    return services.sessions.inject(session_id, items, body.priority)


@router.post("/sessions/{session_id}/save-model", status_code=201)
async def save_model(session_id: str, body: SaveModelIn | None = None, services: Services = Depends(get_services)):
    return services.sessions.save_model(session_id, body.name if body else None)


async def _pump(websocket: WebSocket, queue: asyncio.Queue) -> None:
    while True:
        await websocket.send_json(await queue.get())


@router.websocket("/sessions/{session_id}/stream")
async def stream(websocket: WebSocket, session_id: str):
    services: Services = websocket.app.state.services
    await websocket.accept()
    try:
        live = services.sessions.get(session_id)
    except (NotFound, Conflict) as exc:
        await websocket.close(code=4404, reason=str(exc)[:120])
        return
    queue = services.sessions.subscribe(live)
    sender = None
    try:
        await websocket.send_json({"type": "snapshot", "session": live.state(),
                                   "layout": live.sim.layout.to_dict(), **live.sim.snapshot()})
        sender = asyncio.create_task(_pump(websocket, queue))
        while True:
            message = await websocket.receive_json()
            if message.get("type") != "control":
                continue
            try:
                await services.sessions.control(session_id, message.get("action"), message.get("speed"))
            except (Conflict, NotFound, ValueError) as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        if sender is not None:
            sender.cancel()
        services.sessions.unsubscribe(live, queue)
