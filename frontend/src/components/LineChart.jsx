const W = 560;
const PAD = { left: 48, right: 12, top: 10, bottom: 26 };

const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(1)));

export function LineChart({ series, height = 180, xLabel = '', yLabel = '' }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#8E8578' }}>No data yet</div>;
  }
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const sx = (x) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right);
  const sy = (y) => height - PAD.bottom - ((y - y0) / (y1 - y0)) * (height - PAD.top - PAD.bottom);
  const yTicks = [y0, (y0 + y1) / 2, y1];
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="#E6E1D6" />
            <text x={PAD.left - 6} y={sy(t) + 4} textAnchor="end" fontSize="10" fill="#8E8578" fontFamily="JetBrains Mono">{fmt(t)}</text>
          </g>
        ))}
        <text x={PAD.left} y={height - 6} fontSize="10" fill="#8E8578" fontFamily="JetBrains Mono">{fmt(x0)}</text>
        <text x={W - PAD.right} y={height - 6} textAnchor="end" fontSize="10" fill="#8E8578" fontFamily="JetBrains Mono">{fmt(x1)}</text>
        <text x={(W + PAD.left) / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="#8E8578">{xLabel}</text>
        {series.map((s) => (
          <polyline key={s.label} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"
            points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
        ))}
      </svg>
      <figcaption style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: '#6B6357', marginTop: 4 }}>
        {yLabel && <span style={{ fontWeight: 700 }}>{yLabel}</span>}
        {series.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 3, background: s.color, borderRadius: 2 }} />{s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
