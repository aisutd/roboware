"""Grid search on a Layout: A* paths and BFS distance maps.

A* is the "classic" way to route a robot, and it is guaranteed to find the shortest path.
We use it as the yardstick for the Q-learning agent: a good learned policy should get to the
goal in (almost) the same number of steps as A*.
"""

from __future__ import annotations

import heapq
from collections import deque

from .grid import Layout
from .models import Cell


def manhattan(a: Cell, b: Cell) -> int:
    """Grid distance ignoring obstacles: how many up/down/left/right moves if nothing were in the way.

    A* uses it as its heuristic. It never overestimates the real distance (robots can't move
    diagonally), which is what guarantees A* still finds the shortest path.
    """
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def find_path(layout: Layout, start: Cell, goal: Cell, blocked: frozenset | set = frozenset()) -> list[Cell] | None:
    """Shortest 4-connected path from start to goal (both included), or None if unreachable.

    `blocked` lets the caller mark extra cells as off-limits (e.g. cells other robots are in).
    """
    if start == goal:
        return [start]
    if not layout.driveable(goal) or goal in blocked:
        return None

    # came_from[cell] = the cell we stepped from to reach it; used to rebuild the path at the end.
    came_from: dict[Cell, Cell | None] = {start: None}
    # g_score[cell] = the fewest steps found so far from start to that cell.
    g_score = {start: 0}
    # Priority queue ordered by f = g + heuristic, so the most promising cell is explored first.
    # Entries are (f, g, cell); g breaks ties in favour of cells reached in fewer steps.
    heap = [(manhattan(start, goal), 0, start)]
    while heap:
        _, g, current = heapq.heappop(heap)
        if current == goal:
            break
        # The same cell can sit in the heap several times; skip stale entries with a worse g.
        if g > g_score[current]:
            continue
        for n in layout.neighbors(current):
            if n in blocked:
                continue
            # Found a shorter way to n: remember it and queue n for exploration.
            if g + 1 < g_score.get(n, 1 << 30):
                g_score[n] = g + 1
                came_from[n] = current
                heapq.heappush(heap, (g + 1 + manhattan(n, goal), g + 1, n))
    else:
        # The while loop ran out of cells without hitting `break`: the goal can't be reached.
        return None

    # Walk backwards from the goal through came_from, then reverse to get start -> goal.
    path = []
    cell: Cell | None = goal
    while cell is not None:
        path.append(cell)
        cell = came_from[cell]
    return path[::-1]


def distance_map(layout: Layout, target: Cell) -> dict[Cell, int]:
    """Step distance from every reachable cell to `target`.

    This is a breadth-first search (BFS) that starts at the target and spreads outward one ring
    at a time, so each cell's number is its true shortest distance. One BFS gives the answer for
    every start cell at once, which is much cheaper than running A* from each cell.
    """
    if not layout.driveable(target):
        return {}
    dist = {target: 0}
    queue = deque([target])
    while queue:
        cell = queue.popleft()
        for n in layout.neighbors(cell):
            if n not in dist:  # first visit = shortest distance, because BFS goes ring by ring
                dist[n] = dist[cell] + 1
                queue.append(n)
    return dist
