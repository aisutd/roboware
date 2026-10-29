"""Receiving: delivery trucks bring stock to unload bays, where robots pick up pallets for the shelves.

A shelf (one product) runs low -> its refill joins the backlog -> a bay with free floor calls a truck ->
the truck spends a few ticks on the road, backs in, drops one pallet per tick, and drives off. Robots
then carry each pallet to its product's pick face (see Simulator), which puts the stock back.
"""

from __future__ import annotations

from .grid import Layout
from .models import Cell, Pallet, Truck
from .orders import Inventory

ROAD_TICKS = 6  # called, still driving over: shown as an ETA, not on the map yet
ARRIVE_TICKS = 5  # backing in to the bay (the UI animates the drive)
LEAVE_TICKS = 5
GAP_TICKS = 10  # a bay rests this long after a truck leaves before calling the next one
FULL_LOAD = 3  # pallets worth a trip; a truck comes for fewer only when orders wait or the list is getting old
MAX_BATCH_WAIT = 40
MAX_UNLOAD_WAIT = 30  # bay floor still full after this long: take the rest back and come again later
REORDER_POINT = 0.5  # call for more once shelf + incoming stock drops below half the shelf
TRUCK_NAMES = ["Big Bertha", "Rumbles", "Diesel Dot", "Moose", "Clyde", "Gravy Train", "Boxcar Bo", "Old Reliable"]


class Receiving:
    def __init__(self, layout: Layout, inventory: Inventory, capacity: dict[str, int]):
        self.bays = [b for b in layout.bays() if b["side"]]
        self.inventory = inventory
        self.capacity = capacity
        self.pallets: dict[str, Pallet] = {}
        self.trucks: list[Truck] = []
        self.backlog: dict[str, int] = {}
        self.next_call = [0] * len(self.bays)
        self.backlog_since: int | None = None
        self.restocked = 0  # units put back on shelves
        self.deliveries = 0  # trucks that came and went
        self._truck_seq = 0
        self._pallet_seq = 0

    @property
    def active(self) -> bool:
        return bool(self.bays)

    def incoming(self, sku: str, carried: list[Pallet]) -> int:
        """Stock on its way to the shelf: waiting for a truck, on a truck, on a bay, or on a robot."""
        return (self.backlog.get(sku, 0)
                + sum(q for t in self.trucks for s, q in t.cargo if s == sku)
                + sum(p.qty for p in self.pallets.values() if p.sku == sku)
                + sum(p.qty for p in carried if p.sku == sku))

    def free_cells(self, bay: int, occupied: set[Cell]) -> list[Cell]:
        taken = {p.cell for p in self.pallets.values()} | occupied
        mouth = self.bays[bay]["mouth"]
        # Fill from the truck's doors inwards.
        return sorted((c for c in self.bays[bay]["cells"] if c not in taken),
                      key=lambda c: (min(abs(c[0] - m[0]) + abs(c[1] - m[1]) for m in mouth), c[1], c[0]))

    def step(self, tick: int, occupied: set[Cell], carried: list[Pallet], short: set[str], events: list[dict]) -> None:
        if not self.active:
            return
        self._reorder(carried, short)
        if self.backlog and self.backlog_since is None:
            self.backlog_since = tick
        self._call_trucks(tick, short, events)
        for truck in list(self.trucks):
            self._advance(truck, tick, occupied, events)

    def _reorder(self, carried: list[Pallet], short: set[str]) -> None:
        for sku, cap in self.capacity.items():
            have = self.inventory.stock[sku] + self.incoming(sku, carried)
            if have < REORDER_POINT * cap or (sku in short and have <= self.inventory.stock[sku]):
                self.backlog[sku] = self.backlog.get(sku, 0) + max(1, cap - have)

    def _call_trucks(self, tick: int, short: set[str], events: list[dict]) -> None:
        busy = {t.bay for t in self.trucks}
        for bay in range(len(self.bays)):
            if not self.backlog or bay in busy or tick < self.next_call[bay]:
                continue
            room = len(self.free_cells(bay, set()))
            urgent = any(s in short for s in self.backlog) or tick - (self.backlog_since or tick) >= MAX_BATCH_WAIT
            if room == 0 or (len(self.backlog) < min(room, FULL_LOAD) and not urgent):
                continue
            # Emptiest shelves first: biggest refills ride the next truck.
            skus = sorted(self.backlog, key=lambda s: (-self.backlog[s], s))[:room]
            cargo = [(s, self.backlog.pop(s)) for s in skus]
            self.backlog_since = tick if self.backlog else None
            name = TRUCK_NAMES[self._truck_seq % len(TRUCK_NAMES)]
            self._truck_seq += 1
            truck = Truck(f"TRK-{self._truck_seq:03d}", name, bay, cargo, "en_route", ROAD_TICKS, ROAD_TICKS)
            self.trucks.append(truck)
            events.append({"type": "truck_called", "truck": truck.id, "name": name, "bay": bay,
                           "eta": ROAD_TICKS + ARRIVE_TICKS})

    def _advance(self, truck: Truck, tick: int, occupied: set[Cell], events: list[dict]) -> None:
        if truck.state in ("en_route", "arriving", "leaving"):
            truck.timer -= 1
            if truck.timer > 0:
                return
            if truck.state == "en_route":
                truck.state, truck.timer, truck.total = "arriving", ARRIVE_TICKS, ARRIVE_TICKS
                events.append({"type": "truck_arriving", "truck": truck.id, "name": truck.name, "bay": truck.bay})
            elif truck.state == "arriving":
                truck.state, truck.timer, truck.total = "unloading", 0, 0
                events.append({"type": "truck_docked", "truck": truck.id, "name": truck.name, "bay": truck.bay})
            else:
                self.trucks.remove(truck)
                self.deliveries += 1
                self.next_call[truck.bay] = tick + GAP_TICKS
                events.append({"type": "truck_gone", "truck": truck.id, "bay": truck.bay})
            return
        # Unloading: one pallet per tick onto the free floor nearest the doors.
        cells = self.free_cells(truck.bay, occupied)
        if truck.cargo and cells:
            sku, qty = truck.cargo.pop(0)
            self._pallet_seq += 1
            pallet = Pallet(f"PLT-{self._pallet_seq:04d}", sku, qty, cells[0], dropped_tick=tick)
            self.pallets[pallet.id] = pallet
            truck.unloaded += 1
            truck.waited = 0
            events.append({"type": "pallet_dropped", "truck": truck.id, "pallet": pallet.id, "sku": sku, "qty": qty,
                           "at": list(pallet.cell)})
        elif truck.cargo:
            truck.waited += 1
            if truck.waited > MAX_UNLOAD_WAIT:
                for sku, qty in truck.cargo:
                    self.backlog[sku] = self.backlog.get(sku, 0) + qty
                truck.cargo = []
        if not truck.cargo:
            truck.state, truck.timer, truck.total = "leaving", LEAVE_TICKS, LEAVE_TICKS
            events.append({"type": "truck_leaving", "truck": truck.id, "name": truck.name, "bay": truck.bay})

    def open_pallets(self) -> list[Pallet]:
        return [p for p in self.pallets.values() if p.robot_id is None]

    def blocked(self) -> bool:
        """A truck (or the backlog) is waiting because some bay floor is full of pallets."""
        return any(t.state == "unloading" and t.cargo for t in self.trucks) or (
            bool(self.backlog) and all(not self.free_cells(b, set()) for b in range(len(self.bays))))

    def view(self, carried: list[Pallet]) -> dict:
        return {
            "trucks": [t.to_dict() for t in self.trucks],
            "pallets": [p.to_dict() for p in self.pallets.values()],
            "backlog": [{"sku": s, "qty": q} for s, q in self.backlog.items()],
            "incoming": {sku: self.incoming(sku, carried) for sku in self.capacity},
            "restocked": self.restocked,
            "deliveries": self.deliveries,
        }
