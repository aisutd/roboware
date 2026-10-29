// Geometry and looks for delivery trucks docking at unload bays (see backend simulation/receiving.py).
import { hashString } from './robotNames';

export const TRUCK_UNIT = 3.5; // px per truck sprite unit
export const TRUCK_LENGTH = 48 * TRUCK_UNIT; // the sprite is 16 x 48 units, rear doors at the bottom
export const TRUCK_ROOM = Math.round(TRUCK_LENGTH + 24); // floor-side room the map leaves for a docked truck

const PAINT = ['#e4b366', '#e0715c', '#5aa9e0', '#7fd8a6', '#b6a0d5', '#f2c14e'];
export const truckPaint = (name) => PAINT[hashString(name ?? '') % PAINT.length];

// Rotation that turns a truck drawn "pointing up, rear at the origin" to back into a bay from `side`.
const ROTATION = { up: 0, right: 90, down: 180, left: -90 };
// Unit vector from the bay out towards the road.
export const OUTWARD = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// Where a bay's truck docks, in grid pixels: the middle of the bay's outer edge, the rotation, and how
// wide the bay mouth is.
export function dockAnchor(bay, pitch, gap) {
  const xs = bay.mouth.map((c) => c[0]);
  const ys = bay.mouth.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = ((minX + maxX + 1) * pitch - gap) / 2;
  const cy = ((minY + maxY + 1) * pitch - gap) / 2;
  const edge = gap / 2 + 2;
  switch (bay.side) {
    case 'up': return { x: cx, y: minY * pitch - edge, rotate: ROTATION.up, span: (maxX - minX + 1) * pitch - gap };
    case 'down': return { x: cx, y: (maxY + 1) * pitch - gap + edge, rotate: ROTATION.down, span: (maxX - minX + 1) * pitch - gap };
    case 'left': return { x: minX * pitch - edge, y: cy, rotate: ROTATION.left, span: (maxY - minY + 1) * pitch - gap };
    default: return { x: (maxX + 1) * pitch - gap + edge, y: cy, rotate: ROTATION.right, span: (maxY - minY + 1) * pitch - gap };
  }
}

// Which sides of the floor need room for trucks.
export const truckSides = (bays) => new Set(bays.filter((b) => b.side).map((b) => b.side));
