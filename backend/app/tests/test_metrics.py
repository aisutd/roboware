from app.simulation.metrics import MetricsTracker, percentile


def test_percentile_nearest_rank():
    values = list(range(1, 11))
    assert percentile(values, 50) == 5
    assert percentile(values, 95) == 10
    assert percentile([7], 95) == 7
    assert percentile([], 50) is None


def test_rolling_throughput_window():
    m = MetricsTracker(["R1"], window=100)
    for tick in (10, 50, 150):
        m.record_delivery(tick, 20)
    assert m.throughput(160) == 1.0  # only tick 150 is inside (60, 160]
    early = MetricsTracker(["R1"], window=100)
    early.record_delivery(10, 5)
    early.record_delivery(50, 5)
    assert early.throughput(50) == 4.0  # 2 deliveries scaled from 50 ticks to 100


def test_summary_rates_and_shares():
    m = MetricsTracker(["R1", "R2"])
    m.record_delivery(30, 30)
    m.record_delivery(60, 50)
    for _ in range(10):
        m.record_move()
    m.record_leg(5, 4)
    m.record_leg(7, 7)
    m.record_fallback()
    m.record_planned_step(True)
    m.record_planned_step(False)
    for _ in range(50):
        m.record_robot_tick("R1", "moving")
        m.record_robot_tick("R2", "idle")
    s = m.summary(100)
    assert s["delivered"] == 2
    assert s["throughput_per_100"] == 2.0
    assert s["avg_cycle_time"] == 40.0
    assert s["p95_cycle_time"] == 50
    assert s["steps_per_delivery"] == 5.0
    assert s["avg_extra_steps_per_leg"] == 0.5
    assert s["fallback_share"] == 0.5
    assert s["q_step_share"] == 0.5
    assert s["utilization"] == {"R1": 0.5, "R2": 0.0}


def test_live_stats_shape():
    m = MetricsTracker(["R1"])
    live = m.live(10, queued=2, in_progress=1, avg_battery=88.04, charging_count=0, idle_count=1)
    assert live["tick"] == 10 and live["queued"] == 2 and live["avg_battery"] == 88.0
    assert live["avg_cycle_time"] is None
