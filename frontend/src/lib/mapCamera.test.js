import { describe, expect, it } from 'vitest';
import { followOffset } from './mapCamera';

describe('warehouse camera', () => {
  it('centers the selected cell after scale without changing its coordinates', () => {
    const robot = { x: 15, y: 9 };
    const geometry = { width: 1054, height: 676, left: 68, top: 48 };
    const offset = followOffset(robot, geometry, 0.75);
    expect((geometry.left + robot.x * 60 + 28 - geometry.width / 2) * .75 + offset.x).toBe(0);
    expect((geometry.top + robot.y * 60 + 28 - geometry.height / 2) * .75 + offset.y).toBe(0);
    expect(robot).toEqual({ x: 15, y: 9 });
  });
});
