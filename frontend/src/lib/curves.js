// Learning-curve helpers: each destination's history has a different length, so curves are resampled before averaging.
export function resample(values, points = 100) {
  if (!values?.length) return [];
  if (values.length === 1) return Array(points).fill(values[0]);
  return Array.from({ length: points }, (_, i) => {
    const pos = (i * (values.length - 1)) / (points - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const t = pos - lo;
    return values[lo] * (1 - t) + values[hi] * t;
  });
}

export function averageCurve(histories, field = 'rewards', points = 100) {
  const curves = Object.values(histories ?? {})
    .map((h) => resample(h?.[field] ?? [], points))
    .filter((c) => c.length);
  if (!curves.length) return [];
  return Array.from({ length: points }, (_, i) => curves.reduce((sum, c) => sum + c[i], 0) / curves.length);
}
