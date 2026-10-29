import { useEffect, useRef, useState } from 'react';
import { BarCompare } from '../components/BarCompare';
import { LineChart } from '../components/LineChart';
import { useToast } from '../components/toastContext';
import { throughputDelta } from '../lib/comparison';
import { api } from '../services/api';

const COLORS = ['#e4b366', '#8eafe4', '#78b9ac', '#b6a0d5', '#f19090', '#82c8d6'];
import { NAVIGATION_LABELS as MODE_LABELS, NAVIGATION_MODES } from '../lib/navigation';
const METRICS = [
  { key: 'delivered', label: 'Completed deliveries', better: 'high' },
  { key: 'avg_cycle_time', label: 'Average order time (ticks)', better: 'low' },
  { key: 'throughput_per_100', label: 'Orders per 100 ticks', better: 'high' },
  { key: 'p95_cycle_time', label: 'p95 order time (ticks)', better: 'low' },
  { key: 'fallback_share', label: 'Fallback share of legs', better: 'low' },
  { key: 'avg_extra_steps_per_leg', label: 'Extra steps per leg vs A*', better: 'low' },
  { key: 'wait_events', label: 'Collision waits', better: 'low' },
  { key: 'failed', label: 'Failed orders', better: 'low' },
];
const SUMMARY_STATS = [
  ['delivered', 'Delivered'], ['throughput_per_100', 'Per 100 ticks'], ['avg_cycle_time', 'Avg order time'],
  ['p95_cycle_time', 'p95 order time'], ['steps_per_delivery', 'Steps / delivery'], ['fallback_share', 'Fallback share'],
  ['q_step_share', 'Q-routed steps'], ['wait_events', 'Waits'], ['failed', 'Failed'],
];

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? Number(v.toFixed(3)) : v);

export function HistoryView({ onOpenSession }) {
  const toast = useToast();
  const detailRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [comparisonConfig, setComparisonConfig] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [listVersion, setListVersion] = useState(0);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ layout_id: 'default', robot_count: 4, rate_per_100: 20, ticks: 2000, seed: 42 });
  const [runs, setRuns] = useState([{ model_id: '', routing_mode: 'astar' }, { model_id: '', routing_mode: 'q_only' }]);
  const [results, setResults] = useState(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listSessions(), api.listModels(), api.listLayouts()])
      .then(([s, m, l]) => {
        if (cancelled) return;
        setSessions(s);
        setModels(m);
        setLayouts(l);
        setLoadError(null);
      })
      .catch((err) => { if (!cancelled) { setLoadError(err.message); toast(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listVersion, toast]);

  const open = async (id) => {
    const request = ++detailRequest.current;
    setOpening(true);
    try {
      const detail = await api.getSession(id);
      if (request === detailRequest.current) setSelected(detail);
    } catch (err) {
      if (request === detailRequest.current) toast(err.message);
    } finally { if (request === detailRequest.current) setOpening(false); }
  };

  const modelName = (id) => (id ? models.find((m) => m.id === id)?.name ?? 'deleted model' : 'no model');

  const runCompare = async (e) => {
    e.preventDefault();
    setComparing(true);
    try {
      const response = await api.compare({
        layout_id: form.layout_id,
        robot_count: Number(form.robot_count),
        ticks: Number(form.ticks),
        orders: { rate_per_100: Number(form.rate_per_100), seed: Number(form.seed) },
        runs: runs.map((r) => ({ model_id: r.model_id || null, routing_mode: r.routing_mode })),
      });
      setComparisonConfig({ ...form });
      setResults(response.runs.map((r, i) => ({ ...r, color: COLORS[i % COLORS.length] })));
    } catch (err) {
      toast(err.message);
    } finally {
      setComparing(false);
    }
  };

  const setRun = (i, patch) => setRuns(runs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const visibleSessions = sessions.filter((session) => session.name.toLowerCase().includes(query.toLowerCase()) && (statusFilter === 'all' || session.status === statusFilter));
  const baseline = results?.find((run) => run.routing_mode === 'astar');
  return (
    <div className="view-scroll history-page">
      <div className="product-page-heading">
        <div><span className="eyebrow">Operational evidence</span><h1 className="view-title">History & Compare</h1><p>Review recorded sessions and compare routing on the same seeded workload.</p></div>
        <button type="button" className="clay-btn clay-pill-sm" disabled={loading} onClick={() => { setLoading(true); setListVersion((v) => v + 1); }}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <details className="advanced-options metric-explainer"><summary>How to read simulation results</summary><div className="advanced-fields"><p>Deliveries count completed orders. Throughput is deliveries per 100 simulation steps. Average order time measures how long an order takes from creation to delivery; p95 means 95% of completed orders were faster than that value. Waits count collision-related delays. Fallbacks mean a robot used shortest-path navigation when a learned route was unavailable. Compare actual results rather than assuming AI is always faster.</p></div></details>
      {loadError && <div className="inline-error" role="alert">Unable to load history: {loadError}</div>}

      <div className="clay-card panel" style={{ marginBottom: 16 }}>
        <div className="history-list-heading"><div className="view-subtitle">Sessions <span className="badge">{sessions.length}</span></div>
          <label className="field">Search sessions<input type="search" className="clay-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Session name" /></label>
          <label className="field">Status<select className="clay-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{[...new Set(sessions.map((session) => session.status))].map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
        {opening && <p className="micro-copy" role="status">Loading selected session…</p>}
        {!loading && sessions.length > 0 && visibleSessions.length === 0 && <p className="muted">No sessions match these filters.</p>}
        {sessions.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>{loading ? 'Loading recorded sessions…' : loadError ? 'History is currently unavailable.' : 'No sessions yet. Start one from the Session view.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Status</th><th>Model</th><th className="num">Ticks</th><th className="num">Delivered</th>
                  <th className="num">Per 100</th><th className="num">p95</th><th className="num">Fallbacks</th><th>Started</th></tr>
              </thead>
              <tbody>
                {visibleSessions.map((s) => (
                  <tr key={s.id} className={`clickable ${selected?.id === s.id ? 'selected' : ''}`} onClick={() => open(s.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(s.id); } }}>
                    <td>{s.name}</td>
                    <td><span className={`badge ${s.live ? 'badge-live' : ''}`}>{s.status}</span></td>
                    <td>{modelName(s.config.model_id)} · {MODE_LABELS[s.config.routing_mode]}</td>
                    <td className="num">{s.tick}</td>
                    <td className="num">{fmt(s.summary?.delivered)}</td>
                    <td className="num">{fmt(s.summary?.throughput_per_100)}</td>
                    <td className="num">{fmt(s.summary?.p95_cycle_time)}</td>
                    <td className="num">{fmt(s.summary?.fallbacks)}</td>
                    <td>{new Date(s.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="clay-card panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800 }}>{selected.name}</h2>
            {selected.live && <button type="button" className="clay-btn clay-btn-accent clay-pill-sm" onClick={() => onOpenSession(selected.id)}>Open live view</button>}
          </div>
          {selected.error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{selected.error}</p>}
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            {SUMMARY_STATS.map(([key, label]) => (
              <div key={key} className="clay-card-flat stat"><span className="stat-label">{label}</span><span className="stat-value">{fmt(selected.summary?.[key])}</span></div>
            ))}
          </div>
          <LineChart xLabel="tick" yLabel="Orders per 100 ticks"
            series={[{ label: 'Throughput', color: '#e4b366', points: selected.metrics.map((m) => ({ x: m.tick, y: m.throughput_per_100 })) }]} />
          <LineChart xLabel="tick" yLabel="Orders" height={150}
            series={[
              { label: 'Delivered', color: '#78b9ac', points: selected.metrics.map((m) => ({ x: m.tick, y: m.delivered })) },
              { label: 'Queued', color: '#98a5b5', points: selected.metrics.map((m) => ({ x: m.tick, y: m.queued })) },
            ]} />
        </div>
      )}

      <form className="clay-card panel" onSubmit={runCompare}>
        <div className="view-subtitle">Compare models on the same orders</div>
        <p style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 10 }}>
          Each run simulates the same order pattern so you can compare navigation choices. Shortest-path navigation needs no training. For AI-trained or combined navigation, choose a trained model; without one, the backend uses shortest-path navigation.
        </p>
        <div className="field-row" style={{ marginBottom: 12 }}>
          <label className="field">Layout
            <select className="clay-select" value={form.layout_id} onChange={(e) => { setForm({ ...form, layout_id: e.target.value }); setRuns(runs.map((run) => ({ ...run, model_id: '' }))); }}>
              {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="field">Robots<input className="clay-input" type="number" min="1" max="8" value={form.robot_count} onChange={(e) => setForm({ ...form, robot_count: e.target.value })} /></label>
          <label className="field">Orders / 100 ticks<input className="clay-input" type="number" min="0" max="100" value={form.rate_per_100} onChange={(e) => setForm({ ...form, rate_per_100: e.target.value })} /></label>
          <label className="field">Ticks<input className="clay-input" type="number" min="10" max="5000" value={form.ticks} onChange={(e) => setForm({ ...form, ticks: e.target.value })} /></label>
          <label className="field">Seed<input className="clay-input" type="number" value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} /></label>
        </div>
        {runs.map((run, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i] }} />
            <select aria-label={`Run ${i + 1} model`} className="clay-select" value={run.model_id} onChange={(e) => setRun(i, { model_id: e.target.value })}>
              <option value="">No model</option>
              {models.filter((m) => m.layout_id === form.layout_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select aria-label={`Run ${i + 1} routing mode`} className="clay-select" value={run.routing_mode} onChange={(e) => setRun(i, { routing_mode: e.target.value })}>
              {NAVIGATION_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label} ({mode.technical})</option>)}
            </select>
            <button type="button" className="clay-btn clay-pill-sm" disabled={runs.length <= 1} onClick={() => setRuns(runs.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" className="clay-btn" disabled={runs.length >= 6} onClick={() => setRuns([...runs, { model_id: '', routing_mode: 'astar' }])}>Add run</button>
          <button type="submit" className="clay-btn clay-btn-accent" disabled={comparing}>{comparing ? 'Running…' : 'Run comparison'}</button>
        </div>

        {results && (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="comparison-result-heading"><h2>Completed comparison</h2><p className="micro-copy">Seed {comparisonConfig?.seed} · {comparisonConfig?.ticks} ticks · {comparisonConfig?.robot_count} robots · {layouts.find((layout) => layout.id === comparisonConfig?.layout_id)?.name ?? comparisonConfig?.layout_id}. Results reflect these settings, even if the form above changes.</p></div>
            <div className="comparison-cards">{results.map((run, i) => {
              const delta = throughputDelta(run, baseline);
              return <section key={i} className="comparison-card" style={{ borderTopColor: run.color }}>
                <span className="eyebrow">Run {i + 1}</span><h3>{MODE_LABELS[run.routing_mode]}</h3><p className="micro-copy">{run.label}</p>
                <div className="stat-value">{fmt(run.summary?.throughput_per_100)} <span className="micro-copy">orders / 100 ticks</span></div>
                <p className="micro-copy">{fmt(run.summary?.delivered)} delivered · {fmt(run.summary?.avg_cycle_time)} ticks average order time</p>
                {run !== baseline && delta !== null && <span className="badge">{delta > 0 ? '+' : ''}{delta.toFixed(1)}% throughput vs first A* run</span>}
              </section>;
            })}</div>
            <BarCompare runs={results} metrics={METRICS} />
            <LineChart xLabel="tick" yLabel="Orders per 100 ticks"
              series={results.map((r) => ({ label: r.label, color: r.color, points: r.series.map((p) => ({ x: p.tick, y: p.throughput_per_100 })) }))} />
          </div>
        )}
      </form>
    </div>
  );
}
