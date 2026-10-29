// 14x14 pixel sprites for the warehouse floor. Each letter is a colour from the sprite's palette;
// '.' is transparent. Drawn at 4 screen pixels per sprite pixel on a 56px tile.

// classes optionally names a CSS class per letter, so one colour layer of a sprite can be animated.
const layers = (rows, palette, classes = {}) => Object.entries(palette).map(([letter, fill]) => ({
  fill,
  className: classes[letter],
  d: rows.flatMap((row, y) => [...row].map((p, x) => (p === letter ? `M${x} ${y}h1v1h-1z` : ''))).join(''),
}));

const RACK_PALETTE = { F: '#56677a', S: '#a07a48', A: '#d2a86c', B: '#b78b55', T: '#7e5c33', D: '#1b242c' };

// Shelves: a steel frame, two boards, and taped boxes. Three box layouts so racks don't look copy-pasted.
const RACKS = [
  [
    'FFFFFFFFFFFFFF', 'FDDDDDDDDDDDDF', 'FDAAAADBBBBBDF', 'FDATTADBBTBBDF', 'FDAAAADBBBBBDF', 'FDAAAADBBBBBDF', 'FSSSSSSSSSSSSF',
    'FDDDDDDDDDDDDF', 'FDBBBBBDAAAADF', 'FDBBTBBDATTADF', 'FDBBBBBDAAAADF', 'FDBBBBBDAAAADF', 'FSSSSSSSSSSSSF', 'FF..........FF',
  ],
  [
    'FFFFFFFFFFFFFF', 'FDDDDDDDDDDDDF', 'FDDDDDDAAAAADF', 'FDBBBBDATTAADF', 'FDBTTBDAAAAADF', 'FDBBBBDAAAAADF', 'FSSSSSSSSSSSSF',
    'FDDDDDDDDDDDDF', 'FDAAAAAAAADDDF', 'FDAATTTTAADDDF', 'FDAAAAAAAABBDF', 'FDAAAAAAAABBDF', 'FSSSSSSSSSSSSF', 'FF..........FF',
  ],
  [
    'FFFFFFFFFFFFFF', 'FDDDDDDDDDDDDF', 'FDBBBBBBBBBBDF', 'FDBBBTTTTBBBDF', 'FDBBBBBBBBBBDF', 'FDBBBBBBBBBBDF', 'FSSSSSSSSSSSSF',
    'FDDDDDDDDDDDDF', 'FDAAADDDAAAADF', 'FDATADDDATTADF', 'FDAAADBBAAAADF', 'FDAAADBBAAAADF', 'FSSSSSSSSSSSSF', 'FF..........FF',
  ],
];
export const RACK_SPRITES = RACKS.map((rows) => layers(rows, RACK_PALETTE));

// Charger: an upright battery with a lightning bolt; its inside (E) fills up in steps as if charging.
// The icon keeps to rows 1-10 so the caption below has room.
export const CHARGER_SPRITE = [
  { fill: '#221c10', d: 'M5 3h4v7h-4z' },
  ...layers([
    '..............', '......OO......', '....OOOOOO....', '....OEEEEO....', '....OEEYYO....', '....OEYYEO....', '....OYYYYO....',
    '....OEYYEO....', '....OYYEEO....', '....OEEEEO....', '....OOOOOO....', '..............', '..............', '..............',
  ], { O: '#c9963f', E: '#6e5a2a', Y: '#ffd45a' }, { E: 'charge-fill' }),
];

// Packing station: one taped parcel riding a short conveyor whose rollers (R) tick along.
export const PACKING_SPRITE = layers([
  '..............', '..............', '....LLLLLL....', '....LLTTLL....', '....KKTTKK....', '....KKTTKK....', '....KKKKKK....',
  '.BBBBBBBBBBBB.', '.R..R..R..R...', '.BBBBBBBBBBBB.', '..............', '..............', '..............', '..............',
], { L: '#e0bb84', K: '#c99b5f', T: '#8fb8ff', B: '#5f86c8', R: '#cfe0ff' }, { R: 'conveyor-rollers' });

// Dock: a green delivery truck.
export const DOCK_SPRITE = layers([
  '..............', '..............', '.GGGGGGGG.....', '.GLLLLLLGHHH..', '.GLLLLLLGHWHH.', '.GGGGGGGGHHHH.', '.GGGGGGGGHHHH.',
  '.GGGGGGGGHHHH.', '..XX...XX.XX..', '..XX...XX.XX..', '..............', '..............', '..............', '..............',
], { G: '#5fbf8c', L: '#7fd8a6', H: '#3f9a6e', W: '#cfeee0', X: '#0d1217' });
