import { describe, expect, it } from 'vitest';
import { CHEER_TICKS, VISOR, botEyes, botTask, isWalking, petMood } from './pet';

const robot = (patch) => ({ id: 'R1', status: 'idle', battery: 80, yielding: false, heading: 0, ...patch });

describe('robot pet faces', () => {
  it('picks a face from what the robot is doing', () => {
    expect(petMood(robot({ status: 'charging', battery: 10 }), null, 0)).toBe('charge');
    expect(petMood(robot({ status: 'to_dock', yielding: true }), null, 0)).toBe('surprised');
    expect(petMood(robot({ status: 'to_pick', battery: 15 }), null, 0)).toBe('tired');
    expect(petMood(robot({ status: 'picking' }), null, 0)).toBe('focus');
    expect(petMood(robot({ status: 'packing' }), null, 0)).toBe('focus');
    expect(petMood(robot({ status: 'to_pack' }), null, 0)).toBe('walk');
    // Nothing to do: dozes off. Idle while still holding an order (e.g. waiting for a station): stays awake.
    expect(petMood(robot(), null, 0)).toBe('snooze');
    expect(petMood(robot({ order_id: 'ORD-0001' }), null, 0)).toBe('idle');
  });
  it('smiles for a few ticks after an achievement, then goes back to its task face', () => {
    const cheer = { type: 'delivered', tick: 100 };
    expect(petMood(robot({ status: 'picking' }), cheer, 100)).toBe('happy');
    expect(petMood(robot({ status: 'picking' }), cheer, 100 + CHEER_TICKS)).toBe('happy');
    expect(petMood(robot({ status: 'picking' }), cheer, 101 + CHEER_TICKS)).toBe('focus');
  });
  it('walks only while travelling and not waiting for another robot', () => {
    expect(isWalking(robot({ status: 'to_charger' }))).toBe(true);
    expect(isWalking(robot({ status: 'to_charger', yielding: true }))).toBe(false);
    expect(isWalking(robot({ status: 'picking' }))).toBe(false);
  });
  it('keeps both eyes inside the visor and glances towards where it drives', () => {
    expect(botEyes('walk', [1, 0])).toEqual([[6.15, 4.2, 2, 1.8], [8.95, 4.2, 2, 1.8]]);
    expect(botEyes('happy')).toHaveLength(6);
    for (const face of ['blink', 'snooze', 'charge', 'focus', 'tired', 'surprised', 'idle', 'happy']) {
      for (const glance of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const [x, y, w, h] of botEyes(face, glance)) {
          expect(x).toBeGreaterThanOrEqual(VISOR.x - 0.5);
          expect(x + w).toBeLessThanOrEqual(VISOR.x + VISOR.w + 0.5);
          expect(y).toBeGreaterThanOrEqual(VISOR.y);
          expect(y + h).toBeLessThanOrEqual(VISOR.y + VISOR.h);
        }
      }
    }
  });
  it('moves its arms for the job at hand', () => {
    expect(botTask(robot({ status: 'picking' }))).toBe('pick');
    expect(botTask(robot({ status: 'packing' }))).toBe('pack');
    expect(botTask(robot({ status: 'loading' }))).toBe('lift');
    expect(botTask(robot({ status: 'restocking' }))).toBe('lift');
    expect(botTask(robot({ status: 'to_dock', package_id: 'PKG-1' }))).toBe('carry');
    expect(botTask(robot({ status: 'to_shelf', pallet: { sku: 'SKU-001', qty: 4 } }))).toBe('carry');
    expect(botTask(robot({ status: 'to_pick' }))).toBeNull();
    expect(botTask(robot())).toBeNull();
  });
});
