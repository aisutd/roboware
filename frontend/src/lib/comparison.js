export const metricValue = (summary, key) => Number.isFinite(summary?.[key]) ? summary[key] : null;

export function bestMetric(runs, key, better) {
  const values = runs.map((run) => metricValue(run.summary, key)).filter((value) => value !== null);
  return values.length ? (better === 'low' ? Math.min(...values) : Math.max(...values)) : null;
}

export function throughputDelta(run, baseline) {
  const value = metricValue(run?.summary, 'throughput_per_100');
  const base = metricValue(baseline?.summary, 'throughput_per_100');
  return value !== null && base !== null && base > 0 ? ((value - base) / base) * 100 : null;
}
