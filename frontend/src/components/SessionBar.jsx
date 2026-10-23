import { Pause, Play, Plus, SkipForward, Square } from 'lucide-react';

const MODE_LABELS = { hybrid: 'Hybrid A* + Q', q_only: 'Q-learning only', astar: 'Pure A*' };
const STATUS = {
  running: ['Running', 'badge-live'], paused: ['Paused', 'badge-warn'], created: ['Ready', 'badge-warn'],
  finished: ['Finished', ''], interrupted: ['Stopped', ''],
};
const SPEEDS = [1, 2, 5, 10, 'max'];
const LAYERS = [
  { key: 'paths', label: 'Paths', hint: 'P' },
  { key: 'qHeatmap', label: 'Heatmap', hint: 'Q' },
  { key: 'yieldHalos', label: 'Halos', hint: 'H' },
];

export function SessionBar({ session, connected, tick, layers, onToggleLayer, onControl, onNewSession, onSaveModel }) {
  const status = session?.status ?? 'created';
  const config = session?.config ?? {};
  const speed = session?.speed ?? 1;
  const running = status === 'running';
  const over = status === 'finished' || status === 'interrupted';
  const [statusLabel, statusClass] = STATUS[status] ?? [status, ''];

  return (
    <header className="clay-card session-bar">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="session-name">{session?.name ?? 'Session'}</span>
          <span className={`badge ${statusClass}`}>{statusLabel}</span>
          {!connected && <span className="badge badge-rush">Offline</span>}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {MODE_LABELS[config.routing_mode] ?? 'Pure A*'}, {session?.model_name ?? 'no model'}
          {config.online_learning ? ', learning' : ''}
        </div>
      </div>

      <div className="bar-sep" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="stat-label">Tick</span>
        <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>{String(tick).padStart(5, '0')}</span>
      </div>

      <div className="bar-group">
        <button type="button" className={`clay-btn ${running ? '' : 'clay-btn-accent'}`} style={{ minWidth: 88 }}
          onClick={() => onControl(running ? 'pause' : 'play')} disabled={over} title="Play / pause (Space)">
          {running ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
        </button>
        <button type="button" className="clay-btn" onClick={() => onControl('step')} disabled={running || over} title="Advance one tick">
          <SkipForward size={14} /> Step
        </button>
        <div className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={speed === s ? 'on' : ''} disabled={over} onClick={() => onControl('set_speed', s)}>
              {s === 'max' ? 'Max' : `${s}×`}
            </button>
          ))}
        </div>
        <button type="button" className="clay-btn" onClick={() => onControl('stop')} disabled={over} title="End the session and save its results">
          <Square size={12} /> Stop
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <div className="seg" role="group" aria-label="Map layers">
        {LAYERS.map(({ key, label, hint }) => {
          const noModel = key === 'qHeatmap' && !config.model_id;
          return (
            <button key={key} type="button" className={layers[key] ? 'on' : ''} aria-pressed={layers[key]} disabled={noModel}
              onClick={() => onToggleLayer(key)} title={noModel ? 'Needs a session with a model' : `${label} (${hint})`}>
              {label}
            </button>
          );
        })}
      </div>
      {config.online_learning && onSaveModel && (
        <button type="button" className="clay-btn" onClick={onSaveModel}>Save learned model</button>
      )}
      <button type="button" className="clay-btn clay-btn-accent" onClick={onNewSession}><Plus size={14} /> New session</button>
    </header>
  );
}
