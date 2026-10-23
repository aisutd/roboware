"""Per-tick move arbitration: robots claim cells in priority order; losers wait."""

from __future__ import annotations

from .models import Cell


def resolve_moves(positions: dict[str, Cell], intents: dict[str, Cell],
                  priority: dict[str, tuple]) -> tuple[dict[str, Cell], set[str]]:
    occupant = {pos: rid for rid, pos in positions.items()}
    claimed: set[Cell] = set()
    moves: dict[str, Cell] = {}
    yielded: set[str] = set()
    for rid in sorted(intents, key=lambda r: priority[r]):
        target = intents[rid]
        other = occupant.get(target)
        blocked_by_stayer = other is not None and other != rid and other not in intents
        head_on = other is not None and other != rid and intents.get(other) == positions[rid]
        if target in claimed or blocked_by_stayer or head_on:
            yielded.add(rid)
            continue
        claimed.add(target)
        moves[rid] = target
    # A robot cannot move into a cell whose robot ends up staying; repeat until stable.
    changed = True
    while changed:
        changed = False
        staying = {positions[rid] for rid in positions if rid not in moves}
        for rid, target in list(moves.items()):
            if target in staying:
                del moves[rid]
                yielded.add(rid)
                changed = True
    return moves, yielded
