export function BarCompare({ runs, metrics }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
      {metrics.map(({ key, label, better }) => {
        const values = runs.map((r) => r.summary?.[key] ?? 0);
        const max = Math.max(...values, 1e-9);
        const best = better === 'low' ? Math.min(...values) : Math.max(...values);
        return (
          <div key={key}>
            <div className="stat-label" style={{ marginBottom: 6 }}>{label} ({better === 'low' ? 'lower' : 'higher'} is better)</div>
            {runs.map((run, i) => (
              <div key={`${run.label}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 14, background: '#EEE9E0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(100 * values[i]) / max}%`, height: '100%', background: run.color, opacity: values[i] === best ? 1 : 0.55 }} />
                </div>
                <span className="font-mono" style={{ fontSize: 11, width: 56, textAlign: 'right' }}>{Number(values[i].toFixed(3))}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
