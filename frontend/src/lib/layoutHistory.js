import { paintGrowing } from './grid';

export const emptyLayoutHistory = { present: null, past: [], future: [], stroke: null };

export function layoutHistoryReducer(state, action) {
  if (action.type === 'load') return { present: action.cells, past: [], future: [], stroke: null };
  if (action.type === 'undo' && state.past.length) return {
    present: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.present, ...state.future], stroke: null,
  };
  if (action.type === 'redo' && state.future.length) return {
    present: state.future[0], past: [...state.past, state.present].slice(-100), future: state.future.slice(1), stroke: null,
  };
  if (action.type === 'paint' && state.present?.[action.y]?.[action.x] !== undefined && state.present[action.y][action.x] !== action.brush) {
    const next = state.present.map((row) => [...row]);
    next[action.y][action.x] = action.brush;
    const sameStroke = action.stroke != null && action.stroke === state.stroke;
    return { present: next, past: sameStroke ? state.past : [...state.past, state.present].slice(-100), future: [], stroke: action.stroke ?? null };
  }
  // grow: paint in editor ring coordinates; painting just outside the floor adds that square.
  // Each side grows at most once per stroke: growing left or up slides the floor under a still cursor,
  // which would otherwise keep landing on fresh ghost squares and run away.
  if (action.type === 'grow' && state.present) {
    const sameStroke = action.stroke != null && action.stroke === state.stroke;
    const grown = sameStroke ? state.grown ?? '' : '';
    const result = paintGrowing(state.present, action.x, action.y, action.brush);
    if (!result) return state;
    const sides = [result.shift.x && 'L', result.shift.y && 'T',
      result.cells[0].length - result.shift.x > state.present[0].length && 'R',
      result.cells.length - result.shift.y > state.present.length && 'B'].filter(Boolean).join('');
    if ([...sides].some((side) => grown.includes(side))) return state;
    return {
      present: result.cells, past: sameStroke ? state.past : [...state.past, state.present].slice(-100), future: [],
      stroke: action.stroke ?? null, grown: grown + sides,
    };
  }
  // set: a whole new grid (the floor grew); strokes still undo in one step.
  if (action.type === 'set' && state.present) {
    const sameStroke = action.stroke != null && action.stroke === state.stroke;
    return { present: action.cells, past: sameStroke ? state.past : [...state.past, state.present].slice(-100), future: [], stroke: action.stroke ?? null };
  }
  if (action.type === 'replace' && state.present) return { present: action.cells, past: [...state.past, state.present].slice(-100), future: [], stroke: null };
  return state;
}
