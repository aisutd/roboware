// Robot names: a pool of short names (6 letters max, so they fit the pixel tags) and a stable pick
// per session, so R1 keeps its name across reloads while different sessions get different crews.

export const ROBOT_NAMES = [
  'Bolt', 'Pip', 'Zip', 'Nori', 'Byte', 'Kiwi', 'Mochi', 'Dot', 'Taco', 'Pixel',
  'Rusty', 'Juno', 'Nova', 'Bean', 'Tofu', 'Ziggy', 'Momo', 'Chip', 'Gizmo', 'Rivet',
  'Sparky', 'Echo', 'Fizz', 'Luna', 'Ollie', 'Pico', 'Remy', 'Sunny', 'Turbo', 'Wally',
  'Yuki', 'Zola', 'Basil', 'Cosmo', 'Dex', 'Ember', 'Fern', 'Hopper', 'Iggy', 'Jinx',
];

export function hashString(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}

const robotNumber = (robotId) => Math.max(1, parseInt(String(robotId).replace(/\D/g, ''), 10) || 1);

// Robots in one session always get different names: stepping by 7 through 40 names never repeats.
export function robotName(robotId, seed = '') {
  const start = hashString(String(seed)) % ROBOT_NAMES.length;
  return ROBOT_NAMES[(start + (robotNumber(robotId) - 1) * 7) % ROBOT_NAMES.length];
}

// Each robot's voice: a semitone offset applied to its sounds, so you can hear who is working.
const VOICE_STEPS = [0, 4, 7, -3, 9, 2, -5, 12];
export const robotVoice = (robotId) => VOICE_STEPS[(robotNumber(robotId) - 1) % VOICE_STEPS.length];
