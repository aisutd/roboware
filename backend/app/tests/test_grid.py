import pytest

from app.simulation.grid import (
    AISLE,
    CHARGER,
    DOCK,
    PACKING,
    RACK,
    SHIPPING,
    UNLOAD,
    VOID,
    Layout,
    LayoutError,
    assign_products,
    default_layout,
)


def test_default_layout_matches_original_coordinates():
    layout = default_layout()
    assert (layout.width, layout.height) == (16, 10)
    assert len(layout.cells_of(RACK)) == 36
    assert layout.cell_type((4, 1)) == RACK
    assert layout.cell_type((11, 7)) == RACK
    assert layout.cells_of(PACKING) == [(14, 2), (14, 5)]
    assert layout.cells_of(DOCK) == []
    assert layout.cells_of(SHIPPING) == [(14, 8), (15, 8), (14, 9), (15, 9)]
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
    assert all(8 <= p.capacity <= 16 and 2 <= p.stock <= p.capacity for p in layout.products)
    assert any(p.stock < p.capacity / 2 for p in layout.products)  # some shelves start low: the first truck comes early
    assert layout.products[0].sku == "SKU-001"
    assert len(layout.destinations()) == 38  # 24 faces + 2 packing + 4 drop-off + 2 chargers + 6 unload


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


def test_validate_requires_a_dock_or_drop_off_zone():
    layout = default_layout()
    for x, y in layout.drop_offs():
        layout.cells[y][x] = "aisle"
    with pytest.raises(LayoutError, match="shipping dock or drop-off zone"):
        layout.validate()
    layout.cells[5][13] = DOCK  # a dock station works anywhere on the floor
    layout.validate()


def test_shipping_zones_open_to_the_outside():
    layout = default_layout()
    assert layout.shipping_zones() == [{"cells": [(14, 8), (15, 8), (14, 9), (15, 9)], "side": "down",
                                        "mouth": [(14, 9), (15, 9)]}]
    for x, y in layout.cells_of(SHIPPING):
        layout.cells[y][x] = "aisle"
    layout.cells[5][13] = SHIPPING  # in the middle of the floor: parcels have nowhere to go
    with pytest.raises(LayoutError, match="Drop-off zones must touch the outside edge") as err:
        layout.validate()
    assert err.value.unreachable == [(13, 5)]


def test_dict_roundtrip_and_bad_cell_type():
    layout = default_layout()
    again = Layout.from_dict(layout.to_dict())
    assert again.fingerprint() == layout.fingerprint()
    assert [p.to_dict() for p in again.products] == [p.to_dict() for p in layout.products]
    data = layout.to_dict()
    data["cells"][0][0] = "lava"
    with pytest.raises(LayoutError, match="Unknown cell type"):
        Layout.from_dict(data)


def test_bays_dock_on_the_outside_they_touch_most():
    layout = default_layout()
    assert layout.bays() == [{"cells": [(0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1)], "side": "up",
                              "mouth": [(0, 0), (1, 0), (2, 0)]}]


def test_unload_bays_must_touch_the_outside():
    def build(extra):
        cells = [[AISLE] * 8 for _ in range(6)]
        cells[5][0], cells[5][7], cells[3][7] = CHARGER, PACKING, DOCK
        cells[4][2] = RACK
        for (x, y), kind in extra.items():
            cells[y][x] = kind
        layout = Layout(8, 6, cells)
        layout.products = assign_products(layout)
        return layout

    with pytest.raises(LayoutError, match="unload bay"):
        build({}).validate()
    with pytest.raises(LayoutError, match="outside edge") as err:
        build({(3, 2): UNLOAD}).validate()  # in the middle of the floor
    assert err.value.unreachable == [(3, 2)]
    # Next to a hole in the floor is still inside the warehouse...
    with pytest.raises(LayoutError, match="outside edge"):
        build({(3, 2): UNLOAD, (4, 2): VOID}).validate()
    # ...but empty floor that opens to the grid border counts as outside, so a notch works.
    notch = build({(3, 1): UNLOAD, (3, 0): VOID})
    notch.validate()
    assert notch.bays()[0]["side"] == "up"
    build({(7, 0): UNLOAD, (7, 1): UNLOAD}).validate()
