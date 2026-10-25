import { Pause, Play, Plus, SkipForward, Square } from 'lucide-react';

import { NAVIGATION_LABELS, NAVIGATION_MODES } from '../lib/navigation';
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
  const over = !session || status === 'finished' || status === 'interrupted';
  const [statusLabel, statusClass] = STATUS[status] ?? [status, ''];

  return (
    <div className="session-chrome">
      <header className="session-header">
        <div className="session-identity">
          <div className="eyebrow">Operations / Simulation</div>
          <h1 className="session-name">{session?.name ?? 'Loading session…'}</h1>
          <div className="session-metadata">
            <span title={NAVIGATION_MODES.find((mode) => mode.id === config.routing_mode)?.description}>{NAVIGATION_LABELS[config.routing_mode] ?? 'Shortest-path navigation'} <small>({NAVIGATION_MODES.find((mode) => mode.id === config.routing_mode)?.technical ?? 'A*'})</small></span>
            <span>Model: {session?.model_name ?? 'None'}</span>
            {config.online_learning && <span className="learning-label">Online learning</span>}
          </div>
        </div>
        <div className="session-health">
          <span className={`connection-status ${connected ? 'connected' : ''}`}>
            <span className="operational-dot" />{connected ? 'Simulation connected' : 'Simulation offline'}
          </span>
          <span className={`badge ${statusClass}`}>{statusLabel}</span>
          <div className="session-clock"><span className="stat-label" title="One tick is one simulation step, not a real-world second.">Tick</span><span className="font-mono">{String(tick).padStart(5, '0')}</span></div>
        </div>
      </header>
      <div className="session-bar" role="toolbar" aria-label="Simulation controls">
      <div className="bar-group">
        <button type="button" className={`clay-btn ${running ? '' : 'clay-btn-accent'}`} style={{ minWidth: 88 }}
          onClick={() => onControl(running ? 'pause' : 'play')} disabled={over} title="Play / pause (Space)">
          {running ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
        </button>
        <button type="button" className="clay-btn" onClick={() => onControl('step')} disabled={running || over} title="Advance one tick">
          <SkipForward size={14} /> Step
        </button>
        <span className="toolbar-label">Speed</span>
        <div className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={speed === s ? 'on' : ''} aria-pressed={speed === s} disabled={over} onClick={() => onControl('set_speed', s)}>
              {s === 'max' ? 'Max' : `${s}×`}
            </button>
          ))}
        </div>
        <button type="button" className="clay-btn" onClick={() => onControl('stop')} disabled={over} title="End the session and save its results">
          <Square size={12} /> Stop
        </button>
      </div>

      <div className="bar-group layer-controls">
      <span className="toolbar-label">Layers</span>
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
      </div>
      <div className="bar-group session-actions">
      {config.online_learning && onSaveModel && (
        <button type="button" className="clay-btn" onClick={onSaveModel}>Save learned model</button>
      )}
      <button type="button" className="clay-btn clay-btn-accent" onClick={onNewSession}><Plus size={14} /> New session</button>
      </div>
      </div>
    </div>
  );
}
