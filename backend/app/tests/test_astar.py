from app.simulation.astar import distance_map, find_path
from app.simulation.grid import default_layout


def test_path_goes_around_racks_and_is_shortest():
    layout = default_layout()
    path = find_path(layout, (3, 2), (6, 2))
    assert path[0] == (3, 2) and path[-1] == (6, 2)
    assert all(layout.driveable(c) for c in path)
    assert len(path) - 1 == distance_map(layout, (6, 2))[(3, 2)]


def test_unreachable_goal_returns_none():
    layout = default_layout()
    assert find_path(layout, (0, 0), (4, 1)) is None  # (4, 1) is a rack
    assert find_path(layout, (0, 0), (6, 4), blocked={(6, 4)}) is None
