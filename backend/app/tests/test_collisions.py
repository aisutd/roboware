import random

from app.simulation.collisions import resolve_moves
from app.simulation.grid import default_layout


def test_higher_priority_wins_a_contested_cell():
    moves, yielded = resolve_moves({"A": (0, 0), "B": (2, 0)}, {"A": (1, 0), "B": (1, 0)}, {"A": (1,), "B": (0,)})
    assert moves == {"B": (1, 0)} and yielded == {"A"}


def test_head_on_swap_is_refused():
    moves, yielded = resolve_moves({"A": (0, 0), "B": (1, 0)}, {"A": (1, 0), "B": (0, 0)}, {"A": (0,), "B": (1,)})
    assert moves == {} and yielded == {"A", "B"}


def test_following_into_a_vacated_cell_is_allowed():
    moves, yielded = resolve_moves({"A": (0, 0), "B": (1, 0)}, {"A": (1, 0), "B": (2, 0)}, {"A": (0,), "B": (1,)})
    assert moves == {"A": (1, 0), "B": (2, 0)} and yielded == set()


def test_blocked_chain_waits_together():
    positions = {"A": (0, 0), "B": (1, 0), "C": (2, 0)}
    moves, yielded = resolve_moves(positions, {"A": (1, 0), "B": (2, 0)}, {"A": (0,), "B": (1,), "C": (2,)})
    assert moves == {} and yielded == {"A", "B"}


def test_no_overlaps_or_swaps_over_many_random_ticks():
    layout = default_layout()
    rng = random.Random(0)
    free = [(x, y) for y in range(10) for x in range(16) if layout.driveable((x, y))]
    positions = {f"R{i}": c for i, c in enumerate(rng.sample(free, 8))}
    for _ in range(1000):
        intents = {}
        for rid, pos in positions.items():
            options = layout.neighbors(pos)
            if options and rng.random() < 0.9:
                intents[rid] = rng.choice(options)
        priority = {rid: (rng.random(),) for rid in positions}
        moves, yielded = resolve_moves(positions, intents, priority)
        assert set(moves) | yielded == set(intents)
        for a, ta in moves.items():
            for b, tb in moves.items():
                if a != b:
                    assert not (ta == positions[b] and tb == positions[a])
        positions = {rid: moves.get(rid, pos) for rid, pos in positions.items()}
        assert len(set(positions.values())) == len(positions)
