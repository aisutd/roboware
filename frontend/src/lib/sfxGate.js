// Decides whether a sound effect may play right now, so a busy warehouse never turns into noise:
// - each sound has its own cooldown (ten picks in a row make one tick, not ten);
// - at most `maxVoices` effects sound at once, and a new one only gets in if it outranks one playing;
// - just after an important sound, less important ones are skipped for `shadowMs`.

export const SFX_RULES = {
  // name: [priority, cooldown ms, approximate length ms]
  rush: [5, 600, 340],
  horn: [5, 2500, 620],
  restock: [3, 700, 260],
  reverse: [2, 2500, 900],
  pallet: [2, 250, 100],
  delivered: [4, 500, 420],
  order: [3, 350, 200],
  charged: [2, 1500, 300],
  packed: [1, 450, 140],
  picked: [1, 450, 60],
  chatter: [1, 400, 220],
  select: [0, 80, 100],
  click: [0, 60, 30],
};

export function createSfxGate({ rules = SFX_RULES, maxVoices = 2, shadowMs = 180 } = {}) {
  const lastPlayed = {};
  let voices = [];
  let lastAny = { at: -Infinity, priority: -1 };
  return {
    allow(name, now) {
      const [priority = 0, cooldown = 0, length = 200] = rules[name] ?? [];
      if (now - (lastPlayed[name] ?? -Infinity) < cooldown) return false;
      if (now - lastAny.at < shadowMs && lastAny.priority > priority) return false;
      voices = voices.filter((v) => v.until > now);
      if (voices.length >= maxVoices && voices.every((v) => v.priority >= priority)) return false;
      lastPlayed[name] = now;
      lastAny = { at: now, priority };
      voices.push({ until: now + length, priority });
      return true;
    },
  };
}
