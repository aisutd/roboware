"""The project's headline claim: trained agents follow their policy and keep up with A*."""

import pytest

from app.simulation.grid import default_layout
from app.simulation.models import Hyperparameters, OrderSettings, SessionConfig, StopCondition
from app.simulation.q_learning import train_model
from app.simulation.simulator import Simulator


def _run(layout, mode, qtables):
    config = SessionConfig(routing_mode=mode, robot_count=4, orders=OrderSettings(rate_per_100=20, seed=42),
                           stop=StopCondition("ticks", 2000))
    sim = Simulator(layout, config, qtables)
    while not sim.finished:
        sim.step()
    return sim.summary()


@pytest.mark.slow
def test_trained_model_beats_undertrained_and_keeps_up_with_astar():
    layout = default_layout()
    full, _ = train_model(layout, Hyperparameters(), seed=1)
    under, _ = train_model(layout, Hyperparameters(episodes_per_destination=300), seed=1)
    astar = _run(layout, "astar", None)
    trained = _run(layout, "q_only", full)
    weak = _run(layout, "q_only", under)
    print("\nA*:", astar, "\ntrained:", trained, "\nundertrained:", weak)
    assert trained["fallback_share"] < 0.10
    assert weak["fallback_share"] >= 0.30
    assert trained["throughput_per_100"] >= 0.85 * astar["throughput_per_100"]
