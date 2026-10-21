import pytest

from app.simulation.grid import default_layout
from app.simulation.models import Hyperparameters
from app.simulation.q_learning import downsample, evaluate, greedy_path, train_destination

DOCK = (14, 8)


def test_trained_policy_reaches_the_goal_from_every_cell():
    layout = default_layout()
    q, history = train_destination(layout, DOCK, Hyperparameters(episodes=6000), seed=1)
    assert len(q) == 160 and all(len(row) == 4 for row in q)
    result = evaluate(layout, q, DOCK)
    assert result["reach_rate"] == 1.0
    assert result["avg_extra_steps"] < 1.0
    assert history["success_rate"] > 0.9


def test_fewer_episodes_leave_far_cells_unlearned():
    layout = default_layout()
    q, _ = train_destination(layout, DOCK, Hyperparameters(episodes=3000), seed=1)
    assert 0.95 < evaluate(layout, q, DOCK)["reach_rate"] < 1.0


def test_untrained_policy_does_not_reach_the_goal():
    layout = default_layout()
    q, _ = train_destination(layout, DOCK, Hyperparameters(episodes=1), seed=1)
    assert evaluate(layout, q, DOCK)["reach_rate"] < 0.2


def test_training_is_deterministic_for_a_seed():
    layout = default_layout()
    a, _ = train_destination(layout, DOCK, Hyperparameters(episodes=200), seed=7)
    b, _ = train_destination(layout, DOCK, Hyperparameters(episodes=200), seed=7)
    assert a == b


def test_greedy_path_ends_on_the_goal():
    layout = default_layout()
    q, _ = train_destination(layout, DOCK, Hyperparameters(episodes=6000), seed=1)
    path = greedy_path(layout, q, (0, 0), DOCK)
    assert path[0] == (0, 0) and path[-1] == DOCK


def test_rack_destination_is_rejected():
    with pytest.raises(ValueError):
        train_destination(default_layout(), (4, 1), Hyperparameters(episodes=1))


def test_downsample_keeps_episode_count_and_caps_points():
    history = {"rewards": list(range(1000)), "steps": [5] * 1000, "success_rate": 0.5}
    out = downsample(history, max_points=100)
    assert out["episodes"] == 1000 and len(out["rewards"]) == 100 and len(out["steps"]) == 100
    assert out["rewards"][0] == 4.5
