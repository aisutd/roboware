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
  if (action.type === 'replace' && state.present) return { present: action.cells, past: [...state.past, state.present].slice(-100), future: [], stroke: null };
  return state;
}
