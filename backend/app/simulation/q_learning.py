"""Tabular Q-learning toward one destination: the notebook's update rule on the warehouse grid.

How it works, in short:
- Every floor cell is a "state". The 16x10 floor has 160 states (racks included, they just
  never get visited).
- In every state the robot can take 4 actions: up, down, left, right.
- The Q-table has one row per state and one column per action. Q[s][a] is the agent's estimate
  of "how good is it to take action a in state s?", meaning the total reward it expects to
  collect from there on.
- Training runs many "episodes". Each one drops the robot on a random cell and lets it move
  until it reaches the goal or runs out of steps. After every move, the table is nudged toward
  a better estimate. Over time the best action in each row points along the shortest route.
- Once trained, the robot drives "greedily": in each cell it takes the action with the highest Q.
"""

from __future__ import annotations

import random

from .astar import distance_map
from .grid import ACTIONS, DELTAS, Layout
from .models import Cell, Hyperparameters


def state_index(cell: Cell, width: int) -> int:
    """Turn (x, y) into a single row number for the Q-table, counting row by row.

    For example, on a 16-wide floor (3, 2) -> 2*16 + 3 = 35. The JS engine uses the same
    formula, so tables are interchangeable.
    """
    return cell[1] * width + cell[0]


def _transitions(layout: Layout) -> list[list[int]]:
    """trans[s][a] = next state index; bumping into a wall or rack leaves the robot in place.

    Working out every move once, up front, makes the training loop much faster than checking
    the grid on every step. "Stay in place" mirrors the notebook. A bump costs a step (a
    -1 reward) without making progress, so the agent learns to avoid walls.
    """
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
    # A seeded random generator makes training repeatable: same seed + same settings = same table.
    rng = random.Random(seed)
    w = layout.width
    # Start knowing nothing: every Q-value is 0.
    q = [[0.0] * 4 for _ in range(w * layout.height)]
    trans = _transitions(layout)
    goal = state_index(dest, w)
    # Episodes can start on any driveable cell except the goal itself.
    starts = [state_index((x, y), w) for y in range(layout.height) for x in range(w)
              if layout.driveable((x, y)) and (x, y) != dest]
    alpha, gamma = hp.learning_rate, hp.discount_factor
    episodes = max(1, int(hp.episodes))
    rewards: list[float] = []  # total reward of each episode (for the learning curve)
    steps: list[int] = []      # how many moves each episode took
    successes = 0              # episodes that reached the goal before max_steps
    for e in range(episodes):
        # Epsilon is the chance of exploring (a random move) instead of exploiting (the best known move).
        # With decay on, it slides linearly from exploration_rate down to epsilon_min: lots of
        # exploring early on, mostly following the learned policy at the end.
        eps = hp.exploration_rate
        if hp.epsilon_decay and episodes > 1:
            eps = max(hp.epsilon_min, hp.exploration_rate - (hp.exploration_rate - hp.epsilon_min) * e / (episodes - 1))
        s = rng.choice(starts)
        total, n, finished = 0.0, 0, False
        for n in range(1, hp.max_steps + 1):
            row = q[s]
            # Epsilon-greedy action choice.
            if rng.random() < eps:
                a = rng.randrange(4)
            else:
                # Pick the best action. If several tie (common early on, when everything is 0),
                # pick one of them at random. Otherwise the agent would always pick "up" first
                # and keep bumping into the same wall.
                best = max(row)
                a = rng.choice([i for i in range(4) if row[i] == best])
            s2 = trans[s][a]
            finished = s2 == goal
            r = hp.goal_reward if finished else hp.step_reward
            # The Q-learning update (same as the notebook):
            #   target = reward + gamma * (best Q-value available from the next state)
            #   Q[s][a] moves a fraction alpha of the way toward that target.
            # At the goal there is no "next state" to look ahead from, so the target is just the reward.
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
    """Average the per-episode history into at most `max_points` buckets for charting.

    Sending 10,000 raw points to the browser would be slow and noisy. Averaging groups of
    neighbouring episodes keeps the overall shape of the learning curve and smooths out the
    randomness of single episodes.
    """
    rewards, steps = history["rewards"], history["steps"]
    n = len(rewards)
    out = {"episodes": n, "success_rate": round(history["success_rate"], 4)}
    if n <= max_points:
        return {**out, "rewards": [round(v, 3) for v in rewards], "steps": list(steps)}
    bucket = n / max_points  # episodes per point (can be fractional; lo/hi handle the rounding)
    out_r, out_s = [], []
    for i in range(max_points):
        lo, hi = int(i * bucket), int((i + 1) * bucket)
        out_r.append(round(sum(rewards[lo:hi]) / (hi - lo), 3))
        out_s.append(round(sum(steps[lo:hi]) / (hi - lo), 2))
    return {**out, "rewards": out_r, "steps": out_s}


def greedy_path(layout: Layout, q: list[list[float]], start: Cell, dest: Cell, limit: int = 200) -> list[Cell] | None:
    """Follow the table greedily from `start`; None if it loops or runs out of steps before `dest`.

    This is how a trained robot actually drives: always take the highest-valued action, with no
    randomness. If it ever comes back to a cell it already visited, it is stuck in a loop,
    because the same cell always gives the same choice, so we stop and report failure.
    """
    trans = _transitions(layout)
    w = layout.width
    s, goal = state_index(start, w), state_index(dest, w)
    path, seen = [start], {s}
    for _ in range(limit):
        if s == goal:
            return path
        row = q[s]
        s = trans[s][row.index(max(row))]  # best action (first one if tied); then where it leads
        if s in seen:
            return None
        seen.add(s)
        path.append((s % w, s // w))  # back from a state index to (x, y)
    return path if s == goal else None


def evaluate(layout: Layout, q: list[list[float]], dest: Cell) -> dict:
    """How well the greedy policy reaches `dest`: share of cells that arrive, and extra steps over A*.

    - reach_rate: the fraction of floor cells from which following the table actually arrives.
      Cells the agent rarely visited during training may still have bad or blank Q-values.
    - avg_extra_steps: on the successful routes, how many more moves they take than the true
      shortest path (from BFS). 0 means the learned routes are as good as A*.
    """
    dist = distance_map(layout, dest)  # shortest distance from every reachable cell
    starts = [c for c in dist if c != dest]
    reached, extra = 0, 0
    for c in starts:
        path = greedy_path(layout, q, c, dest)
        if path is not None:
            reached += 1
            extra += len(path) - 1 - dist[c]  # len(path) counts cells; moves = cells - 1
    return {
        "cells": len(starts),
        "reach_rate": round(reached / len(starts), 4) if starts else 0.0,
        "avg_extra_steps": round(extra / reached, 3) if reached else None,
    }


def to_notebook_format(q: list[list[float]], dest: Cell, hp: Hyperparameters) -> dict:
    """The model JSON schema from base_reference_model.ipynb (also what the frontend engine imports).

    Keeping this exact shape means a model trained here can be loaded straight into the
    browser simulation, and files from the notebook stay compatible.
    """
    return {
        "q_table": q,
        "actions": list(ACTIONS),
        "goal": [dest[0], dest[1]],
        "step_reward": hp.step_reward,
        "goal_reward": hp.goal_reward,
        "discount_factor": hp.discount_factor,
    }
