import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        yield c


def wait_for_job(client, job_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/training/{job_id}").json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError("training job did not finish")


def train_model(client, layout_id="default", episodes=20, name="Trained"):
    """Create and train a small model for a layout; sessions need one before they can start."""
    model = client.post("/api/models", json={"name": name, "layout_id": layout_id,
                                             "hyperparameters": {"episodes_per_destination": episodes}}).json()
    job = wait_for_job(client, client.post(f"/api/models/{model['id']}/train", json={}).json()["id"])
    assert job["status"] == "completed", job
    return client.get(f"/api/models/{model['id']}").json()
