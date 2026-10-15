import { describe, expect, it } from 'vitest';
import { coordLabel, colLabel, pickFaces } from './grid';

describe('grid helpers', () => {
  it('labels columns like a spreadsheet', () => {
    expect(colLabel(0)).toBe('A');
    expect(colLabel(25)).toBe('Z');
    expect(colLabel(26)).toBe('AA');
    expect(coordLabel(3, 0)).toBe('D1');
  });

  it('finds aisle cells next to racks', () => {
    const cells = [
      ['aisle', 'rack', 'aisle'],
      ['aisle', 'aisle', 'dock'],
    ];
    expect(pickFaces(cells)).toEqual([[0, 0], [2, 0], [1, 1]]);
  });
});
