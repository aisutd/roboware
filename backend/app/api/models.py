from fastapi import APIRouter, Body, Depends, Response
from fastapi.responses import JSONResponse

from ..errors import NotFound
from ..repository import load_layout, load_model, model_meta
from ..schemas import ModelCreate, TrainRequest
from ..services import Services, get_services
from ..simulation.models import Hyperparameters
from ..simulation.q_learning import export_model, import_model, parse_dest_key

router = APIRouter(tags=["models"])


@router.get("/models")
def list_models(services: Services = Depends(get_services)):
    return services.storage.list_models()


@router.post("/models", status_code=201)
def create_model(body: ModelCreate, services: Services = Depends(get_services)):
    layout = load_layout(services.storage, body.layout_id)
    mid = services.storage.create_model(body.name, body.layout_id, layout.fingerprint(),
                                        body.hyperparameters.model_dump())
    return services.storage.get_model(mid)


@router.get("/models/{model_id}")
def get_model(model_id: str, services: Services = Depends(get_services)):
    row, _, qtables, histories = load_model(services.storage, model_id)
    layout = load_layout(services.storage, row["layout_id"])
    return {**row, "destinations": [list(d) for d in qtables.destinations()],
            "layout_destinations": [list(d) for d in layout.destinations()],
            "layout_matches": row["layout_fingerprint"] == layout.fingerprint(),
            "training_history": histories}


@router.delete("/models/{model_id}", status_code=204)
def delete_model(model_id: str, services: Services = Depends(get_services)):
    services.storage.delete_model(model_id)
    return Response(status_code=204)


@router.post("/models/{model_id}/train", status_code=202)
def train(model_id: str, body: TrainRequest, services: Services = Depends(get_services)):
    row = services.storage.get_model(model_id)
    hp = Hyperparameters.from_dict(body.hyperparameters.model_dump() if body.hyperparameters else row["hyperparameters"])
    dests = [tuple(d) for d in body.destinations] if body.destinations else None
    return services.training.start(model_id, hp, dests, body.seed).to_dict()


@router.get("/models/{model_id}/qtable")
def get_qtable(model_id: str, dest: str, services: Services = Depends(get_services)):
    _, _, qtables, _ = load_model(services.storage, model_id)
    try:
        cell = parse_dest_key(dest)
    except ValueError as exc:
        raise ValueError('dest must look like "x,y"') from exc
    table = qtables.get(cell)
    if table is None:
        raise NotFound(f"No Q-table for destination {dest}")
    return {"destination": list(cell), "width": qtables.width, "height": qtables.height, "values": table.tolist()}


@router.get("/models/{model_id}/export")
def export(model_id: str, services: Services = Depends(get_services)):
    row, hp, qtables, histories = load_model(services.storage, model_id)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in row["name"])
    return JSONResponse(export_model(model_meta(row), hp, qtables, histories),
                        headers={"Content-Disposition": f'attachment; filename="{safe}.roboware.json"'})


@router.post("/models/import", status_code=201)
def import_(data=Body(...), services: Services = Depends(get_services)):
    meta, hp, qtables, histories = import_model(data)
    layout_id = meta.get("layout_id") or "default"
    try:
        layout = load_layout(services.storage, layout_id)
    except NotFound:
        layout_id, layout = "default", load_layout(services.storage, "default")
    if (qtables.width, qtables.height) != (layout.width, layout.height):
        raise ValueError(f"Model grid {qtables.width}x{qtables.height} does not match layout {layout.width}x{layout.height}.")
    name = f"{meta.get('name') or 'Imported model'} (imported)"
    mid = services.storage.create_model(name, layout_id, meta.get("layout_fingerprint") or layout.fingerprint(),
                                        hp.to_dict())
    row = services.storage.get_model(mid)
    services.storage.save_model_file(mid, export_model(model_meta(row), hp, qtables, histories))
    services.storage.update_model_after_training(mid, len(qtables), hp.to_dict())
    return services.storage.get_model(mid)
