import { describe, expect, it } from 'vitest';
import { averageCurve, resample } from './curves';

describe('curves', () => {
  it('resamples by linear interpolation', () => {
    expect(resample([0, 10], 3)).toEqual([0, 5, 10]);
    expect(resample([4], 3)).toEqual([4, 4, 4]);
    expect(resample([], 3)).toEqual([]);
  });

  it('averages curves of different lengths point by point', () => {
    const histories = { '1,1': { rewards: [0, 10] }, '2,2': { rewards: [10, 10, 10] } };
    expect(averageCurve(histories, 'rewards', 3)).toEqual([5, 7.5, 10]);
    expect(averageCurve({}, 'rewards', 3)).toEqual([]);
  });
});
