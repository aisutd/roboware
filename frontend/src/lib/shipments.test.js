import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from './pixelArt';
import { DOOR_CLEAR_SECONDS, VAN_SECONDS, scheduleVans, vansOverlap } from './shipments';

// 6x4 floor with a 2-wide drop-off zone on the bottom edge and a dock station in the middle.
const cells = Array.from({ length: 4 }, () => Array(6).fill('aisle'));
cells[3][1] = cells[3][2] = 'shipping';
cells[1][3] = 'dock';
const layout = { cells };
const delivered = (order, x, y) => ({ type: 'delivered', order, at: [x, y] });

describe('delivery vans', () => {
  it('sends simultaneous vans out of different doors', () => {
    const vans = scheduleVans([], [delivered('A', 1, 3), delivered('B', 1, 3)], 10, layout);
    expect(vans.map((v) => v.door)).toEqual([[1, 3], [2, 3]]);
    expect(vans.every((v) => v.delay === 0 && v.side === 'down')).toBe(true);
  });

  it('holds a van back when every door is busy, so it never overlaps the one ahead', () => {
    let vans = scheduleVans([], [delivered('A', 1, 3), delivered('B', 2, 3), delivered('C', 1, 3)], 10, layout);
    expect(vans[2].delay).toBeCloseTo(DOOR_CLEAR_SECONDS, 1);
    expect(vansOverlap(vans)).toBe(false);
    // Next tick, more drop-offs: still no overlap and earlier vans keep their door and timing.
    const before = JSON.stringify(vans);
    vans = scheduleVans(vans, [delivered('D', 2, 3), delivered('E', 1, 3)], 11, layout);
    expect(JSON.stringify(vans.slice(0, 3))).toBe(before);
    expect(vansOverlap(vans)).toBe(false);
  });

  it('never overlaps under a stream of random deliveries', () => {
    let vans = [];
    let all = [];
    for (let tick = 1; tick <= 300; tick += 1) {
      const events = Array.from({ length: (tick * 7) % 4 === 0 ? 2 : tick % 3 === 0 ? 1 : 0 }, (_, i) => delivered(`O${tick}-${i}`, 1 + ((tick + i) % 2), 3));
      vans = scheduleVans(vans, events, tick, layout);
      all = [...all.filter((v) => !vans.includes(v)), ...vans];
      expect(vansOverlap(vans)).toBe(false);
    }
    expect(all.length).toBeGreaterThan(0);
  });

  it('borrows a door from an adjacent drop-off zone when its own zone is busy', () => {
    // Two one-square zones on the bottom edge, split by a rack; a third far away on the left edge.
    const split = Array.from({ length: 5 }, () => Array(9).fill('aisle'));
    split[4][2] = 'shipping';
    split[4][3] = 'rack';
    split[4][4] = 'shipping';
    split[1][0] = 'shipping';
    const map = { cells: split };
    const vans = scheduleVans([], [delivered('A', 2, 4), delivered('B', 2, 4), delivered('C', 2, 4)], 10, map);
    expect(vans.map((v) => v.door)).toEqual([[2, 4], [4, 4], [2, 4]]);
    expect(vans.map((v) => v.delay)).toEqual([0, 0, DOOR_CLEAR_SECONDS]);
    expect(vans[1].side).toBe('down');
    expect(vansOverlap(vans)).toBe(false);
    // The far zone is not adjacent, so it is never borrowed.
    expect(vans.some((v) => v.door[0] === 0)).toBe(false);
  });

  it('skips dock stations and lets finished vans go', () => {
    expect(scheduleVans([], [delivered('A', 3, 1)], 5, layout)).toEqual([]);
    const vans = scheduleVans([], [delivered('A', 1, 3)], 5, layout);
    const later = 5 + Math.ceil((VAN_SECONDS + 0.3) / TICK_SECONDS);
    expect(scheduleVans(vans, [], later, layout)).toEqual([]);
  });
});
