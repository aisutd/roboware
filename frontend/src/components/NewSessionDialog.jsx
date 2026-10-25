import { useEffect, useState } from 'react';
import { NAVIGATION_MODES, trainingGuidance } from '../lib/navigation';
import { api } from '../services/api';
import { Dialog } from './Dialog';
import { useToast } from './toastContext';

const DEFAULTS = {
  name: '', layout_id: 'default', model_id: '', routing_mode: 'astar', robot_count: 4,
  rate_per_100: 6, rush_fraction: 0.1, seed: 42, stop_type: 'ticks', stop_value: 2000, online_learning: false,
  size_1: 50, size_2: 30, size_3: 20,
};

export function NewSessionDialog({ open, onClose, onCreated, initialLayoutId = null, initialModelId = null, initialDraft = null, onTrainRequested }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...DEFAULTS, ...initialDraft, layout_id: initialLayoutId ?? initialDraft?.layout_id ?? 'default', model_id: initialModelId ?? initialDraft?.model_id ?? '', routing_mode: initialDraft?.routing_mode ?? (initialModelId ? 'hybrid' : DEFAULTS.routing_mode) }));
  const [layouts, setLayouts] = useState([]);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    Promise.all([api.listLayouts(), api.listModels()])
      .then(([l, m]) => {
        if (!cancelled) {
          setLayouts(l);
          setModels(m);
        }
      })
      .catch((e) => { if (!cancelled) { setError(e.message); toast(e.message); } });
    return () => { cancelled = true; };
  }, [open, toast]);

  if (!open) return null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const layoutModels = models.filter((m) => m.layout_id === form.layout_id);
  const selectedModel = layoutModels.find((model) => model.id === form.model_id);
  const navigation = NAVIGATION_MODES.find((mode) => mode.id === form.routing_mode);
  const guidance = trainingGuidance(form.routing_mode, selectedModel);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSession({
        name: form.name,
        layout_id: form.layout_id,
        model_id: form.model_id || null,
        routing_mode: form.routing_mode,
        robot_count: Number(form.robot_count),
        orders: {
          rate_per_100: Number(form.rate_per_100),
          rush_fraction: Number(form.rush_fraction),
          seed: Number(form.seed),
          size_weights: [Number(form.size_1), Number(form.size_2), Number(form.size_3)],
        },
        stop: { type: form.stop_type, value: form.stop_type === 'manual' ? null : Number(form.stop_value) },
        online_learning: Boolean(form.online_learning && form.model_id),
      });
      created.warnings?.forEach((w) => toast(w, 'info'));
      onCreated(created.id);
    } catch (err) {
      setError(err.message);
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Set up a simulation">
      <form onSubmit={submit} className="simulation-setup" onInvalidCapture={(event) => { const details = event.target.closest('details'); if (details) details.open = true; }}>
        <p className="setup-intro">Choose a warehouse, a virtual robot fleet, and a navigation method. The simulation starts ready for you to press Play.</p>
        <p className="simulation-notice">Simulation only—these settings do not control real robots.</p>
        <section className="setup-section" aria-labelledby="setup-warehouse"><h3 id="setup-warehouse">1 · Warehouse and robot fleet</h3>
          <label className="field">Simulation name (optional)<input className="clay-input" value={form.name} onChange={set('name')} placeholder="We'll name it from your settings" /></label>
          <div className="field-row">
            <label className="field">Warehouse
              <select className="clay-select" value={form.layout_id} onChange={(e) => setForm({ ...form, layout_id: e.target.value, model_id: '' })}>{layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select>
              <span className="field-hint">Use the included warehouse, or a layout saved in Blueprint Studio.</span>
            </label>
            <label className="field">Simulated robots<input className="clay-input" type="number" min="1" max="8" value={form.robot_count} onChange={set('robot_count')} title="Number of virtual robots sharing the warehouse. Start with 4; supported range is 1–8." /><span className="field-hint">Start with 4. You can choose between 1 and 8.</span></label>
          </div>
        </section>
        <section className="setup-section" aria-labelledby="setup-navigation"><h3 id="setup-navigation">2 · Navigation method</h3>
          <label className="field">How should robots find their way?
            <select className="clay-select" value={form.routing_mode} onChange={set('routing_mode')}>{NAVIGATION_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select>
          </label>
          <div className="navigation-explanation"><span className="eyebrow">{navigation.technical}</span><p>{navigation.description}</p></div>
          <label className="field">AI model {form.routing_mode === 'astar' ? '(optional; not needed for shortest-path navigation)' : '(for this warehouse)'}
            <select className="clay-select" value={form.model_id} onChange={set('model_id')}><option value="">No AI model</option>{layoutModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.trained_destinations} destinations trained</option>)}</select>
            <span className="field-hint">A model is a saved set of routes learned by practicing in a virtual warehouse.</span>
          </label>
          <div className={`training-guidance ${guidance.needsTraining ? 'training-needed' : ''}`}><p>{guidance.message}</p>{guidance.needsTraining && <div className="bar-group">
            <button type="button" className="clay-btn clay-pill-sm" onClick={() => setForm({ ...form, routing_mode: 'astar' })}>Use shortest-path instead</button>
            {onTrainRequested && <button type="button" className="clay-btn clay-pill-sm" onClick={() => onTrainRequested(form.layout_id, form.model_id || null, { ...form })}>Open Training Lab</button>}
          </div>}</div>
        </section>
        <details className="advanced-options"><summary>Advanced simulation options <span>Orders, stopping rules, and learning during a run</span></summary><div className="advanced-fields">
          <div className="field-row">
            <label className="field">Orders per 100 ticks<input title="Controls how often work arrives. A tick is one simulation step, not a real-world second." className="clay-input" type="number" min="0" max="100" step="0.5" value={form.rate_per_100} onChange={set('rate_per_100')} /></label>
            <label className="field">Rush order share (0–1)<input title="0.1 means about 10% of generated orders are marked urgent." className="clay-input" type="number" min="0" max="1" step="0.05" value={form.rush_fraction} onChange={set('rush_fraction')} /></label>
            <label className="field">Repeatable order pattern (seed)<input title="The same seed recreates the same generated order pattern when other settings are unchanged." className="clay-input" type="number" value={form.seed} onChange={set('seed')} /></label>
          </div>
          <div className="field-row">
            <label className="field">% 1-item orders<input className="clay-input" type="number" min="0" value={form.size_1} onChange={set('size_1')} /></label>
            <label className="field">% 2-item<input className="clay-input" type="number" min="0" value={form.size_2} onChange={set('size_2')} /></label>
            <label className="field">% 3-item<input className="clay-input" type="number" min="0" value={form.size_3} onChange={set('size_3')} /></label>
          </div>
          <div className="field-row">
            <label className="field">Stop condition
              <select className="clay-select" value={form.stop_type} onChange={set('stop_type')}>
                <option value="ticks">Simulation steps (ticks)</option>
                <option value="orders">Delivered orders</option>
                <option value="manual">Manual stop</option>
              </select>
            </label>
            {form.stop_type !== 'manual' && (
              <label className="field">Stop value<input title="For steps, stop after this many simulation ticks. For orders, stop after this many deliveries." className="clay-input" type="number" min="1" value={form.stop_value} onChange={set('stop_value')} /></label>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={form.online_learning} onChange={set('online_learning')} disabled={!form.model_id} />
            Keep learning during the session (save as a new model version afterwards)
          </label>
          <p className="field-hint">Order-size values are relative weights. With the defaults, about 50% of orders contain one item, 30% two, and 20% three. A simulation tick is a logical step, not a physical time measurement.</p>
        </div></details>
        <p className="setup-summary">Current setup: {form.robot_count} virtual robots · {navigation.label} · {form.rate_per_100} orders per 100 ticks · {form.stop_type === 'manual' ? 'stop manually' : `stop after ${form.stop_value} ${form.stop_type === 'ticks' ? 'simulation steps' : 'delivered orders'}`}.</p>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="setup-footer"><button type="button" className="clay-btn" onClick={onClose}>Cancel</button><button type="submit" className="clay-btn clay-btn-accent" disabled={busy}>{busy ? 'Creating…' : 'Create simulation'}</button></div>
      </form>
    </Dialog>
  );
}
