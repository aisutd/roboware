import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { describe, expect, it } from 'vitest';
import { cellsOnLine, createBlueprintCells } from './grid';
import { emptyLayoutHistory, layoutHistoryReducer as reduce } from './layoutHistory';

describe('custom warehouse blueprints', () => {
  it('creates independent walkable rows at the supported dimension boundaries', () => {
    const cells = createBlueprintCells(40, 4);
    expect(cells).toHaveLength(4);
    expect(cells.every((row) => row.length === 40 && row.every((cell) => cell === 'aisle'))).toBe(true);
    cells[0][0] = 'rack';
    expect(cells[1][0]).toBe('aisle');
    expect(createBlueprintCells(4, 40)).toHaveLength(40);
  });
  it('renders custom dimensions and coordinates beyond column Z without changing logical cell count', () => {
    const layout = { width: 40, height: 4, cells: createBlueprintCells(40, 4), products: [], pick_faces: [] };
    const html = renderToStaticMarkup(createElement(WarehouseMapCanvas, { layout }));
    expect(html.match(/class="tile-base tile-cell/g)).toHaveLength(160);
    expect(html).toContain('>AN</div>');
    expect(html).toContain('grid-template-columns:repeat(40, 56px)');
    expect(html).toContain('grid-template-rows:repeat(4, 56px)');
  });
  it('rejects out-of-range and fractional dimensions instead of silently rounding them', () => {
    for (const [width, height] of [[3, 10], [41, 10], [4, 3], [4, 41], [4.5, 10], [4, NaN], [0, 10]]) {
      expect(() => createBlueprintCells(width, height)).toThrow('4 to 40');
    }
  });
  it('fills fast horizontal, vertical and diagonal drags without missing cells', () => {
    expect(cellsOnLine([0, 2], [39, 2])).toHaveLength(40);
    expect(cellsOnLine([3, 0], [3, 39])).toHaveLength(40);
    expect(cellsOnLine([3, 3], [0, 0])).toEqual([[3, 3], [2, 2], [1, 1], [0, 0]]);
    expect(cellsOnLine([1, 1], [1, 1])).toEqual([[1, 1]]);
  });
  it('undoes and redoes an entire drag stroke, without modifying the baseline', () => {
    const original = createBlueprintCells(8, 4);
    let state = reduce(emptyLayoutHistory, { type: 'load', cells: original });
    for (const [x, y] of cellsOnLine([0, 0], [7, 0])) state = reduce(state, { type: 'paint', x, y, brush: 'rack', stroke: 1 });
    expect(state.past).toHaveLength(1);
    expect(state.present[0].every((cell) => cell === 'rack')).toBe(true);
    state = reduce(state, { type: 'undo' });
    expect(state.present).toEqual(original);
    state = reduce(state, { type: 'redo' });
    expect(state.present[0].every((cell) => cell === 'rack')).toBe(true);
    state = reduce(state, { type: 'paint', x: 0, y: 1, brush: 'charger', stroke: 2 });
    expect(state.past).toHaveLength(2);
    expect(original[0][0]).toBe('aisle');
    expect(reduce(state, { type: 'paint', x: 40, y: 40, brush: 'rack', stroke: 3 })).toBe(state);
  });
});
