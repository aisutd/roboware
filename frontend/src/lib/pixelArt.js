// Turns pixel-art rows ('B' = filled, anything else = empty) into one SVG path of 1x1 squares.
export const pixelPath = (rows, filled = 'B') =>
  rows.flatMap((row, y) => [...row].map((p, x) => (p === filled ? `M${x} ${y}h1v1h-1z` : ''))).join('');

// 8x8 icons for the session stats.
export const ICON_PACKAGE = pixelPath([
  'BBBBBBBB',
  'B..BB..B',
  'B..BB..B',
  'BBBBBBBB',
  'B..BB..B',
  'B......B',
  'B......B',
  'BBBBBBBB',
]);
export const ICON_CLOCK = pixelPath([
  '..BBBB..',
  '.B....B.',
  'B..B...B',
  'B..B...B',
  'B..BBB.B',
  'B......B',
  '.B....B.',
  '..BBBB..',
]);
export const ICON_CLIPBOARD = pixelPath([
  '.BBBBBB.',
  'B..BB..B',
  'B......B',
  'B.B.BB.B',
  'B......B',
  'B.B.BB.B',
  'B......B',
  '.BBBBBB.',
]);

// 7x7 order-stage icons: a claw picks, a box is packed, a truck ships, a check is done.
export const STAGE_ICONS = {
  picking: pixelPath(['B.....B', 'BB...BB', '.B...B.', '.BBBBB.', '...B...', '...B...', '..BBB..']),
  packing: pixelPath(['BBBBBBB', 'B..B..B', 'BBBBBBB', 'B.....B', 'B.....B', 'B.....B', 'BBBBBBB']),
  shipping: pixelPath(['BBBB...', 'B..BBB.', 'B..B..B', 'BBBBBBB', 'BBBBBBB', '.B...B.', '.B...B.']),
  delivered: pixelPath(['......B', '.....BB', 'B...BB.', 'BB.BB..', '.BBB...', '..B....', '.......']),
};

// 7x7 icons for the session controls.
export const UI_ICONS = {
  play: pixelPath(['B......', 'BBB....', 'BBBBB..', 'BBBBBBB', 'BBBBB..', 'BBB....', 'B......']),
  pause: pixelPath(['.BB.BB.', '.BB.BB.', '.BB.BB.', '.BB.BB.', '.BB.BB.', '.BB.BB.', '.BB.BB.']),
  step: pixelPath(['B....BB', 'BB...BB', 'BBB..BB', 'BBBB.BB', 'BBB..BB', 'BB...BB', 'B....BB']),
  stop: pixelPath(['.......', '.BBBBB.', '.BBBBB.', '.BBBBB.', '.BBBBB.', '.BBBBB.', '.......']),
  paths: pixelPath(['BB.....', 'B......', 'BBBB...', '...B...', '...BBBB', '......B', '.....BB']),
  panels: pixelPath(['BBBBBBB', 'B...BBB', 'B...BBB', 'B...BBB', 'B...BBB', 'B...BBB', 'BBBBBBB']),
  fullscreen: pixelPath(['BBB.BBB', 'B.....B', 'B.....B', '.......', 'B.....B', 'B.....B', 'BBB.BBB']),
  exitFullscreen: pixelPath(['..B.B..', '..B.B..', 'BBB.BBB', '.......', 'BBB.BBB', '..B.B..', '..B.B..']),
  help: pixelPath(['.BBBBB.', 'BB...BB', '....BB.', '...BB..', '...BB..', '.......', '...BB..']),
  plus: pixelPath(['..BBB..', '..BBB..', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB', '..BBB..', '..BBB..']),
  results: pixelPath(['......B', '......B', '...B..B', '...B..B', 'B..B..B', 'B..B..B', 'BBBBBBB']),
  save: pixelPath(['BBBBBB.', 'B.BB.BB', 'B.BB..B', 'BBBBBBB', 'B.....B', 'B.BBB.B', 'BBBBBBB']),
  grid: pixelPath(['BBBBBBB', 'B.B.B.B', 'BBBBBBB', 'B.B.B.B', 'BBBBBBB', 'B.B.B.B', 'BBBBBBB']),
  follow: pixelPath(['...B...', '.BBBBB.', '.B...B.', 'BB.B.BB', '.B...B.', '.BBBBB.', '...B...']),
  rush: pixelPath(['...BB..', '..BB...', '.BBBBB.', '...BB..', '..BB...', '.BB....', '.B.....']),
  stats: pixelPath(['.......', '.....B.', '....BB.', '.B..BB.', '.BB.BB.', '.BBBBB.', 'BBBBBBB']),
  robot: pixelPath(['.BBBBB.', '.B.B.B.', 'BBBBBBB', 'BBBBBBB', '.BBBBB.', '.B.B.B.', '.B.B.B.']),
  ticket: pixelPath(['BBBBBBB', 'B.....B', '.B.B.B.', 'B.....B', '.B.B.B.', 'B.....B', 'BBBBBBB']),
  chevron: pixelPath(['.B.....', '.BB....', '.BBB...', '.BBBB..', '.BBB...', '.BB....', '.B.....']),
  chip: pixelPath(['.B.B.B.', 'BBBBBBB', '.B...B.', 'BB.B.BB', '.B...B.', 'BBBBBBB', '.B.B.B.']),
  clock: pixelPath(['.BBBBB.', 'B..B..B', 'B..B..B', 'B..BB.B', 'B.....B', 'B.....B', '.BBBBB.']),
  music: pixelPath(['..BBBBB', '..BBBBB', '..B...B', '..B...B', 'BBB.BBB', 'BBB.BBB', 'BB..BB.']),
  floor: pixelPath(['BBBBBBB', 'B.....B', 'B..B..B', 'B.BBB.B', 'B..B..B', 'B.....B', 'BBBBBBB']),
  erase: pixelPath(['B.B.B.B', '.......', 'B.....B', '.......', 'B.....B', '.......', 'B.B.B.B']),
  rack: pixelPath(['BBBBBBB', 'B.....B', 'BBBBBBB', 'B.....B', 'BBBBBBB', 'B.....B', 'B.....B']),
  box: pixelPath(['BBBBBBB', 'B..B..B', 'BBBBBBB', 'B.....B', 'B.....B', 'B.....B', 'BBBBBBB']),
  bolt: pixelPath(['...BB..', '..BB...', '.BB....', 'BBBBBB.', '...BB..', '..BB...', '.BB....']),
  truck: pixelPath(['BBBB...', 'B..BBB.', 'B..B..B', 'BBBBBBB', 'BBBBBBB', '.B...B.', '.B...B.']),
  undo: pixelPath(['..B....', '.BB....', 'BBBBBB.', '.BB...B', '..B...B', '......B', '..BBBB.']),
  redo: pixelPath(['....B..', '....BB.', '.BBBBBB', 'B...BB.', 'B...B..', 'B......', '.BBBB..']),
  brain: pixelPath(['.BB.BB.', 'B..B..B', 'B.BBB.B', 'BB.B.BB', 'B.BBB.B', 'B..B..B', '.BB.BB.']),
  warehouse: pixelPath(['...B...', '..BBB..', '.BBBBB.', 'BBBBBBB', 'B.....B', 'B.BBB.B', 'B.B.B.B']),
  trash: pixelPath(['..BBB..', 'BBBBBBB', '.B...B.', '.B.B.B.', '.B.B.B.', '.B...B.', '.BBBBB.']),
  download: pixelPath(['...B...', '...B...', '.B.B.B.', '..BBB..', '...B...', '.......', 'BBBBBBB']),
  upload: pixelPath(['...B...', '..BBB..', '.B.B.B.', '...B...', '...B...', '.......', 'BBBBBBB']),
  pallet: pixelPath(['.BBBBB.', '.B.B.B.', '.BBBBB.', '.......', 'BBBBBBB', '.......', 'B.B.B.B']),
  dropoff: pixelPath(['BBBBB..', 'B...B..', 'B...B.B', 'B.BBBBB', 'B...B.B', 'B...B..', 'BBBBB..']),
  wrench: pixelPath(['....BB.', '...B..B', '...B.B.', '..BBB..', '.BBB...', 'BBB....', 'BB.....']),
  hand: pixelPath(['..B.B..', '.BBBBB.', '.BBBBBB', 'BBBBBBB', 'BBBBBBB', '.BBBBB.', '..BBB..']),
  lock: pixelPath(['..BBB..', '.B...B.', '.B...B.', 'BBBBBBB', 'BBB.BBB', 'BBB.BBB', 'BBBBBBB']),
  minus: pixelPath(['.......', '.......', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB', '.......', '.......']),
  close: pixelPath(['BB...BB', 'BBB.BBB', '.BBBBB.', '..BBB..', '.BBBBB.', 'BBB.BBB', 'BB...BB']),
  dice: pixelPath(['BBBBBBB', 'B.BBB.B', 'BBBBBBB', 'BBB.BBB', 'BBBBBBB', 'B.BBB.B', 'BBBBBBB']),
  sfx: pixelPath(['...B...', '..BB.B.', 'BBBB..B', 'BBBB..B', 'BBBB..B', '..BB.B.', '...B...']),
};

// Simulation ticks run at a fixed 1x speed: one tick is 0.6 s (TICK_SECONDS_1X in backend/app/sessions.py).
export const TICK_SECONDS = 0.6;
