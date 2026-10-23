import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useToast } from './toastContext';

const DEFAULTS = {
  name: '', layout_id: 'default', model_id: '', routing_mode: 'hybrid', robot_count: 4,
  rate_per_100: 6, rush_fraction: 0.1, seed: 42, stop_type: 'ticks', stop_value: 2000, online_learning: false,
  size_1: 50, size_2: 30, size_3: 20,
};

export function NewSessionDialog({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(DEFAULTS);
  const [layouts, setLayouts] = useState([]);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);

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
      .catch((e) => toast(e.message));
    return () => { cancelled = true; };
  }, [open, toast]);

  if (!open) return null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const layoutModels = models.filter((m) => m.layout_id === form.layout_id);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
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
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-session-title" onMouseDown={onClose}>
      <form className="modal clay-card" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="new-session-title" className="view-title" style={{ fontSize: 18 }}>New session</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">Name (optional)<input className="clay-input" value={form.name} onChange={set('name')} placeholder="Auto-named from the settings" /></label>
          <div className="field-row">
            <label className="field">Layout
              <select className="clay-select" value={form.layout_id} onChange={(e) => setForm({ ...form, layout_id: e.target.value, model_id: '' })}>
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="field">Model
              <select className="clay-select" value={form.model_id} onChange={set('model_id')}>
                <option value="">None (A* only)</option>
                {layoutModels.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.trained_destinations} trained</option>)}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">Routing
              <select className="clay-select" value={form.routing_mode} onChange={set('routing_mode')}>
                <option value="hybrid">Hybrid A* + Q</option>
                <option value="q_only">Q-learning only</option>
                <option value="astar">Pure A*</option>
              </select>
            </label>
            <label className="field">Robots<input className="clay-input" type="number" min="1" max="8" value={form.robot_count} onChange={set('robot_count')} /></label>
          </div>
          <div className="field-row">
            <label className="field">Orders per 100 ticks<input className="clay-input" type="number" min="0" max="100" step="0.5" value={form.rate_per_100} onChange={set('rate_per_100')} /></label>
            <label className="field">Rush share (0–1)<input className="clay-input" type="number" min="0" max="1" step="0.05" value={form.rush_fraction} onChange={set('rush_fraction')} /></label>
            <label className="field">Seed<input className="clay-input" type="number" value={form.seed} onChange={set('seed')} /></label>
          </div>
          <div className="field-row">
            <label className="field">% 1-item orders<input className="clay-input" type="number" min="0" value={form.size_1} onChange={set('size_1')} /></label>
            <label className="field">% 2-item<input className="clay-input" type="number" min="0" value={form.size_2} onChange={set('size_2')} /></label>
            <label className="field">% 3-item<input className="clay-input" type="number" min="0" value={form.size_3} onChange={set('size_3')} /></label>
          </div>
          <div className="field-row">
            <label className="field">Stop after
              <select className="clay-select" value={form.stop_type} onChange={set('stop_type')}>
                <option value="ticks">Ticks</option>
                <option value="orders">Delivered orders</option>
                <option value="manual">Manual stop</option>
              </select>
            </label>
            {form.stop_type !== 'manual' && (
              <label className="field">Value<input className="clay-input" type="number" min="1" value={form.stop_value} onChange={set('stop_value')} /></label>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={form.online_learning} onChange={set('online_learning')} disabled={!form.model_id} />
            Keep learning during the session (save as a new model version afterwards)
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" className="clay-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="clay-btn clay-btn-accent" disabled={busy}>{busy ? 'Creating…' : 'Create session'}</button>
        </div>
      </form>
    </div>
  );
}
