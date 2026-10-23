// Grid helpers shared by the map, inspector and layout editor.
export const ACTIONS = ['up', 'down', 'left', 'right'];
export const ACTION_ARROWS = { up: '↑', down: '↓', left: '←', right: '→' };
const DELTAS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export function colLabel(x) {
  let label = '';
  let n = x + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export const coordLabel = (x, y) => `${colLabel(x)}${y + 1}`;
export const cellKey = (x, y) => `${x},${y}`;

export function pickFaces(cells) {
  const faces = [];
  cells.forEach((row, y) => row.forEach((kind, x) => {
    if (kind !== 'aisle') return;
    const nextToRack = DELTAS.some(([dx, dy]) => cells[y + dy]?.[x + dx] === 'rack');
    if (nextToRack) faces.push([x, y]);
  }));
  return faces;
}
