from app.simulation.grid import RACK, default_layout
from app.tests.conftest import wait_for_job


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_default_layout_is_listed(client):
    layouts = client.get("/api/layouts").json()
    assert layouts[0]["id"] == "default" and layouts[0]["is_default"] is True
    detail = client.get("/api/layouts/default").json()
    assert detail["width"] == 16 and len(detail["destinations"]) == 29 and len(detail["products"]) == 24


def test_create_layout_auto_assigns_products_and_validates(client):
    data = default_layout().to_dict()
    created = client.post("/api/layouts", json={"name": "Copy", "width": 16, "height": 10, "cells": data["cells"]})
    assert created.status_code == 201
    assert len(created.json()["products"]) == 24
    cells = [row[:] for row in data["cells"]]
    for x, y in [(13, 8), (15, 8), (14, 7), (14, 9)]:
        cells[y][x] = RACK
    bad = client.put(f"/api/layouts/{created.json()['id']}", json={"name": "Copy", "width": 16, "height": 10, "cells": cells})
    assert bad.status_code == 400
    assert [14, 8] in bad.json()["detail"]["unreachable"]


def test_default_layout_cannot_be_edited(client):
    data = default_layout().to_dict()
    r = client.put("/api/layouts/default", json={"name": "x", "width": 16, "height": 10, "cells": data["cells"]})
    assert r.status_code == 403


def test_create_train_and_read_model(client):
    model = client.post("/api/models", json={"name": "Quick", "hyperparameters": {"episodes_per_destination": 40}}).json()
    assert model["trained_destinations"] == 0 and model["layout_id"] == "default"
    job = client.post(f"/api/models/{model['id']}/train", json={"destinations": [[14, 8], [0, 2]]})
    assert job.status_code == 202
    done = wait_for_job(client, job.json()["id"])
    assert done["status"] == "completed" and done["done"] == 2 and done["progress"] == 1.0
    assert set(done["curves"]) == {"14,8", "0,2"}
    detail = client.get(f"/api/models/{model['id']}").json()
    assert detail["trained_destinations"] == 2
    assert detail["destinations"] == [[0, 2], [14, 8]]
    table = client.get(f"/api/models/{model['id']}/qtable", params={"dest": "14,8"}).json()
    assert len(table["values"]) == 160 and len(table["values"][0]) == 4
    assert client.get(f"/api/models/{model['id']}/qtable", params={"dest": "3,3"}).status_code == 404


def test_train_rejects_unknown_destination(client):
    model = client.post("/api/models", json={"name": "Quick"}).json()
    r = client.post(f"/api/models/{model['id']}/train", json={"destinations": [[4, 1]]})
    assert r.status_code == 400


def test_export_import_roundtrip(client):
    model = client.post("/api/models", json={"name": "Exp", "hyperparameters": {"episodes_per_destination": 20}}).json()
    wait_for_job(client, client.post(f"/api/models/{model['id']}/train", json={"destinations": [[14, 8]]}).json()["id"])
    exported = client.get(f"/api/models/{model['id']}/export")
    assert "attachment" in exported.headers["content-disposition"]
    imported = client.post("/api/models/import", json=exported.json())
    assert imported.status_code == 201
    assert imported.json()["trained_destinations"] == 1 and imported.json()["id"] != model["id"]


def test_import_rejects_malformed_model(client):
    assert client.post("/api/models/import", json={"q_table": [[1, 2]]}).status_code == 400
    assert client.post("/api/models/import", json=[1, 2, 3]).status_code == 400


def test_delete_model_and_404s(client):
    model = client.post("/api/models", json={"name": "Gone"}).json()
    assert client.delete(f"/api/models/{model['id']}").status_code == 204
    assert client.get(f"/api/models/{model['id']}").status_code == 404
    assert client.get("/api/training/nope").status_code == 404
    assert client.post("/api/models", json={"name": ""}).status_code == 422
