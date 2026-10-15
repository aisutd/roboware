import pytest

from app.errors import Forbidden, NotFound
from app.simulation.grid import default_layout
from app.storage import Storage


@pytest.fixture
def storage(tmp_path):
    s = Storage(tmp_path)
    s.ensure_default_layout(default_layout().to_dict())
    yield s
    s.close()


def test_default_layout_is_seeded_once_and_read_only(storage):
    storage.ensure_default_layout(default_layout().to_dict())
    layouts = storage.list_layouts()
    assert [(l["id"], l["is_default"]) for l in layouts] == [("default", True)]
    assert storage.get_layout("default")["layout"]["width"] == 16
    with pytest.raises(Forbidden):
        storage.update_layout("default", "x", {})


def test_layout_create_update_and_missing(storage):
    lid = storage.create_layout("Mine", default_layout().to_dict())
    storage.update_layout(lid, "Renamed", {"width": 16})
    row = storage.get_layout(lid)
    assert row["name"] == "Renamed" and row["layout"] == {"width": 16} and row["is_default"] is False
    with pytest.raises(NotFound):
        storage.get_layout("nope")


def test_model_rows_and_files(storage):
    mid = storage.create_model("First", "default", "abc", {"learning_rate": 0.1})
    assert storage.get_model(mid)["hyperparameters"] == {"learning_rate": 0.1}
    assert storage.load_model_file(mid) is None
    storage.save_model_file(mid, {"destinations": {}})
    assert storage.load_model_file(mid) == {"destinations": {}}
    storage.update_model_after_training(mid, 29, {"learning_rate": 0.2})
    row = storage.get_model(mid)
    assert row["trained_destinations"] == 29 and row["last_trained_at"] is not None
    assert [m["id"] for m in storage.list_models()] == [mid]
    storage.delete_model(mid)
    assert storage.list_models() == []
    assert storage.load_model_file(mid) is None
    with pytest.raises(NotFound):
        storage.delete_model(mid)


def test_sessions_metrics_and_orders(storage):
    sid = storage.create_session("Run 1", {"routing_mode": "astar"})
    storage.add_metrics(sid, [{"tick": 10, "delivered": 1}, {"tick": 20, "delivered": 3}])
    storage.save_orders(sid, [{"id": "ORD-0001", "status": "delivered"}])
    storage.update_session(sid, status="finished", summary={"delivered": 3})
    row = storage.get_session(sid)
    assert row["status"] == "finished" and row["summary"] == {"delivered": 3} and row["config"]["routing_mode"] == "astar"
    assert [m["tick"] for m in storage.get_metrics(sid)] == [10, 20]
    assert storage.get_orders(sid)[0]["id"] == "ORD-0001"


def test_mark_interrupted(storage):
    running = storage.create_session("A", {})
    storage.update_session(running, status="running")
    done = storage.create_session("B", {})
    storage.update_session(done, status="finished")
    storage.mark_interrupted_sessions()
    assert storage.get_session(running)["status"] == "interrupted"
    assert storage.get_session(done)["status"] == "finished"
