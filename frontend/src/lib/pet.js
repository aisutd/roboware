// Claw'd-style robot sprite: pixel layout, walking legs, and which face to show for what the robot is doing.

// B = body pixel. 12 x 8 sprite units; the eyes and legs are drawn separately so they can change.
const BODY_PIXELS = [
  '..BBBBBBBB..',
  '..BBBBBBBB..',
  'BBBBBBBBBBBB',
  'BBBBBBBBBBBB',
  '..BBBBBBBB..',
  '..BBBBBBBB..',
];
const pixels = (cells) => cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('');

export const PET_BODY = pixels(BODY_PIXELS.flatMap((row, y) => [...row].flatMap((p, x) => (p === 'B' ? [[x, y]] : []))));
// Legs step in two alternating pairs: outer-left with inner-right, then the other two.
export const PET_LEGS_A = pixels([[2, 6], [2, 7], [7, 6], [7, 7]]);
export const PET_LEGS_B = pixels([[4, 6], [4, 7], [9, 6], [9, 7]]);

const EYE_X = [3, 8];
const GLANCE = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
const WALKING = new Set(['to_pick', 'to_pack', 'to_dock', 'to_charger', 'parking']);

// How long (in ticks) a robot stays happy after picking, packing, delivering or finishing a charge.
export const CHEER_TICKS = 3;

export const isWalking = (robot) => WALKING.has(robot.status) && !robot.yielding;

// Robots with nothing to do doze off (faded colour, closed eyes, "zzZ") until they get work.
export const isSnoozing = (robot) => robot.status === 'idle' && !robot.order_id && !robot.yielding;

export function petMood(robot, cheer, tick) {
  if (cheer && tick - cheer.tick <= CHEER_TICKS) return 'happy';
  if (robot.status === 'charging') return 'charge';
  if (robot.yielding) return 'surprised';
  if (robot.battery <= 20) return 'tired';
  if (robot.status === 'picking' || robot.status === 'packing') return 'focus';
  if (isWalking(robot)) return 'walk';
  if (isSnoozing(robot)) return 'snooze';
  return 'idle';
}

// A pixel "z" of size s (4x4 grid), drawn with its top-left corner at (x, y).
export const zPath = (x, y, s) => ['BBBB', '..B.', '.B..', 'BBBB'].flatMap((row, r) => [...row].map((p, c) => (
  p === 'B' ? `M${(x + c * s).toFixed(2)} ${(y + r * s).toFixed(2)}h${s}v${s}h-${s}z` : ''))).join('');

// Eye rectangles [x, y, w, h] in sprite units for a face; glance is a [dx, dy] look direction.
export function eyeRects(face, glance = [0, 0]) {
  return EYE_X.flatMap((x) => {
    switch (face) {
      case 'blink':
      case 'snooze':
      case 'charge': return [[x, 1.35, 1, 0.3]];
      case 'happy': return [[x - 0.15, 1.5, 0.45, 0.5], [x + 0.28, 1.05, 0.45, 0.5], [x + 0.7, 1.5, 0.45, 0.5]];
      case 'focus': return [[x, 1.45, 1, 0.55]];
      case 'tired': return [[x, 1.6, 1, 0.4]];
      case 'surprised': return [[x - 0.1, 0.9, 1.2, 1.2]];
      default: return [[x + glance[0] * 0.25, 1 + glance[1] * 0.25, 1, 1]];
    }
  });
}

export const headingGlance = (heading) => GLANCE[heading] ?? [0, 0];
