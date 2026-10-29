import { describe, expect, it } from 'vitest';
import { createSfxGate } from './sfxGate';

describe('sound effect gate', () => {
  it('turns a burst of the same event into one sound per cooldown', () => {
    const gate = createSfxGate();
    const played = [0, 50, 100, 200, 300, 400, 460].filter((t) => gate.allow('picked', t));
    expect(played).toEqual([0, 460]);
  });

  it('lets an important sound through but drops a minor one right after it', () => {
    const gate = createSfxGate();
    expect(gate.allow('delivered', 0)).toBe(true);
    expect(gate.allow('picked', 60)).toBe(false);
    expect(gate.allow('rush', 80)).toBe(true);
  });

  it('never plays more than two effects at once unless the new one outranks them', () => {
    const gate = createSfxGate({ shadowMs: 0 });
    expect(gate.allow('order', 0)).toBe(true);
    expect(gate.allow('packed', 10)).toBe(true);
    expect(gate.allow('picked', 20)).toBe(false);
    expect(gate.allow('rush', 30)).toBe(true);
    // Once the earlier sounds have finished there is room again.
    expect(gate.allow('picked', 1000)).toBe(true);
  });
});
