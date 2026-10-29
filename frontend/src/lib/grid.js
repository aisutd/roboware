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

export const MAX_SIDE = 40;
export const MIN_SIDE = 4;

// The editor shows the floor inside a ring of "ghost" squares; painting a ghost adds that square.
export function withGhostRing(cells) {
  const width = cells[0].length + 2;
  return [Array(width).fill('ghost'), ...cells.map((row) => ['ghost', ...row, 'ghost']), Array(width).fill('ghost')];
}

// Paint (x, y) given in ring coordinates. Painting outside the floor grows the grid by one row or
// column on that side (new squares start with no floor). Returns the new cells and how far the old
// floor moved, or null when nothing changes or the grid would pass MAX_SIDE.
export function paintGrowing(cells, x, y, brush) {
  const height = cells.length;
  const width = cells[0].length;
  let fx = x - 1;
  let fy = y - 1;
  const outside = fx < 0 || fy < 0 || fx >= width || fy >= height;
  if (outside && brush === 'void') return null;
  if (!outside && cells[fy][fx] === brush) return null;
  const left = fx < 0 ? 1 : 0;
  const top = fy < 0 ? 1 : 0;
  const right = fx >= width ? 1 : 0;
  const bottom = fy >= height ? 1 : 0;
  if (width + left + right > MAX_SIDE || height + top + bottom > MAX_SIDE) return null;
  const nextWidth = width + left + right;
  const next = [
    ...(top ? [Array(nextWidth).fill('void')] : []),
    ...cells.map((row) => [...(left ? ['void'] : []), ...row, ...(right ? ['void'] : [])]),
    ...(bottom ? [Array(nextWidth).fill('void')] : []),
  ];
  fx += left;
  fy += top;
  next[fy][fx] = brush;
  return { cells: next, shift: { x: left, y: top } };
}

// Drop outer rows and columns with no floor at all (never below MIN_SIDE), so saved layouts stay tight.
export function trimVoid(cells) {
  let rows = cells.map((row) => [...row]);
  const empty = (line) => line.every((kind) => kind === 'void');
  while (rows.length > MIN_SIDE && empty(rows[0])) rows = rows.slice(1);
  while (rows.length > MIN_SIDE && empty(rows[rows.length - 1])) rows = rows.slice(0, -1);
  const column = (x) => rows.map((row) => row[x]);
  while (rows[0].length > MIN_SIDE && empty(column(0))) rows = rows.map((row) => row.slice(1));
  while (rows[0].length > MIN_SIDE && empty(column(rows[0].length - 1))) rows = rows.map((row) => row.slice(0, -1));
  return rows;
}

const SIDES = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];

// Receiving bays (unload cells): trucks dock on the outside each bay touches most.
export const findBays = (cells) => findZones(cells, 'unload');
// Drop-off zones (shipping cells): parcels leave through the outside each zone touches most.
export const findShippingZones = (cells) => findZones(cells, 'shipping');

// Zones: groups of touching cells of one kind, each opening on the outside it touches most.
// Outside means off the grid, or empty floor (void, or the editor's ghost ring) connected to the border.
// A zone that touches no outside gets side null (same rule as the backend's Layout.zones).
export function findZones(cells, zoneKind) {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const empty = (kind) => kind === 'void' || kind === 'ghost';
  const exterior = new Set();
  const queue = [];
  cells.forEach((row, y) => row.forEach((kind, x) => {
    if (empty(kind) && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) { exterior.add(cellKey(x, y)); queue.push([x, y]); }
  }));
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of DELTAS) {
      const nx = x + dx;
      const ny = y + dy;
      if (empty(cells[ny]?.[nx]) && !exterior.has(cellKey(nx, ny))) { exterior.add(cellKey(nx, ny)); queue.push([nx, ny]); }
    }
  }
  const outside = (x, y) => x < 0 || y < 0 || x >= width || y >= height || exterior.has(cellKey(x, y));
  const seen = new Set();
  const bays = [];
  cells.forEach((row, y) => row.forEach((kind, x) => {
    if (kind !== zoneKind || seen.has(cellKey(x, y))) return;
    const group = [];
    const stack = [[x, y]];
    seen.add(cellKey(x, y));
    while (stack.length) {
      const [cx, cy] = stack.pop();
      group.push([cx, cy]);
      for (const [dx, dy] of DELTAS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (cells[ny]?.[nx] === zoneKind && !seen.has(cellKey(nx, ny))) { seen.add(cellKey(nx, ny)); stack.push([nx, ny]); }
      }
    }
    group.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let best = null;
    for (const [side, dx, dy] of SIDES) {
      const mouth = group.filter(([cx, cy]) => outside(cx + dx, cy + dy));
      if (mouth.length && (!best || mouth.length > best.mouth.length)) best = { side, mouth };
    }
    bays.push({ cells: group, side: best?.side ?? null, mouth: best?.mouth ?? [] });
  }));
  return bays;
}
