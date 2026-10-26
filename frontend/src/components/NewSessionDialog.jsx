import { useEffect, useState } from 'react';
import { NAVIGATION_MODES } from '../lib/navigation';
import { ROBOT_COLORS } from '../lib/pet';
import { api } from '../services/api';
import { Dialog } from './Dialog';
import { PixelChoice } from './PixelChoice';
import { PixelIcon } from './PixelIcon';
import { RobotPet } from './RobotPet';
import { useToast } from './toastContext';

const DEFAULTS = {
  name: '', layout_id: 'default', model_id: '', routing_mode: 'astar', robot_count: 4,
  rate_per_100: 6, rush_fraction: 0.1, seed: 42, stop_type: 'ticks', stop_value: 2000, online_learning: false,
  size_1: 50, size_2: 30, size_3: 20,
};

// One-tap presets; Fine-tune holds the exact numbers behind them.
const TRAFFIC = [
  { id: 'calm', label: 'Calm', rate: 3, rush: 0.05 },
  { id: 'steady', label: 'Steady', rate: 6, rush: 0.1 },
  { id: 'busy', label: 'Busy', rate: 12, rush: 0.2 },
];
const LENGTHS = [
  { id: 'short', label: 'Short', type: 'ticks', value: 1000 },
  { id: 'standard', label: 'Standard', type: 'ticks', value: 2000 },
  { id: 'long', label: 'Long', type: 'ticks', value: 5000 },
  { id: 'endless', label: 'Endless', type: 'manual', value: 2000 },
];
const MAX_ROBOTS = ROBOT_COLORS.length;

// The fleet about to launch, drawn as the pixel pets that will appear on the floor.
function CrewPreview({ count }) {
  return (
    <div className="setup-crew" aria-hidden="true">
      {ROBOT_COLORS.slice(0, count).map((color, i) => (
        <span key={color} className="setup-crew-pet">
          <RobotPet robot={{ id: `R${i + 1}`, color, status: 'idle', order_id: 'preview', battery: 100 }} tick={0} />
        </span>
      ))}
    </div>
  );
}

export function NewSessionDialog({ open, onClose, onCreated, initialLayoutId = null, initialModelId = null, initialDraft = null, onTrainRequested }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...DEFAULTS, ...initialDraft, layout_id: initialLayoutId ?? initialDraft?.layout_id ?? 'default', model_id: initialModelId ?? initialDraft?.model_id ?? '', routing_mode: initialDraft?.routing_mode ?? (initialModelId ? 'hybrid' : DEFAULTS.routing_mode) }));
  const [layouts, setLayouts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api.listLayouts()
      .then((l) => {
        if (cancelled) return;
        setLayouts(l);
        // Only trained warehouses can run; start on one unless a specific warehouse was handed over.
        const firstReady = l.find((x) => x.model_status === 'ready');
        if (!initialLayoutId && firstReady) setForm((f) => (l.find((x) => x.id === f.layout_id)?.model_status === 'ready' ? f : { ...f, layout_id: firstReady.id }));
      })
      .catch((e) => { if (!cancelled) { setError(e.message); toast(e.message); } });
    return () => { cancelled = true; };
  }, [open, toast, initialLayoutId]);

  if (!open) return null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const patch = (values) => setForm({ ...form, ...values });
  // Every warehouse runs with its own trained model.
  const warehouse = layouts.find((l) => l.id === form.layout_id);
  const ready = warehouse?.model_status === 'ready';
  const navigation = NAVIGATION_MODES.find((mode) => mode.id === form.routing_mode);
  const robots = Math.min(MAX_ROBOTS, Math.max(1, Number(form.robot_count) || 1));
  const traffic = TRAFFIC.find((t) => t.rate === Number(form.rate_per_100) && t.rush === Number(form.rush_fraction));
  const length = LENGTHS.find((l) => l.type === form.stop_type && (l.type === 'manual' || l.value === Number(form.stop_value)));
  const stopText = form.stop_type === 'manual' ? 'no time limit' : `${form.stop_value} ${form.stop_type === 'ticks' ? 'steps' : 'deliveries'}`;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSession({
        name: form.name,
        layout_id: form.layout_id,
        model_id: warehouse?.model_id ?? null,
        routing_mode: form.routing_mode,
        robot_count: robots,
        orders: {
          rate_per_100: Number(form.rate_per_100),
          rush_fraction: Number(form.rush_fraction),
          seed: Number(form.seed),
          size_weights: [Number(form.size_1), Number(form.size_2), Number(form.size_3)],
        },
        stop: { type: form.stop_type, value: form.stop_type === 'manual' ? null : Number(form.stop_value) },
        online_learning: Boolean(form.online_learning),
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
    <Dialog open={open} onClose={onClose} title="New simulation" pixel className="setup-dialog">
      <form onSubmit={submit} className="simulation-setup" onInvalidCapture={(event) => { const details = event.target.closest('details'); if (details) details.open = true; }}>
        <CrewPreview count={robots} />
        <input className="setup-name" value={form.name} onChange={set('name')} placeholder="Untitled run" aria-label="Simulation name (optional)" maxLength={60} />

        <div className="setup-row">
          <span className="setup-label">Warehouse</span>
          <div className="setup-stack">
            <PixelChoice name="layout_id" legend="Warehouse" value={form.layout_id} onChange={(id) => patch({ layout_id: id })}
              options={(layouts.length ? layouts : [{ id: form.layout_id, name: 'Default warehouse', model_status: 'ready' }]).map((l) => ({
                id: l.id, label: l.name, icon: l.model_status === 'ready' ? null : 'lock',
                title: l.model_status === 'ready' ? 'Trained and ready' : 'Needs its model trained before it can run',
              }))} />
            {layouts.length > 0 && !ready && (
              <p className="setup-warn">
                {warehouse?.model_status === 'outdated' ? 'This floor changed since it was trained.' : 'This warehouse hasn’t been trained yet.'}
                {onTrainRequested && <button type="button" className="setup-link" onClick={() => onTrainRequested(form.layout_id, null, { ...form })}>Train it</button>}
              </p>
            )}
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">Robots</span>
          <div className="setup-stepper" role="group" aria-label="Simulated robots">
            <button type="button" className="px-btn px-small px-icon-btn" onClick={() => patch({ robot_count: robots - 1 })} disabled={robots <= 1} aria-label="One robot fewer"><PixelIcon name="minus" /></button>
            <output className="setup-count" aria-live="polite">{robots}</output>
            <button type="button" className="px-btn px-small px-icon-btn" onClick={() => patch({ robot_count: robots + 1 })} disabled={robots >= MAX_ROBOTS} aria-label="One robot more"><PixelIcon name="plus" /></button>
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">Routing</span>
          <div className="setup-stack">
            <PixelChoice name="routing_mode" legend="Navigation method" value={form.routing_mode} onChange={(id) => patch({ routing_mode: id })}
              options={NAVIGATION_MODES.map((mode) => ({ id: mode.id, label: mode.short, tag: mode.tag }))} />
            <p className="setup-hint" key={form.routing_mode}>{navigation.blurb}</p>
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">Orders</span>
          <PixelChoice name="traffic" legend="Order traffic" value={traffic?.id} options={TRAFFIC}
            onChange={(id) => { const t = TRAFFIC.find((x) => x.id === id); patch({ rate_per_100: t.rate, rush_fraction: t.rush }); }} />
        </div>

        <div className="setup-row">
          <span className="setup-label">Length</span>
          <PixelChoice name="length" legend="Run length" value={length?.id} options={LENGTHS}
            onChange={(id) => { const l = LENGTHS.find((x) => x.id === id); patch({ stop_type: l.type, stop_value: l.value }); }} />
        </div>

        <details className="advanced-options">
          <summary><PixelIcon name="chevron" className="setup-chevron" /> Fine-tune</summary>
          <div className="advanced-fields">
            <div className="field-row">
              <label className="field">Orders per 100 ticks<input title="How often work arrives. A tick is one simulation step." className="setup-input" type="number" min="0" max="100" step="0.5" value={form.rate_per_100} onChange={set('rate_per_100')} /></label>
              <label className="field">Rush order share<input title="0.1 means about 10% of orders are urgent." className="setup-input" type="number" min="0" max="1" step="0.05" value={form.rush_fraction} onChange={set('rush_fraction')} /></label>
              <label className="field">Repeatable order pattern
                <span className="setup-seed">
                  <input title="The same seed recreates the same orders." className="setup-input" type="number" value={form.seed} onChange={set('seed')} />
                  <button type="button" className="px-btn px-small px-icon-btn" title="Roll a new seed" aria-label="Roll a new seed" onClick={() => patch({ seed: Math.floor(Math.random() * 10000) })}><PixelIcon name="dice" /></button>
                </span>
              </label>
            </div>
            <div className="field-row">
              <label className="field">% 1-item orders<input className="setup-input" type="number" min="0" value={form.size_1} onChange={set('size_1')} /></label>
              <label className="field">% 2-item<input className="setup-input" type="number" min="0" value={form.size_2} onChange={set('size_2')} /></label>
              <label className="field">% 3-item<input className="setup-input" type="number" min="0" value={form.size_3} onChange={set('size_3')} /></label>
            </div>
            <div className="field-row">
              <label className="field">Stop condition
                <select className="setup-select" value={form.stop_type} onChange={set('stop_type')}>
                  <option value="ticks">Simulation steps</option>
                  <option value="orders">Delivered orders</option>
                  <option value="manual">Manual stop</option>
                </select>
              </label>
              {form.stop_type !== 'manual' && (
                <label className="field">Stop value<input className="setup-input" type="number" min="1" value={form.stop_value} onChange={set('stop_value')} /></label>
              )}
            </div>
            <label className="check">
              <input type="checkbox" checked={form.online_learning} onChange={set('online_learning')} />
              Keep learning during the session (saves a new model version)
            </label>
          </div>
        </details>

        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="setup-footer">
          <p className="setup-summary" title="Your setup at a glance">{robots} robots · {navigation.short.toLowerCase()} · {(traffic?.label ?? 'Custom').toLowerCase()} orders · {stopText}</p>
          <button type="button" className="px-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="px-btn px-primary setup-go" disabled={busy || (layouts.length > 0 && !ready)}><PixelIcon name="play" />{busy ? 'Starting…' : 'Create'}</button>
        </div>
        <p className="setup-notice">Simulation only. Nothing here controls real robots.</p>
      </form>
    </Dialog>
  );
}
