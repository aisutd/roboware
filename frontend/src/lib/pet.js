// Warehouse droid sprite: which face and pose to show for what the robot is doing (drawn in RobotPet.jsx).

const GLANCE = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
const WALKING = new Set(['to_pick', 'to_pack', 'to_dock', 'to_charger', 'parking', 'to_unload', 'to_shelf']);

// How long (in ticks) a robot stays happy after picking, packing, delivering or finishing a charge.
export const CHEER_TICKS = 3;

export const isWalking = (robot) => WALKING.has(robot.status) && !robot.yielding;

// Same order as the backend's ROBOT_COLORS, so a preview robot matches the one that appears on the floor.
export const ROBOT_COLORS = ['#FF5A26', '#2563EB', '#10B981', '#9333EA', '#E11D48', '#0891B2', '#CA8A04', '#4B5563'];

// Robots with nothing to do doze off (faded colour, closed eyes, "zzZ") until they get work.
export const isSnoozing = (robot) => robot.status === 'idle' && !robot.order_id && !robot.yielding;

export function petMood(robot, cheer, tick) {
  if (cheer && tick - cheer.tick <= CHEER_TICKS) return 'happy';
  if (robot.status === 'charging') return 'charge';
  if (robot.yielding) return 'surprised';
  if (robot.battery <= 20) return 'tired';
  if (['picking', 'packing', 'loading', 'restocking'].includes(robot.status)) return 'focus';
  if (isWalking(robot)) return 'walk';
  if (isSnoozing(robot)) return 'snooze';
  return 'idle';
}

// A pixel "z" of size s (4x4 grid), drawn with its top-left corner at (x, y).
export const zPath = (x, y, s) => ['BBBB', '..B.', '.B..', 'BBBB'].flatMap((row, r) => [...row].map((p, c) => (
  p === 'B' ? `M${(x + c * s).toFixed(2)} ${(y + r * s).toFixed(2)}h${s}v${s}h-${s}z` : ''))).join('');

// The droid's outline in one colour (16 x 17 sprite units, antenna at y = -1): used for the
// waiting-for-a-robot ghost on order tickets.
const SILHOUETTE = [
  '.......BB.......', '.......BB.......', '........B.......', '....BBBBBBBB....', '...BBBBBBBBBB...', '...BBBBBBBBBB...',
  '...BBBBBBBBBB...', '...BBBBBBBBBB...', '....BBBBBBBB....', '.......BB.......', '..B.BBBBBBBB.B..', '..B.BBBBBBBB.B..',
  '..B.BBBBBBBB.B..', '.BBB.BBBBBB.BBB.', '...BBBBBBBBBB...', '...BBBBBBBBBB...', '....BBBBBBBB....',
];
export const BOT_SILHOUETTE = SILHOUETTE.flatMap((row, y) => [...row].map((p, x) => (p === 'B' ? `M${x} ${y - 1}h1v1h-1z` : ''))).join('');

// What the droid's arms are doing: reaching for a shelf, taping a box, holding a pallet up, carrying a load
// while driving, or nothing in particular.
export function botTask(robot) {
  if (robot.status === 'picking') return 'pick';
  if (robot.status === 'packing') return 'pack';
  if (robot.status === 'loading' || robot.status === 'restocking') return 'lift';
  if (isWalking(robot) && (robot.package_id || robot.pallet || robot.carrying?.length)) return 'carry';
  return null;
}

// The visor (dark face screen) spans x 4.5..11.5, y 3..7 in sprite units; eyes are drawn inside it.
export const VISOR = { x: 4.5, y: 3, w: 7, h: 4 };
const BOT_EYE_X = [5.6, 8.4];
const round = (n) => Math.round(n * 100) / 100;

// Eye rectangles [x, y, w, h] for a face; glance is a [dx, dy] look direction.
export function botEyes(face, glance = [0, 0]) {
  return BOT_EYE_X.flatMap((x) => {
    switch (face) {
      case 'blink':
      case 'snooze': return [[x, 5.1, 2, 0.45]];
      case 'charge': return [[x, 5.4, 2, 0.45], [x - 0.4, 4.95, 0.5, 0.5], [x + 1.9, 4.95, 0.5, 0.5]];
      case 'happy': return [[x, 5, 0.6, 0.6], [x + 0.7, 4.3, 0.6, 0.6], [x + 1.4, 5, 0.6, 0.6]];
      case 'focus': return [[x, 4.6, 2, 0.9]];
      case 'tired': return [[x, 5.2, 2, 0.8]];
      case 'surprised': return [[x - 0.25, 3.7, 2.5, 2.5]];
      default: return [[round(x + glance[0] * 0.55), round(4.2 + glance[1] * 0.45), 2, 1.8]];
    }
  });
}

export const headingGlance = (heading) => GLANCE[heading] ?? [0, 0];
