import json
import random

import numpy as np
import pytest

from app.simulation.astar import distance_map
from app.simulation.grid import DELTAS, default_layout
from app.simulation.models import Hyperparameters
from app.simulation.q_learning import (
    QTableSet,
    export_model,
    greedy_action,
    import_model,
    q_update,
    state_index,
    train_destination,
    train_model,
)


def test_update_rule_matches_notebook_numbers():
    # base_reference_model.ipynb: 5 cells, goal at 4, actions [left, right], alpha 0.1, gamma 0.95.
    q = np.zeros((5, 2))
    q_update(q, 3, 1, 10, 4, True, 0.1, 0.95)
    assert q[3, 1] == pytest.approx(1.0)
    q_update(q, 2, 1, -1, 3, False, 0.1, 0.95)
    assert q[2, 1] == pytest.approx(0.1 * (-1 + 0.95 * 1.0))


def _greedy_reach_rate(layout, table, dest):
    dist = distance_map(layout, dest)
    ok = total = 0
    for cell, d in dist.items():
        if cell == dest:
            continue
        total += 1
        pos = cell
        for _ in range(d + 2):
            dx, dy = DELTAS[greedy_action(table[state_index(pos, layout.width)])]
            nxt = (pos[0] + dx, pos[1] + dy)
            if not layout.driveable(nxt):
                break
            pos = nxt
            if pos == dest:
                break
        ok += pos == dest
    return ok / total


@pytest.mark.parametrize("dest", [(14, 8), (3, 2), (0, 2)])
def test_trained_policy_reaches_destination_from_almost_everywhere(dest):
    layout = default_layout()
    table, history = train_destination(layout, dest, Hyperparameters(), random.Random(0))
    assert len(history["rewards"]) == 3000
    assert _greedy_reach_rate(layout, table, dest) >= 0.95


def test_value_next_to_goal_converges_positive_and_points_at_goal():
    layout = default_layout()
    table, _ = train_destination(layout, (14, 8), Hyperparameters(), random.Random(0))
    row = table[state_index((13, 8), 16)]
    assert row[3] > 0  # right
    assert greedy_action(row) == 3


def test_epsilon_decay_runs_and_keeps_episode_count():
    hp = Hyperparameters(episodes_per_destination=200, epsilon_decay=True)
    _, history = train_destination(default_layout(), (14, 8), hp, random.Random(1))
    assert len(history["rewards"]) == 200


def test_train_model_reports_progress_and_continues_existing_tables():
    layout = default_layout()
    hp = Hyperparameters(episodes_per_destination=50)
    calls = []
    qt, hist = train_model(layout, hp, [(14, 8), (0, 2)], seed=3, on_progress=lambda *a: calls.append(a))
    assert [c[:3] for c in calls] == [(1, 2, (14, 8)), (2, 2, (0, 2))]
    assert hist["14,8"]["episodes"] == 50
    first = qt.get((14, 8)).copy()
    qt2, _ = train_model(layout, hp, [(14, 8)], seed=4, qtables=qt)
    assert not np.array_equal(first, qt2.get((14, 8)))
    assert np.array_equal(first, qt.get((14, 8)))  # the input set is not mutated


def test_default_train_model_covers_all_destinations():
    layout = default_layout()
    qt, hist = train_model(layout, Hyperparameters(episodes_per_destination=5))
    assert len(qt) == 29 and len(hist) == 29


def test_export_import_roundtrip_is_exact():
    layout = default_layout()
    qt, hist = train_model(layout, Hyperparameters(episodes_per_destination=20), [(14, 8)])
    qt.get((14, 8))[138, 3] = 8.55
    meta = {"id": "m1", "name": "Test", "layout_id": "default", "layout_fingerprint": layout.fingerprint()}
    data = json.loads(json.dumps(export_model(meta, Hyperparameters(), qt, hist)))
    assert data["actions"] == ["up", "down", "left", "right"]
    meta2, hp2, qt2, hist2 = import_model(data)
    assert meta2["name"] == "Test"
    assert hp2 == Hyperparameters()
    assert qt2.get((14, 8))[138, 3] == 8.55
    assert np.array_equal(qt2.get((14, 8)), qt.get((14, 8)))
    assert hist2 == hist


def test_import_legacy_single_goal_export():
    rows = [[0.0, 0.0, 0.0, 0.0] for _ in range(160)]
    rows[138][3] = 8.55
    legacy = {"q_table": rows, "actions": ["up", "down", "left", "right"], "goal": [14, 8],
              "step_reward": -1, "goal_reward": 10, "discount_factor": 0.9}
    _, hp, qt, _ = import_model(legacy)
    assert qt.destinations() == [(14, 8)]
    assert qt.get((14, 8))[138, 3] == 8.55
    assert hp.discount_factor == 0.9


@pytest.mark.parametrize("bad", [[], {"q_table": [[0, 0]]}, {"destinations": {"1,1": {"q_table": [[1, 2, 3]]}}}, {"nope": 1}])
def test_import_rejects_malformed_files(bad):
    with pytest.raises(ValueError):
        import_model(bad)


def test_qtableset_copy_is_deep():
    qt = QTableSet(16, 10, {(1, 1): np.zeros((160, 4))})
    clone = qt.copy()
    clone.get((1, 1))[0, 0] = 5
    assert qt.get((1, 1))[0, 0] == 0
