"""Grid search on a Layout: A* paths and BFS distance maps."""

from __future__ import annotations

import heapq
from collections import deque

from .grid import Layout
from .models import Cell


def manhattan(a: Cell, b: Cell) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def find_path(layout: Layout, start: Cell, goal: Cell, blocked: frozenset | set = frozenset()) -> list[Cell] | None:
    """Shortest 4-connected path from start to goal (both included), or None if unreachable."""
    if start == goal:
        return [start]
    if not layout.driveable(goal) or goal in blocked:
        return None
    came_from: dict[Cell, Cell | None] = {start: None}
    g_score = {start: 0}
    heap = [(manhattan(start, goal), 0, start)]
    while heap:
        _, g, current = heapq.heappop(heap)
        if current == goal:
            break
        if g > g_score[current]:
            continue
        for n in layout.neighbors(current):
            if n in blocked:
                continue
            if g + 1 < g_score.get(n, 1 << 30):
                g_score[n] = g + 1
                came_from[n] = current
                heapq.heappush(heap, (g + 1 + manhattan(n, goal), g + 1, n))
    else:
        return None
    path = []
    cell: Cell | None = goal
    while cell is not None:
        path.append(cell)
        cell = came_from[cell]
    return path[::-1]


def distance_map(layout: Layout, target: Cell) -> dict[Cell, int]:
    """Step distance from every reachable cell to `target`."""
    if not layout.driveable(target):
        return {}
    dist = {target: 0}
    queue = deque([target])
    while queue:
        cell = queue.popleft()
        for n in layout.neighbors(cell):
            if n not in dist:
                dist[n] = dist[cell] + 1
                queue.append(n)
    return dist
