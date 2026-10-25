import { expect, it } from 'vitest';
import { initialSessionState, sessionReducer } from './sessionStream';

it('keeps bounded real metric samples and clears them for a new snapshot', () => {
  let state = initialSessionState;
  for (let tick = 0; tick <= 1200; tick += 1) {
    state = sessionReducer(state, { type: 'frame', tick, stats: { throughput_per_100: tick / 10 } });
  }
  expect(state.metricSamples).toHaveLength(100);
  expect(state.metricSamples.at(-1)).toEqual({ tick: 1200, throughput_per_100: 120 });
  const paused = sessionReducer(state, { type: 'frame', tick: 1200, stats: { throughput_per_100: 120 } });
  expect(paused.metricSamples).toBe(state.metricSamples);
  state = sessionReducer(state, { type: 'snapshot', tick: 0, stats: { delivered: 0 } });
  expect(state.metricSamples).toEqual([{ tick: 0, delivered: 0 }]);
});
