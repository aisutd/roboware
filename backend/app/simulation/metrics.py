"""Session metrics: live counters, rolling throughput and the end-of-run summary."""

from __future__ import annotations

import math
from collections import deque


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def _ratio(num: float, den: float, digits: int = 3) -> float:
    return round(num / den, digits) if den else 0.0


class MetricsTracker:
    def __init__(self, robot_ids: list[str], window: int = 100):
        self.window = window
        self.delivered = 0
        self.failed = 0
        self.wait_events = 0
        self.fallbacks = 0
        self.q_steps = 0
        self.planned_steps = 0
        self.total_steps = 0
        self.legs = 0
        self.extra_steps = 0
        self.cycle_times: list[int] = []
        self._recent: deque[int] = deque()
        self.robot_ticks = {rid: {"moving": 0, "working": 0, "charging": 0, "idle": 0} for rid in robot_ids}

    def record_delivery(self, tick: int, cycle_time: int) -> None:
        self.delivered += 1
        self.cycle_times.append(cycle_time)
        self._recent.append(tick)

    def record_failure(self) -> None:
        self.failed += 1

    def record_wait(self) -> None:
        self.wait_events += 1

    def record_fallback(self) -> None:
        self.fallbacks += 1

    def record_planned_step(self, used_q: bool) -> None:
        self.planned_steps += 1
        self.q_steps += int(used_q)

    def record_move(self) -> None:
        self.total_steps += 1

    def record_leg(self, steps: int, optimal: int) -> None:
        self.legs += 1
        self.extra_steps += max(0, steps - optimal)

    def record_robot_tick(self, robot_id: str, activity: str) -> None:
        self.robot_ticks[robot_id][activity] += 1

    def throughput(self, tick: int) -> float:
        while self._recent and self._recent[0] <= tick - self.window:
            self._recent.popleft()
        span = min(self.window, max(tick, 1))
        return round(len(self._recent) * 100 / span, 2)

    def _avg_cycle(self) -> float | None:
        return round(sum(self.cycle_times) / len(self.cycle_times), 2) if self.cycle_times else None

    def live(self, tick: int, queued: int, in_progress: int, avg_battery: float,
             charging_count: int, idle_count: int) -> dict:
        return {
            "tick": tick,
            "delivered": self.delivered,
            "failed": self.failed,
            "queued": queued,
            "in_progress": in_progress,
            "throughput_per_100": self.throughput(tick),
            "avg_cycle_time": self._avg_cycle(),
            "wait_events": self.wait_events,
            "fallbacks": self.fallbacks,
            "q_step_share": _ratio(self.q_steps, self.planned_steps),
            "avg_battery": round(avg_battery, 1),
            "charging_count": charging_count,
            "idle_count": idle_count,
        }

    def summary(self, tick: int) -> dict:
        return {
            "ticks": tick,
            "delivered": self.delivered,
            "failed": self.failed,
            "throughput_per_100": _ratio(self.delivered * 100, tick, 2),
            "avg_cycle_time": self._avg_cycle(),
            "p50_cycle_time": percentile(self.cycle_times, 50),
            "p95_cycle_time": percentile(self.cycle_times, 95),
            "steps_per_delivery": _ratio(self.total_steps, self.delivered, 2),
            "avg_extra_steps_per_leg": _ratio(self.extra_steps, self.legs),
            "legs": self.legs,
            "fallbacks": self.fallbacks,
            "fallback_share": _ratio(self.fallbacks, self.legs),
            "wait_events": self.wait_events,
            "q_step_share": _ratio(self.q_steps, self.planned_steps),
            "utilization": {rid: _ratio(t["moving"] + t["working"], tick) for rid, t in self.robot_ticks.items()},
        }
