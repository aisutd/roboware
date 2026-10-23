import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.tests.conftest import wait_for_job


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


def test_session_with_untrained_model_warns(client):
    model = client.post("/api/models", json={"name": "Empty"}).json()
    s = create(client, model_id=model["id"], routing_mode="q_only")
    assert any("no trained destinations" in w for w in s["warnings"])
    assert control(client, s["id"], "step").json()["tick"] == 1


def test_q_only_without_model_warns(client):
    assert any("No model selected" in w for w in create(client, routing_mode="q_only")["warnings"])


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
    assert saved.json()["trained_destinations"] == 29
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


def test_model_with_a_different_grid_size_falls_back_to_astar(client):
    model = client.post("/api/models", json={"name": "Small", "hyperparameters": {"episodes_per_destination": 20}}).json()
    wait_for_job(client, client.post(f"/api/models/{model['id']}/train", json={}).json()["id"])
    cells = [["aisle"] * 20 for _ in range(10)]
    for x in (4, 5, 9, 10, 14, 15):
        for y in (1, 2, 3, 5, 6, 7):
            cells[y][x] = "rack"
    cells[2][18], cells[8][18], cells[2][0] = "packing", "dock", "charger"
    wide = client.post("/api/layouts", json={"name": "Wide", "width": 20, "height": 10, "cells": cells})
    assert wide.status_code == 201, wide.text
    s = create(client, layout_id=wide.json()["id"], model_id=model["id"], routing_mode="q_only",
               stop={"type": "ticks", "value": 60})
    assert any("grid" in w for w in s["warnings"])
    for _ in range(60):
        assert control(client, s["id"], "step").status_code == 200
    compare = client.post("/api/compare", json={"layout_id": wide.json()["id"], "ticks": 60, "robot_count": 2,
                                                "runs": [{"model_id": model["id"], "routing_mode": "q_only"}]})
    assert compare.status_code == 200


def test_order_size_weights_must_sum_above_zero(client):
    assert client.post("/api/sessions", json={"orders": {"size_weights": [0, 0, 0]}}).status_code == 422
    assert client.post("/api/sessions", json={"orders": {"size_weights": [1, -1, 0]}}).status_code == 422
