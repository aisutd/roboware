from app.simulation.grid import CHARGER, DOCK, PACKING, RACK, default_layout


def test_default_layout_matches_the_frontend_prototype():
    layout = default_layout()
    assert (layout.width, layout.height) == (16, 10)
    assert len(layout.cells_of(RACK)) == 36
    assert layout.cells_of(PACKING) == [(14, 2), (14, 5)]
    assert layout.cells_of(DOCK) == [(14, 8)]
    assert sorted(layout.cells_of(CHARGER)) == [(0, 2), (0, 7)]


def test_racks_are_not_driveable_and_edges_are_out_of_bounds():
    layout = default_layout()
    assert not layout.driveable((4, 1))
    assert layout.driveable((6, 1))
    assert not layout.driveable((-1, 0)) and not layout.driveable((16, 0))


def test_every_destination_is_reachable():
    layout = default_layout()
    layout.validate()
    assert (14, 8) in layout.destinations()
    assert len(layout.products) == 24
