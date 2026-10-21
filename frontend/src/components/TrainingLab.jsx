import { useEffect, useState } from 'react';
import { trainingApi } from '../services/trainingApi';

const GOAL_LABELS = {
  '14,8': 'Shipping dock (14, 8)',
  '14,2': 'Packing station A (14, 2)',
  '14,5': 'Packing station B (14, 5)',
  '0,2': 'Charger 1 (0, 2)',
  '0,7': 'Charger 2 (0, 7)',
};

const DEFAULT_FORM = {
  name: '',
  goal: '14,8',
  episodes: 3000,
  learning_rate: 0.1,
  discount_factor: 0.95,
  exploration_rate: 0.3,
  epsilon_decay: false,
};

const label = { fontSize: '10px', fontWeight: 700, color: '#9E9587', letterSpacing: '0.05em' };
const input = {
  width: '100%',
  padding: '7px 9px',
  borderRadius: '10px',
  border: '1px solid #E2DDD3',
  background: '#FFFFFF',
  fontFamily: 'var(--font-ui)',
  fontSize: '12px',
  color: '#23201A',
  boxSizing: 'border-box',
};

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

function Field({ title, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={label}>{title}</span>
      {children}
    </label>
  );
}

/** Reward-per-episode curve, drawn as a plain SVG polyline. */
function RewardCurve({ history }) {
  const values = history?.rewards || [];
  if (values.length < 2) {
    return <div style={{ ...label, padding: '40px 0', textAlign: 'center' }}>Train a model to see its learning curve</div>;
  }
  const w = 420;
  const h = 140;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 10) - 5}`)
    .join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '140px', display: 'block' }} preserveAspectRatio="none">
        <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="#E2DDD3" />
        <polyline points={points} fill="none" stroke="#FF5A26" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...label, marginTop: '4px' }}>
        <span>Episode 1 · reward {values[0].toFixed(1)}</span>
        <span>Episode {history.episodes} · reward {values[values.length - 1].toFixed(1)}</span>
      </div>
    </div>
  );
}

function Stat({ title, value }) {
  return (
    <div className="clay-card-flat" style={{ padding: '8px 10px', flex: 1 }}>
      <div style={label}>{title}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '15px' }}>{value}</div>
    </div>
  );
}

export function TrainingLab({ open, onClose, onLoadModel, loadedModelId }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [goals, setGoals] = useState(Object.keys(GOAL_LABELS));
  const [models, setModels] = useState([]);
  const [latest, setLatest] = useState(null);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    Promise.all([trainingApi.layout(), trainingApi.listModels()])
      .then(([layout, list]) => {
        if (cancelled) return;
        const special = layout.destinations.map(([x, y]) => `${x},${y}`).filter((k) => GOAL_LABELS[k]);
        setGoals(special);
        setModels(list);
        setOnline(true);
      })
      .catch(() => !cancelled && setOnline(false));
    return () => {
      cancelled = true;
    };
  }, [open, refresh]);

  if (!open) return null;

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleTrain = async () => {
    setTraining(true);
    setError(null);
    try {
      const [x, y] = form.goal.split(',').map(Number);
      const model = await trainingApi.train({
        name: form.name,
        goal: [x, y],
        seed: Math.floor(Math.random() * 1e6),
        hyperparameters: {
          episodes: Number(form.episodes),
          learning_rate: Number(form.learning_rate),
          discount_factor: Number(form.discount_factor),
          exploration_rate: Number(form.exploration_rate),
          epsilon_decay: form.epsilon_decay,
        },
      });
      setLatest(model);
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setTraining(false);
    }
  };

  const handleLoad = async (id) => {
    setError(null);
    try {
      const model = latest?.id === id ? latest : await trainingApi.getModel(id);
      onLoadModel(model);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleShow = async (id) => {
    try {
      setLatest(await trainingApi.getModel(id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await trainingApi.deleteModel(id);
      if (latest?.id === id) setLatest(null);
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 200,
        background: 'rgba(35, 32, 26, 0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        className="clay-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(980px, 100%)',
          maxHeight: '100%',
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '16px' }}>Training Lab</div>
            <div style={{ fontSize: '11px', color: '#8E8578', fontWeight: 600 }}>
              Train Q-learning agents on the Python backend, save them, and load them into the map.
            </div>
          </div>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: '8px',
              color: online === false ? '#DC2626' : '#10B981',
              background: online === false ? 'rgba(220, 38, 38, 0.1)' : 'rgba(16, 185, 129, 0.12)',
            }}
          >
            {online === null ? 'CONNECTING…' : online ? 'BACKEND ONLINE' : 'BACKEND OFFLINE'}
          </span>
          <button className="clay-btn" onClick={onClose} aria-label="Close training lab">✕</button>
        </div>

        {online === false && (
          <div style={{ fontSize: '12px', color: '#DC2626' }}>
            Can't reach the backend. Start it with: <code>cd backend; .venv\Scripts\python -m uvicorn app.main:app --port 8080</code>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {/* Training form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Field title="MODEL NAME">
              <input style={input} value={form.name} onChange={set('name')} placeholder="Optional, e.g. Dock runner" maxLength={80} />
            </Field>
            <Field title="DESTINATION">
              <select style={input} value={form.goal} onChange={set('goal')}>
                {goals.map((g) => (
                  <option key={g} value={g}>{GOAL_LABELS[g]}</option>
                ))}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <Field title="EPISODES">
                <input style={input} type="number" min="1" max="20000" step="500" value={form.episodes} onChange={set('episodes')} />
              </Field>
              <Field title="LEARNING RATE α">
                <input style={input} type="number" min="0.01" max="1" step="0.05" value={form.learning_rate} onChange={set('learning_rate')} />
              </Field>
              <Field title="DISCOUNT γ">
                <input style={input} type="number" min="0" max="0.99" step="0.01" value={form.discount_factor} onChange={set('discount_factor')} />
              </Field>
              <Field title="EXPLORATION ε">
                <input style={input} type="number" min="0" max="1" step="0.05" value={form.exploration_rate} onChange={set('exploration_rate')} />
              </Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 }}>
              <input type="checkbox" checked={form.epsilon_decay} onChange={set('epsilon_decay')} />
              Decay ε toward 0.05 over training
            </label>
            <button
              className="clay-btn clay-btn-accent"
              onClick={handleTrain}
              disabled={training || online === false}
              style={{ padding: '10px', fontWeight: 800 }}
            >
              {training ? 'Training…' : 'Train & save model'}
            </button>
            {error && <div style={{ fontSize: '12px', color: '#DC2626' }}>{error}</div>}
          </div>

          {/* Latest result */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={label}>{latest ? `LEARNING CURVE · ${latest.name}` : 'LEARNING CURVE'}</div>
            <RewardCurve history={latest?.history} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <Stat title="EPISODE SUCCESS" value={pct(latest?.success_rate)} />
              <Stat title="CELLS REACHED" value={pct(latest?.evaluation?.reach_rate)} />
              <Stat
                title="EXTRA STEPS vs A*"
                value={latest?.evaluation?.avg_extra_steps == null ? '—' : latest.evaluation.avg_extra_steps.toFixed(2)}
              />
            </div>
            {latest && (
              <button className="clay-btn" onClick={() => handleLoad(latest.id)} style={{ padding: '8px', fontWeight: 700 }}>
                Load this model into the map
              </button>
            )}
          </div>
        </div>

        {/* Saved models */}
        <div>
          <div style={{ ...label, marginBottom: '8px' }}>SAVED MODELS ({models.length})</div>
          {models.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#9E9587' }}>No saved models yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {models.map((m) => (
                <div
                  key={m.id}
                  className="clay-card-flat"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', flexWrap: 'wrap' }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '12px' }}>
                      {m.name} {loadedModelId === m.id && <span style={{ color: '#10B981' }}>· in map</span>}
                    </div>
                    <div style={{ fontSize: '10px', color: '#8E8578', fontWeight: 600 }}>
                      {GOAL_LABELS[m.goal.join(',')] || m.goal.join(', ')} · {m.episodes} episodes · reaches{' '}
                      {pct(m.evaluation?.reach_rate)} of cells · {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                  <button className="clay-btn" onClick={() => handleShow(m.id)}>Curve</button>
                  <button className="clay-btn" onClick={() => handleLoad(m.id)}>Load</button>
                  <button className="clay-btn" onClick={() => handleDelete(m.id)}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
