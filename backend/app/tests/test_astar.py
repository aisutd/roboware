from app.simulation.astar import distance_map, find_path, manhattan
from app.simulation.grid import RACK, default_layout


def test_open_route_is_manhattan_length():
    path = find_path(default_layout(), (0, 0), (14, 8))
    assert path[0] == (0, 0) and path[-1] == (14, 8)
    assert len(path) - 1 == 22
    assert all(manhattan(a, b) == 1 for a, b in zip(path, path[1:]))


def test_route_goes_around_a_rack_bay():
    path = find_path(default_layout(), (3, 2), (6, 2))
    assert len(path) - 1 == 7
    assert all(default_layout().driveable(c) for c in path)


def test_no_path_into_a_rack_or_sealed_cell():
    layout = default_layout()
    assert find_path(layout, (0, 0), (4, 1)) is None
    for x, y in [(13, 8), (15, 8), (14, 7), (14, 9)]:
        layout.cells[y][x] = RACK
    assert find_path(layout, (0, 0), (14, 8)) is None


def test_blocked_cells_are_avoided():
    path = find_path(default_layout(), (0, 0), (2, 0), blocked=frozenset({(1, 0)}))
    assert (1, 0) not in path
    assert len(path) - 1 == 4


def test_same_cell_path():
    assert find_path(default_layout(), (2, 2), (2, 2)) == [(2, 2)]


def test_distance_map_agrees_with_find_path():
    layout = default_layout()
    dist = distance_map(layout, (14, 8))
    assert dist[(14, 8)] == 0
    assert dist[(0, 0)] == 22
    assert dist[(3, 2)] == len(find_path(layout, (3, 2), (14, 8))) - 1
    assert (4, 1) not in dist
