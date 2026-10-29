import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.tests.conftest import train_model, wait_for_job


@pytest.fixture(autouse=True)
def trained(client):
    return train_model(client)


def create(client, **overrides):
    body = {"routing_mode": "astar", "robot_count": 2, "orders": {"rate_per_100": 20, "seed": 1},
            "stop": {"type": "ticks", "value": 30}} | overrides
    response = client.post("/api/sessions", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def control(client, sid, action, speed=None):
    return client.post(f"/api/sessions/{sid}/control", json={"action": action, "speed": speed})


def wait_finished(client, sid, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        detail = client.get(f"/api/sessions/{sid}").json()
        if detail["status"] == "finished":
            return detail
        time.sleep(0.05)
    raise AssertionError("session did not finish")


def test_session_lifecycle_with_steps(client):
    s = create(client)
    assert s["status"] == "created" and s["warnings"] == [] and s["tick"] == 0
    for _ in range(3):
        state = control(client, s["id"], "step").json()
    assert state["tick"] == 3 and state["status"] == "paused"
    order = client.post(f"/api/sessions/{s['id']}/orders",
                        json={"items": [{"sku": "SKU-001", "qty": 1}], "priority": "rush"})
    assert order.status_code == 201 and order.json()["priority"] == "rush"
    assert control(client, s["id"], "stop").json()["status"] == "finished"
    detail = client.get(f"/api/sessions/{s['id']}").json()
    assert detail["status"] == "finished" and detail["live"] is False
    assert detail["summary"]["ticks"] == 3
    assert detail["metrics"][-1]["tick"] == 3
    assert control(client, s["id"], "play").status_code == 409
    listed = client.get("/api/sessions").json()
    assert listed[0]["id"] == s["id"] and listed[0]["tick"] == 3


def test_play_at_max_speed_runs_to_the_stop_condition(client):
    s = create(client)
    assert control(client, s["id"], "play", "max").status_code == 200
    detail = wait_finished(client, s["id"])
    assert detail["summary"]["ticks"] == 30
    assert [m["tick"] for m in detail["metrics"]][:3] == [10, 20, 30]


def test_sessions_need_the_warehouse_s_own_trained_model(client, trained):
    s = create(client, routing_mode="q_only")
    assert s["config"]["model_id"] == trained["id"]
    empty = client.post("/api/models", json={"name": "Empty"}).json()
    untrained = client.post("/api/sessions", json={"model_id": empty["id"]})
    assert untrained.status_code == 400 and "not been trained" in untrained.json()["detail"]


def test_a_new_or_edited_warehouse_cannot_run_until_it_is_trained(client):
    layout = client.get("/api/layouts/default").json()
    body = {"name": "Copy", "width": layout["width"], "height": layout["height"], "cells": layout["cells"]}
    copy = client.post("/api/layouts", json=body).json()
    assert copy["model_status"] == "untrained"
    blocked = client.post("/api/sessions", json={"layout_id": copy["id"]})
    assert blocked.status_code == 400 and "no trained model" in blocked.json()["detail"]
    model = train_model(client, copy["id"], episodes=5)
    assert client.get(f"/api/layouts/{copy['id']}").json()["model_status"] == "ready"
    assert create(client, layout_id=copy["id"])["config"]["model_id"] == model["id"]
    body["cells"][0][0] = "void"
    client.put(f"/api/layouts/{copy['id']}", json=body)
    assert next(l for l in client.get("/api/layouts").json() if l["id"] == copy["id"])["model_status"] == "outdated"
    assert client.post("/api/sessions", json={"layout_id": copy["id"]}).status_code == 400
    wait_for_job(client, client.post(f"/api/models/{model['id']}/train", json={}).json()["id"])
    assert client.get(f"/api/layouts/{copy['id']}").json()["model_status"] == "ready"  # retraining catches up
    other = client.post("/api/sessions", json={"layout_id": "default", "model_id": model["id"]})
    assert other.status_code == 400 and "different warehouse" in other.json()["detail"]


def test_invalid_session_requests(client):
    s = create(client)
    assert client.post(f"/api/sessions/{s['id']}/orders", json={"items": [{"sku": "NOPE", "qty": 1}]}).status_code == 400
    assert client.post("/api/sessions", json={"robot_count": 9}).status_code == 422
    assert client.post("/api/sessions", json={"online_learning": True}).status_code == 400
    assert control(client, "ses_missing", "play").status_code == 404
    assert control(client, s["id"], "play").status_code == 200
    assert control(client, s["id"], "step").status_code == 409
    control(client, s["id"], "stop")


def test_stream_sends_snapshot_then_frames(client):
    s = create(client)
    with client.websocket_connect(f"/api/sessions/{s['id']}/stream") as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "snapshot"
        assert snapshot["layout"]["width"] == 16 and len(snapshot["robots"]) == 2
        ws.send_json({"type": "control", "action": "step"})
        frame = ws.receive_json()
        assert frame["type"] == "frame" and frame["tick"] == 1 and frame["session"]["status"] == "paused"
        ws.send_json({"type": "control", "action": "bogus"})
        assert ws.receive_json()["type"] == "error"


def test_stream_unknown_session_closes_4404(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/sessions/ses_missing/stream") as ws:
            ws.receive_json()
    assert exc.value.code == 4404


def test_online_learning_session_saves_a_new_model_version(client):
    model = client.post("/api/models", json={"name": "Base", "hyperparameters": {"episodes_per_destination": 30}}).json()
    wait_for_job(client, client.post(f"/api/models/{model['id']}/train", json={}).json()["id"])
    s = create(client, model_id=model["id"], routing_mode="q_only", online_learning=True)
    control(client, s["id"], "play", "max")
    wait_finished(client, s["id"])
    saved = client.post(f"/api/sessions/{s['id']}/save-model", json={})
    assert saved.status_code == 201
    assert saved.json()["parent_model_id"] == model["id"] and saved.json()["version"] == 2
    assert saved.json()["trained_destinations"] == 38
    plain = create(client)
    assert client.post(f"/api/sessions/{plain['id']}/save-model", json={}).status_code == 409


def test_compare_runs_each_configuration(client):
    response = client.post("/api/compare", json={"runs": [{"routing_mode": "astar"}, {"routing_mode": "q_only"}],
                                                 "ticks": 200, "robot_count": 2})
    assert response.status_code == 200
    runs = response.json()["runs"]
    assert [r["routing_mode"] for r in runs] == ["astar", "q_only"]
    assert runs[0]["summary"]["ticks"] == 200 and runs[0]["series"][-1]["tick"] == 200
    assert runs[0]["label"] == "No model · A*"
    too_many = {"runs": [{"routing_mode": "astar"}] * 7}
    assert client.post("/api/compare", json=too_many).status_code == 422


def test_void_cells_shape_the_floor_and_block_movement(client):
    cells = [["aisle"] * 8 for _ in range(6)]
    for y in range(3):
        for x in range(4, 8):
            cells[y][x] = "void"  # an L-shaped warehouse
    cells[4][2] = cells[4][3] = "rack"
    cells[5][0], cells[5][7], cells[3][7], cells[0][0] = "charger", "packing", "dock", "unload"
    layout = client.post("/api/layouts", json={"name": "L", "width": 8, "height": 6, "cells": cells})
    assert layout.status_code == 201, layout.text
    assert all(cells[y][x] != "void" for x, y in layout.json()["destinations"])
    train_model(client, layout.json()["id"], episodes=5)
    s = create(client, layout_id=layout.json()["id"], stop={"type": "ticks", "value": 40})
    assert control(client, s["id"], "step").status_code == 200


def test_order_size_weights_must_sum_above_zero(client):
    assert client.post("/api/sessions", json={"orders": {"size_weights": [0, 0, 0]}}).status_code == 422
    assert client.post("/api/sessions", json={"orders": {"size_weights": [1, -1, 0]}}).status_code == 422
