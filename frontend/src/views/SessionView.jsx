import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentBrainInspector } from '../components/AgentBrainInspector';
import { NewSessionDialog } from '../components/NewSessionDialog';
import { OrderDemandDrawer } from '../components/OrderDemandDrawer';
import { PlaybackDock } from '../components/PlaybackDock';
import { TopMapHud } from '../components/TopMapHud';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { useSessionStream } from '../hooks/useSessionStream';
import { cellKey } from '../lib/grid';
import { api } from '../services/api';

const FLASH_EVENTS = new Set(['delivered', 'picked', 'packed']);

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
        <h1 className="view-title">{state.error ? 'That session is no longer live' : 'No session running'}</h1>
        <p style={{ maxWidth: 420, fontSize: 13 }}>
          Start a session to watch the robots pick, pack and ship orders. Train a model in Models first if you want them to use Q-learning.
        </p>
        <button type="button" className="clay-btn clay-btn-accent" onClick={() => setDialogOpen(true)}>New session</button>
        {dialog}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
      <TopMapHud
        session={session}
        connected={state.connected}
        tick={state.tick}
        layers={layers}
        onToggleLayer={toggleLayer}
        onNewSession={() => setDialogOpen(true)}
        onSaveModel={() => run(async () => {
          const saved = await api.saveSessionModel(sessionId);
          toast(`Saved "${saved.name}"`, 'success');
        })}
      />
      <PlaybackDock
        status={status}
        speed={session?.speed ?? 1}
        onPlay={() => control('play')}
        onPause={() => control('pause')}
        onStep={() => control('step')}
        onStop={() => control('stop')}
        onSpeed={(s) => control('set_speed', s)}
      />
      <OrderDemandDrawer
        orders={state.orders}
        stats={state.stats}
        productNames={productNames}
        disabled={status === 'finished' || status === 'interrupted'}
        onInject={(priority) => run(() => api.injectOrder(sessionId, { priority }))}
      />
      <AgentBrainInspector robots={state.robots} selectedRobotId={selected?.id} onSelectRobot={setSelectedRobotId} productNames={productNames} />
      {dialog}
    </div>
  );
}
