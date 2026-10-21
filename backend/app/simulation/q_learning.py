"""Tabular Q-learning toward one destination: the notebook's update rule on the warehouse grid."""

from __future__ import annotations

import random

from .astar import distance_map
from .grid import ACTIONS, DELTAS, Layout
from .models import Cell, Hyperparameters


def state_index(cell: Cell, width: int) -> int:
    return cell[1] * width + cell[0]


def _transitions(layout: Layout) -> list[list[int]]:
    """trans[s][a] = next state index; bumping into a wall or rack leaves the robot in place."""
    w = layout.width
    trans = []
    for y in range(layout.height):
        for x in range(w):
            row = []
            for dx, dy in DELTAS:
                n = (x + dx, y + dy)
                row.append(state_index(n, w) if layout.driveable(n) else y * w + x)
            trans.append(row)
    return trans


def train_destination(layout: Layout, dest: Cell, hp: Hyperparameters,
                      seed: int = 0) -> tuple[list[list[float]], dict]:
    """Train one Q-table (width*height x 4) whose goal is `dest`. Returns the table and per-episode history."""
    if not layout.driveable(dest):
        raise ValueError(f"Destination {list(dest)} is not a driveable cell.")
    rng = random.Random(seed)
    w = layout.width
    q = [[0.0] * 4 for _ in range(w * layout.height)]
    trans = _transitions(layout)
    goal = state_index(dest, w)
    starts = [state_index((x, y), w) for y in range(layout.height) for x in range(w)
              if layout.driveable((x, y)) and (x, y) != dest]
    alpha, gamma = hp.learning_rate, hp.discount_factor
    episodes = max(1, int(hp.episodes))
    rewards: list[float] = []
    steps: list[int] = []
    successes = 0
    for e in range(episodes):
        eps = hp.exploration_rate
        if hp.epsilon_decay and episodes > 1:
            eps = max(hp.epsilon_min, hp.exploration_rate - (hp.exploration_rate - hp.epsilon_min) * e / (episodes - 1))
        s = rng.choice(starts)
        total, n, finished = 0.0, 0, False
        for n in range(1, hp.max_steps + 1):
            row = q[s]
            if rng.random() < eps:
                a = rng.randrange(4)
            else:
                best = max(row)
                a = rng.choice([i for i in range(4) if row[i] == best])
            s2 = trans[s][a]
            finished = s2 == goal
            r = hp.goal_reward if finished else hp.step_reward
            target = r if finished else r + gamma * max(q[s2])
            row[a] += alpha * (target - row[a])
            total += r
            s = s2
            if finished:
                break
        successes += finished
        rewards.append(total)
        steps.append(n)
    return q, {"rewards": rewards, "steps": steps, "success_rate": successes / episodes}


def downsample(history: dict, max_points: int = 200) -> dict:
    """Average the per-episode history into at most `max_points` buckets for charting."""
    rewards, steps = history["rewards"], history["steps"]
    n = len(rewards)
    out = {"episodes": n, "success_rate": round(history["success_rate"], 4)}
    if n <= max_points:
        return {**out, "rewards": [round(v, 3) for v in rewards], "steps": list(steps)}
    bucket = n / max_points
    out_r, out_s = [], []
    for i in range(max_points):
        lo, hi = int(i * bucket), int((i + 1) * bucket)
        out_r.append(round(sum(rewards[lo:hi]) / (hi - lo), 3))
        out_s.append(round(sum(steps[lo:hi]) / (hi - lo), 2))
    return {**out, "rewards": out_r, "steps": out_s}


def greedy_path(layout: Layout, q: list[list[float]], start: Cell, dest: Cell, limit: int = 200) -> list[Cell] | None:
    """Follow the table greedily from `start`; None if it loops or runs out of steps before `dest`."""
    trans = _transitions(layout)
    w = layout.width
    s, goal = state_index(start, w), state_index(dest, w)
    path, seen = [start], {s}
    for _ in range(limit):
        if s == goal:
            return path
        row = q[s]
        s = trans[s][row.index(max(row))]
        if s in seen:
            return None
        seen.add(s)
        path.append((s % w, s // w))
    return path if s == goal else None


def evaluate(layout: Layout, q: list[list[float]], dest: Cell) -> dict:
    """How well the greedy policy reaches `dest`: share of cells that arrive, and extra steps over A*."""
    dist = distance_map(layout, dest)
    starts = [c for c in dist if c != dest]
    reached, extra = 0, 0
    for c in starts:
        path = greedy_path(layout, q, c, dest)
        if path is not None:
            reached += 1
            extra += len(path) - 1 - dist[c]
    return {
        "cells": len(starts),
        "reach_rate": round(reached / len(starts), 4) if starts else 0.0,
        "avg_extra_steps": round(extra / reached, 3) if reached else None,
    }


def to_notebook_format(q: list[list[float]], dest: Cell, hp: Hyperparameters) -> dict:
    """The model JSON schema from base_reference_model.ipynb (also what the frontend engine imports)."""
    return {
        "q_table": q,
        "actions": list(ACTIONS),
        "goal": [dest[0], dest[1]],
        "step_reward": hp.step_reward,
        "goal_reward": hp.goal_reward,
        "discount_factor": hp.discount_factor,
    }
