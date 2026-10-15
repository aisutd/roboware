const MODE_LABELS = { hybrid: 'Hybrid A* + Q', q_only: 'Q-learning only', astar: 'Pure A*' };
const LAYERS = [
  { key: 'paths', label: 'Paths', color: '#10B981' },
  { key: 'qHeatmap', label: 'Q-Heatmap', color: '#FF5A26' },
  { key: 'yieldHalos', label: 'Yield Halos', color: '#F59E0B' },
];

export function TopMapHud({ session, connected, tick, layers, onToggleLayer, onNewSession, onSaveModel }) {
  const status = session?.status ?? 'created';
  const config = session?.config ?? {};
  return (
    <div className="clay-card hud" style={{ top: 20, left: 20, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', maxWidth: 'calc(100% - 420px)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>{session?.name ?? 'Session'}</span>
          <span className={`badge ${status === 'running' ? 'badge-live' : status === 'finished' ? '' : 'badge-warn'}`}>{status.toUpperCase()}</span>
          {!connected && <span className="badge badge-rush">OFFLINE</span>}
        </div>
        <div style={{ fontSize: 10, color: '#8E8578', fontWeight: 600 }}>
          {MODE_LABELS[config.routing_mode] ?? '—'} · {session?.model_name ?? 'no model'}
          {config.online_learning ? ' · learning on' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="stat-label">Tick</span>
        <span className="font-mono" style={{ fontSize: 13, fontWeight: 700 }}>{String(tick).padStart(5, '0')}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {LAYERS.map(({ key, label, color }) => (
          <button key={key} type="button" onClick={() => onToggleLayer(key)}
            className={`clay-btn clay-pill-sm ${layers[key] ? 'clay-btn-active' : ''}`} style={{ fontSize: 11, gap: 4 }}
            disabled={key === 'qHeatmap' && !config.model_id}
            title={key === 'qHeatmap' && !config.model_id ? 'Pick a model for this session to see its Q-values' : `Toggle ${label} (${label[0]})`}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: layers[key] ? color : '#B8B0A2' }} />
            {label}
          </button>
        ))}
      </div>
      {config.online_learning && onSaveModel && (
        <button type="button" className="clay-btn clay-pill-sm" onClick={onSaveModel} style={{ fontSize: 11 }}>Save learned model</button>
      )}
      <button type="button" className="clay-btn clay-pill-sm clay-btn-accent" onClick={onNewSession} style={{ fontSize: 11 }}>New session</button>
    </div>
  );
}
