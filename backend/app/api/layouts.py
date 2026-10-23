from fastapi import APIRouter, Depends

from ..schemas import LayoutIn
from ..services import Services, get_services
from ..simulation.grid import Layout, assign_products
from ..simulation.models import Product

router = APIRouter(tags=["layouts"])


def _detail(services: Services, layout_id: str) -> dict:
    row = services.storage.get_layout(layout_id)
    layout = Layout.from_dict(row["layout"])
    return {"id": row["id"], "is_default": row["is_default"], "updated_at": row["updated_at"], **layout.to_dict(),
            "name": row["name"]}


def _build(body: LayoutIn) -> Layout:
    layout = Layout.from_dict({"name": body.name, "width": body.width, "height": body.height, "cells": body.cells})
    if body.products is None:
        layout.products = assign_products(layout)
    else:
        layout.products = [Product(p.sku, p.name, tuple(p.face), p.stock) for p in body.products]
    layout.validate()
    return layout


@router.get("/layouts")
def list_layouts(services: Services = Depends(get_services)):
    return services.storage.list_layouts()


@router.get("/layouts/{layout_id}")
def get_layout(layout_id: str, services: Services = Depends(get_services)):
    return _detail(services, layout_id)


@router.post("/layouts", status_code=201)
def create_layout(body: LayoutIn, services: Services = Depends(get_services)):
    layout = _build(body)
    return _detail(services, services.storage.create_layout(body.name, layout.to_dict()))


@router.put("/layouts/{layout_id}")
def update_layout(layout_id: str, body: LayoutIn, services: Services = Depends(get_services)):
    services.storage.get_layout(layout_id)
    layout = _build(body)
    services.storage.update_layout(layout_id, body.name, layout.to_dict())
    return _detail(services, layout_id)
