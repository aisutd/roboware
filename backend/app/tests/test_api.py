import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path))


def train(client, **body):
    body.setdefault("hyperparameters", {"episodes": 1500})
    return client.post("/api/models", json=body)


def test_layout_lists_destinations(client):
    data = client.get("/api/layout").json()
    assert data["width"] == 16 and [14, 8] in data["destinations"]


def test_train_save_list_get_delete(client):
    res = train(client, name="Dock runner", goal=[14, 8])
    assert res.status_code == 201
    model = res.json()
    assert model["name"] == "Dock runner" and model["goal"] == [14, 8]
    assert len(model["q_table"]) == 160
    assert model["evaluation"]["reach_rate"] > 0.9
    assert model["history"]["episodes"] == 1500

    listed = client.get("/api/models").json()
    assert [m["id"] for m in listed] == [model["id"]]
    assert "q_table" not in listed[0]  # summaries stay small

    full = client.get(f"/api/models/{model['id']}").json()
    assert full["q_table"] == model["q_table"]

    assert client.delete(f"/api/models/{model['id']}").status_code == 204
    assert client.get(f"/api/models/{model['id']}").status_code == 404


def test_models_survive_a_restart(tmp_path):
    model = train(TestClient(create_app(tmp_path)), goal=[14, 2]).json()
    again = TestClient(create_app(tmp_path)).get(f"/api/models/{model['id']}")
    assert again.status_code == 200 and again.json()["goal"] == [14, 2]


def test_default_name_mentions_goal(client):
    assert train(client, goal=[0, 2]).json()["name"].startswith("Goal 0,2")


def test_bad_requests(client):
    assert train(client, goal=[4, 1]).status_code == 400  # a rack
    assert train(client, hyperparameters={"learning_rate": 0}).status_code == 422
    assert train(client, hyperparameters={"episodes": 50_000}).status_code == 422
    assert client.get("/api/models/../../etc").status_code == 404
    assert client.delete("/api/models/abc123").status_code == 404
