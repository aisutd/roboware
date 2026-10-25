import { describe, expect, it } from 'vitest';
import { emptyLayoutHistory, layoutHistoryReducer as reduce } from './layoutHistory';

describe('layout editing history', () => {
  it('undoes and redoes paint without mutating the loaded layout', () => {
    const original = [['aisle', 'rack']];
    const loaded = reduce(emptyLayoutHistory, { type: 'load', cells: original });
    const painted = reduce(loaded, { type: 'paint', x: 0, y: 0, brush: 'charger' });
    expect(original[0][0]).toBe('aisle');
    const undone = reduce(painted, { type: 'undo' });
    expect(undone.present).toEqual(original);
    expect(reduce(undone, { type: 'redo' }).present[0][0]).toBe('charger');
    expect(reduce(undone, { type: 'paint', x: 0, y: 0, brush: 'packing' }).future).toHaveLength(0);
  });
  it('ignores no-op paint and resets history after loading a different layout', () => {
    const state = reduce(emptyLayoutHistory, { type: 'load', cells: [['rack']] });
    expect(reduce(state, { type: 'paint', x: 0, y: 0, brush: 'rack' })).toBe(state);
    expect(reduce(state, { type: 'undo' })).toBe(state);
    expect(reduce(state, { type: 'load', cells: [['aisle']] }).past).toHaveLength(0);
  });
});
