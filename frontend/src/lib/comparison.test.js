import { expect, it } from 'vitest';
import { bestMetric, metricValue, throughputDelta } from './comparison';

it('keeps missing comparison metrics distinct from measured zero', () => {
  expect(metricValue({}, 'wait_events')).toBeNull();
  expect(bestMetric([{ summary: {} }, { summary: { wait_events: 3 } }], 'wait_events', 'low')).toBe(3);
  expect(bestMetric([{ summary: { wait_events: 0 } }, { summary: { wait_events: 3 } }], 'wait_events', 'low')).toBe(0);
});
it('only computes a throughput delta with a positive measured baseline', () => {
  expect(throughputDelta({ summary: { throughput_per_100: 15 } }, { summary: { throughput_per_100: 10 } })).toBe(50);
  expect(throughputDelta({ summary: { throughput_per_100: 15 } }, { summary: { throughput_per_100: 0 } })).toBeNull();
  expect(throughputDelta({ summary: {} }, { summary: { throughput_per_100: 10 } })).toBeNull();
});
