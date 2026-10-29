import { bestMetric, metricValue } from '../lib/comparison';

export function BarCompare({ runs, metrics }) {
  return (
    <div className="comparison-metrics">
      {metrics.map(({ key, label, better }) => {
        const values = runs.map((run) => metricValue(run.summary, key));
        const max = Math.max(...values.filter((value) => value !== null), 1e-9);
        const best = bestMetric(runs, key, better);
        return (
          <section className="comparison-metric" key={key}>
            <h3>{label}</h3><p className="micro-copy">{better === 'low' ? 'Lower' : 'Higher'} is better · ties share the best mark</p>
            {runs.map((run, i) => (
              <div key={`${run.label}-${i}`} className="comparison-bar-row">
                <div className="comparison-run-label"><span style={{ color: run.color }}>{i + 1}. {run.label}</span><span>{values[i] === null ? 'Not available' : Number(values[i].toFixed(3))}{values[i] !== null && values[i] === best && <span className="best-mark">Best</span>}</span></div>
                <div className="comparison-bar"><div style={{ width: values[i] === null ? 0 : `${Math.max(0, (100 * values[i]) / max)}%`, height: '100%', background: run.color, opacity: values[i] === best ? 1 : .5 }} /></div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
