import { describe, expect, it } from 'vitest';
import { BUBBLE_TICKS, TRAIL_TICKS, blockerOf, chatterFrom, nextMove, trailsFrom } from './chatter';
import { ROBOT_NAMES, robotName, robotVoice } from './robotNames';

const robot = (id, x, y, patch = {}) => ({ id, x, y, status: 'to_pick', yielding: false, path: [], ...patch });

describe('robot names and voices', () => {
  it('gives every robot in a session a different, short name that stays the same', () => {
    for (const seed of ['ses_a', 'ses_b', 'ses_c', '']) {
      const names = Array.from({ length: 8 }, (_, i) => robotName(`R${i + 1}`, seed));
      expect(new Set(names).size).toBe(8);
      expect(names).toEqual(Array.from({ length: 8 }, (_, i) => robotName(`R${i + 1}`, seed)));
    }
    expect(ROBOT_NAMES.length).toBeGreaterThanOrEqual(40);
    expect(ROBOT_NAMES.every((n) => n.length <= 6)).toBe(true);
    expect(new Set(ROBOT_NAMES).size).toBe(ROBOT_NAMES.length);
  });
  it('gives robots different voices', () => {
    expect(new Set(Array.from({ length: 8 }, (_, i) => robotVoice(`R${i + 1}`))).size).toBe(8);
  });
});

describe('speech bubbles', () => {
  // Deliveries are 60% likely to get a line; find a tick where R1 speaks for a deterministic test.
  const speaks = (id, tick) => Boolean(chatterFrom({ previous: {}, events: [{ type: 'delivered', robot: id }], prevRobots: [], robots: [], tick }).chatter[id]);
  const tick = Array.from({ length: 200 }, (_, i) => i).find((t) => speaks('R1', t));

  it('lets a robot speak, then keeps it quiet for a while', () => {
    const first = chatterFrom({ previous: {}, events: [{ type: 'delivered', robot: 'R1' }], prevRobots: [], robots: [], tick });
    expect(first.chatter.R1).toMatchObject({ kind: 'delivered', tick });
    const again = chatterFrom({ previous: first.chatter, events: [{ type: 'delivered', robot: 'R1' }], prevRobots: [], robots: [], tick: tick + 2 });
    expect(again.chatter).toBe(first.chatter);
  });

  it('never has more than two robots talking at once', () => {
    const previous = { R2: { kind: 'picked', text: 'x', tick }, R3: { kind: 'picked', text: 'x', tick } };
    const result = chatterFrom({ previous, events: [{ type: 'delivered', robot: 'R1' }], prevRobots: [], robots: [], tick });
    expect(result.chatter.R1).toBeUndefined();
    const later = chatterFrom({ previous, events: [{ type: 'to_charger', robot: 'R4' }], prevRobots: [], robots: [], tick: tick + BUBBLE_TICKS });
    expect(Object.keys(later.chatter)).toContain('R2');
  });

  it('makes a yielding robot apologise and the robot it waits for say thanks with a nod', () => {
    const waiting = robot('R1', 3, 3, { path: [[4, 3]] });
    const blocker = robot('R2', 4, 3);
    expect(blockerOf(waiting, [waiting, blocker])).toBe('R2');
    const result = chatterFrom({
      previous: {}, events: [], tick: 50,
      prevRobots: [waiting, blocker], robots: [{ ...waiting, yielding: true }, blocker],
    });
    expect(result.chatter.R1.kind).toBe('yield');
    expect(result.chatter.R2.kind).toBe('thanks');
    expect(result.reactions).toEqual(['R2']);
  });
});

describe('thought bubble and footprints', () => {
  it('reads the next move from the robot path', () => {
    expect(nextMove(robot('R1', 2, 2, { path: [[2, 1]] }))).toBe('up');
    expect(nextMove(robot('R1', 2, 2, { path: [[3, 2], [4, 2]] }))).toBe('right');
    expect(nextMove(robot('R1', 2, 2))).toBeNull();
  });
  it('leaves a footprint on each cell a robot leaves and lets it fade out', () => {
    let trails = trailsFrom({}, [robot('R1', 1, 1)], [robot('R1', 2, 1)], 10);
    expect(trails.R1).toEqual([{ x: 1, y: 1, tick: 10, dx: 1, dy: 0 }]);
    trails = trailsFrom(trails, [robot('R1', 2, 1)], [robot('R1', 2, 1)], 10 + TRAIL_TICKS);
    expect(trails.R1).toEqual([]);
  });
});
