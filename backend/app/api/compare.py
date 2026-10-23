from fastapi import APIRouter, Depends

from ..repository import load_layout, load_model
from ..schemas import CompareRequest
from ..services import Services, get_services
from ..simulation.models import OrderSettings, SessionConfig, StopCondition
from ..simulation.simulator import Simulator

router = APIRouter(tags=["compare"])
MODE_LABELS = {"hybrid": "Hybrid", "q_only": "Q-only", "astar": "A*"}


@router.post("/compare")
def compare(body: CompareRequest, services: Services = Depends(get_services)):
    """Replay one seeded workload per run, headless. A plain `def` so FastAPI runs it in the threadpool."""
    layout = load_layout(services.storage, body.layout_id)
    every = max(10, body.ticks // 100)
    results = []
    for run in body.runs:
        qtables = hp = None
        model_name = "No model"
        if run.model_id:
            row, hp, qtables, _ = load_model(services.storage, run.model_id)
            model_name = row["name"]
        config = SessionConfig(layout_id=body.layout_id, model_id=run.model_id, routing_mode=run.routing_mode,
                               hybrid_margin=body.hybrid_margin, robot_count=body.robot_count,
                               orders=OrderSettings.from_dict(body.orders.model_dump()),
                               stop=StopCondition("ticks", body.ticks), metrics_every=every)
        sim = Simulator(layout, config, qtables, hp)
        series = []
        while not sim.finished:
            sim.step()
            if sim.tick % every == 0 or sim.finished:
                series.append({"tick": sim.tick, "throughput_per_100": sim.metrics.throughput(sim.tick),
                               "delivered": sim.metrics.delivered})
        results.append({"label": f"{model_name} · {MODE_LABELS[run.routing_mode]}", "model_id": run.model_id,
                        "routing_mode": run.routing_mode, "summary": sim.summary(), "series": series})
    return {"runs": results}
