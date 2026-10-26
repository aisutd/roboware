import { describe, expect, it } from 'vitest';
import { MAX_SIDE, findBays, findShippingZones, paintGrowing, trimVoid, withGhostRing } from './grid';
import { emptyLayoutHistory, layoutHistoryReducer } from './layoutHistory';

const floor = (w, h) => Array.from({ length: h }, () => Array(w).fill('aisle'));

describe('free-shape floors', () => {
  it('wraps the floor in a ring of ghost squares', () => {
    const ring = withGhostRing(floor(4, 4));
    expect(ring).toHaveLength(6);
    expect(ring[0].every((k) => k === 'ghost') && ring[5][0] === 'ghost' && ring[1][1] === 'aisle').toBe(true);
  });

  it('grows the grid when painting a ghost square, on any side', () => {
    const left = paintGrowing(floor(4, 4), 0, 2, 'rack');
    expect(left.cells[0]).toHaveLength(5);
    expect(left.cells[1][0]).toBe('rack');
    expect(left.cells[0][0]).toBe('void');
    expect(left.shift).toEqual({ x: 1, y: 0 });
    const below = paintGrowing(floor(4, 4), 3, 5, 'aisle');
    expect(below.cells).toHaveLength(5);
    expect(below.cells[4][2]).toBe('aisle');
  });

  it('does not grow for the remove brush or past the size limit', () => {
    expect(paintGrowing(floor(4, 4), 0, 0, 'void')).toBeNull();
    expect(paintGrowing(floor(MAX_SIDE, 4), 0, 2, 'aisle')).toBeNull();
    expect(paintGrowing(floor(4, 4), 1, 1, 'void').cells[0][0]).toBe('void');
  });

  it('trims empty outer rows and columns but keeps at least 4x4', () => {
    const cells = floor(6, 6).map((row, y) => row.map((k, x) => (x === 0 || y === 5 ? 'void' : k)));
    expect(trimVoid(cells)).toEqual(floor(5, 5));
    expect(trimVoid(Array.from({ length: 4 }, () => Array(4).fill('void')))).toHaveLength(4);
  });

  it('undoes a growing stroke in one step', () => {
    let state = layoutHistoryReducer(emptyLayoutHistory, { type: 'load', cells: floor(4, 4) });
    state = layoutHistoryReducer(state, { type: 'grow', x: 5, y: 1, brush: 'aisle', stroke: 7 });
    state = layoutHistoryReducer(state, { type: 'grow', x: 5, y: 2, brush: 'aisle', stroke: 7 });
    expect(state.present[0]).toHaveLength(5);
    expect(layoutHistoryReducer(state, { type: 'undo' }).present).toEqual(floor(4, 4));
  });

  it('grows each side only once per stroke, so a still cursor cannot run away', () => {
    let state = layoutHistoryReducer(emptyLayoutHistory, { type: 'load', cells: floor(4, 4) });
    for (let i = 0; i < 5; i += 1) state = layoutHistoryReducer(state, { type: 'grow', x: 0, y: 2, brush: 'aisle', stroke: 9 });
    expect(state.present[0]).toHaveLength(5);
    state = layoutHistoryReducer(state, { type: 'grow', x: 0, y: 2, brush: 'aisle', stroke: 10 });
    expect(state.present[0]).toHaveLength(6);
  });
});

describe('unload bays', () => {
  const base = () => floor(6, 5);
  it('docks trucks on the outside a bay touches most', () => {
    const cells = base();
    cells[0][1] = cells[0][2] = cells[1][1] = 'unload';
    expect(findBays(cells)).toEqual([{ cells: [[1, 0], [2, 0], [1, 1]], side: 'up', mouth: [[1, 0], [2, 0]] }]);
  });
  it('rejects bays in the middle of the floor or beside an inner hole', () => {
    const middle = base();
    middle[2][2] = 'unload';
    expect(findBays(middle)[0].side).toBeNull();
    middle[2][3] = 'void';
    expect(findBays(middle)[0].side).toBeNull();
  });
  it('counts empty floor that opens to the border, and the editor ring, as outside', () => {
    const notch = base();
    notch[0][3] = 'void';
    notch[1][3] = 'unload';
    expect(findBays(notch)[0].side).toBe('up');
    const ring = withGhostRing(base());
    ring[3][1] = 'unload';
    expect(findBays(ring)[0].side).toBe('left');
  });
});

describe('drop-off zones', () => {
  it('open to the outside like bays, separate from dock stations and unload bays', () => {
    const cells = floor(6, 5);
    cells[4][4] = cells[4][5] = 'shipping';
    cells[2][2] = 'dock';
    cells[0][0] = 'unload';
    expect(findShippingZones(cells)).toEqual([{ cells: [[4, 4], [5, 4]], side: 'down', mouth: [[4, 4], [5, 4]] }]);
    expect(findBays(cells)).toHaveLength(1);
    cells[2][3] = 'shipping';
    expect(findShippingZones(cells).find((z) => z.cells.length === 1).side).toBeNull();
  });
});
