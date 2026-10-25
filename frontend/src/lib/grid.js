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

export function createBlueprintCells(width, height) {
  if (![width, height].every((value) => Number.isInteger(value) && value >= 4 && value <= 40)) {
    throw new RangeError('Width and height must be whole numbers from 4 to 40 cells.');
  }
  return Array.from({ length: height }, () => Array(width).fill('aisle'));
}

// Fill cells between sampled mouse positions so fast drags leave no gaps.
export function cellsOnLine(from, to) {
  let [x, y] = from;
  const [endX, endY] = to;
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const sx = x < endX ? 1 : -1;
  const sy = y < endY ? 1 : -1;
  let error = dx + dy;
  const cells = [];
  while (true) {
    cells.push([x, y]);
    if (x === endX && y === endY) return cells;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}
