import pytest

from app.simulation.grid import (
    CHARGER,
    DOCK,
    PACKING,
    RACK,
    Layout,
    LayoutError,
    default_layout,
)


def test_default_layout_matches_original_coordinates():
    layout = default_layout()
    assert (layout.width, layout.height) == (16, 10)
    assert len(layout.cells_of(RACK)) == 36
    assert layout.cell_type((4, 1)) == RACK
    assert layout.cell_type((11, 7)) == RACK
    assert layout.cells_of(PACKING) == [(14, 2), (14, 5)]
    assert layout.cells_of(DOCK) == [(14, 8)]
    assert layout.cells_of(CHARGER) == [(0, 2), (0, 7)]


def test_pick_faces_are_aisle_cells_next_to_racks():
    faces = default_layout().pick_faces()
    assert len(faces) == 42
    assert (3, 1) in faces and (4, 4) in faces and (12, 7) in faces and (4, 0) in faces
    assert (0, 0) not in faces
    assert (4, 1) not in faces  # a rack, not a face


def test_default_products_sit_on_distinct_faces():
    layout = default_layout()
    assert len(layout.products) == 24
    assert len({p.face for p in layout.products}) == 24
    assert all(20 <= p.stock <= 40 for p in layout.products)
    assert layout.products[0].sku == "SKU-001"
    assert len(layout.destinations()) == 29  # 24 faces + 2 packing + 1 dock + 2 chargers


def test_driveable_and_neighbors():
    layout = default_layout()
    assert layout.driveable((0, 0))
    assert not layout.driveable((4, 1))
    assert not layout.driveable((-1, 0))
    assert not layout.driveable((16, 0))
    assert set(layout.neighbors((3, 1))) == {(3, 0), (3, 2), (2, 1)}


def test_fingerprint_is_stable_and_tracks_cells():
    a, b = default_layout(), default_layout()
    assert a.fingerprint() == b.fingerprint()
    b.cells[0][0] = RACK
    assert a.fingerprint() != b.fingerprint()


def test_validate_rejects_sealed_off_dock():
    layout = default_layout()
    layout.validate()
    for x, y in [(13, 8), (15, 8), (14, 7), (14, 9)]:
        layout.cells[y][x] = RACK
    with pytest.raises(LayoutError) as err:
        layout.validate()
    assert (14, 8) in err.value.unreachable


def test_validate_requires_a_dock():
    layout = default_layout()
    layout.cells[8][14] = "aisle"
    with pytest.raises(LayoutError, match="shipping dock"):
        layout.validate()


def test_dict_roundtrip_and_bad_cell_type():
    layout = default_layout()
    again = Layout.from_dict(layout.to_dict())
    assert again.fingerprint() == layout.fingerprint()
    assert [p.to_dict() for p in again.products] == [p.to_dict() for p in layout.products]
    data = layout.to_dict()
    data["cells"][0][0] = "lava"
    with pytest.raises(LayoutError, match="Unknown cell type"):
        Layout.from_dict(data)
