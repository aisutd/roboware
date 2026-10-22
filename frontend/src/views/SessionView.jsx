import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { NewSessionDialog } from '../components/NewSessionDialog';
import { OrdersPanel } from '../components/OrdersPanel';
import { RobotsPanel } from '../components/RobotsPanel';
import { SessionBar } from '../components/SessionBar';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { Window } from '../components/Window';
import { useToast } from '../components/toastContext';
import { useSessionStream } from '../hooks/useSessionStream';
import { cellKey } from '../lib/grid';
import { api } from '../services/api';

const FLASH_EVENTS = new Set(['delivered', 'picked', 'packed']);
const STATS = [
  ['delivered', 'Delivered'], ['throughput_per_100', 'Per 100 ticks'],
  ['avg_cycle_time', 'Avg order time'], ['wait_events', 'Waits'],
];

export function SessionView({ sessionId, onSessionChange }) {
  const toast = useToast();
  const [state] = useSessionStream(sessionId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRobotId, setSelectedRobotId] = useState('R1');
  const [layers, setLayers] = useState({ paths: true, qHeatmap: false, yieldHalos: true });
  const [heatmap, setHeatmap] = useState(null);

  const session = state.session;
  const status = session?.status;
  const modelId = session?.config?.model_id;
  const selected = state.robots.find((r) => r.id === selectedRobotId) ?? state.robots[0];
  const targetKey = selected?.target ? cellKey(selected.target[0], selected.target[1]) : null;
  const productNames = useMemo(
    () => Object.fromEntries((state.layout?.products ?? []).map((p) => [p.sku, p.name])),
    [state.layout],
  );
  const flashCells = useMemo(
    () => new Set(state.events.filter((e) => FLASH_EVENTS.has(e.type) && e.at).map((e) => cellKey(e.at[0], e.at[1]))),
    [state.events],
  );

  useEffect(() => {
    if (!layers.qHeatmap || !modelId || !targetKey) return undefined;
    let cancelled = false;
    api.getQTable(modelId, targetKey.split(',').map(Number))
      .then((table) => { if (!cancelled) setHeatmap(table); })
      .catch(() => { if (!cancelled) setHeatmap(null); });
    return () => { cancelled = true; };
  }, [layers.qHeatmap, modelId, targetKey]);

  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state.error, toast]);

  const run = useCallback(async (fn) => {
    try {
      await fn();
    } catch (err) {
      toast(err.message);
    }
  }, [toast]);

  const control = useCallback((action, speed) => run(() => api.controlSession(sessionId, action, speed)), [run, sessionId]);
  const toggleLayer = useCallback((key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] })), []);

  useEffect(() => {
    if (!sessionId) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        control(status === 'running' ? 'pause' : 'play');
      } else if (/^[1-8]$/.test(e.key)) {
        setSelectedRobotId(`R${e.key}`);
      } else if (e.key.toLowerCase() === 'p') {
        toggleLayer('paths');
      } else if (e.key.toLowerCase() === 'q') {
        toggleLayer('qHeatmap');
      } else if (e.key.toLowerCase() === 'h') {
        toggleLayer('yieldHalos');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionId, status, control, toggleLayer]);

  const created = (id) => {
    setDialogOpen(false);
    onSessionChange(id);
  };

  const dialog = <NewSessionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={created} />;

  if (!sessionId || (!state.layout && state.error)) {
    return (
      <div className="empty-state">
        <h1 className="view-title">{state.error ? 'That session has ended' : 'No session running'}</h1>
        <p style={{ fontSize: 15 }}>Start one to watch the robots pick, pack and ship orders.</p>
        <button type="button" className="clay-btn clay-btn-accent" onClick={() => setDialogOpen(true)}><Plus size={14} /> New session</button>
        {dialog}
      </div>
    );
  }

  const stats = state.stats;
  return (
    <div className="session">
      <SessionBar
        session={session}
        connected={state.connected}
        tick={state.tick}
        layers={layers}
        onToggleLayer={toggleLayer}
        onControl={control}
        onNewSession={() => setDialogOpen(true)}
        onSaveModel={() => run(async () => {
          const saved = await api.saveSessionModel(sessionId);
          toast(`Saved "${saved.name}"`, 'success');
        })}
      />
      <div className="session-map">
        <WarehouseMapCanvas
          layout={state.layout}
          robots={state.robots}
          stations={state.stations}
          stock={state.stock}
          selectedRobotId={selected?.id}
          onSelectRobot={setSelectedRobotId}
          layers={layers}
          heatmap={heatmap}
          heatmapTarget={layers.qHeatmap ? selected?.target : null}
          flashCells={flashCells}
          flashToken={state.tick}
        />
      </div>
      <aside className="session-side">
        <Window title="Stats" style={{ flex: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
            {STATS.map(([key, label]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="stat-label">{label}</span>
                <span className="stat-value">{stats?.[key] ?? '–'}</span>
              </div>
            ))}
          </div>
          {stats?.failed > 0 && <p style={{ color: 'var(--red)', fontWeight: 650, marginTop: 10 }}>{stats.failed} failed</p>}
        </Window>
        <RobotsPanel robots={state.robots} selectedRobotId={selected?.id} onSelectRobot={setSelectedRobotId} productNames={productNames} />
        <OrdersPanel
          orders={state.orders}
          productNames={productNames}
          disabled={status === 'finished' || status === 'interrupted'}
          onInject={(priority) => run(() => api.injectOrder(sessionId, { priority }))}
        />
      </aside>
      {dialog}
    </div>
  );
}
