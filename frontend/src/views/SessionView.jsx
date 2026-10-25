import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GettingStarted } from '../components/GettingStarted';
import { Dialog } from '../components/Dialog';
import { LineChart } from '../components/LineChart';
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
  ['delivered', 'Completed deliveries', 'Orders delivered to the dock'], ['throughput_per_100', 'Orders / 100 ticks', 'Delivered orders per 100 simulation ticks'],
  ['avg_cycle_time', 'Avg order time', 'Mean time from order creation to delivery, in ticks'], ['wait_events', 'Collision waits', 'Recorded collision-related wait events'],
];

export function SessionView({ sessionId, onSessionChange, onNavigate, initialLayoutId = null, initialModelId = null, initialDraft = null, onTrainRequested }) {
  const toast = useToast();
  const sessionRef = useRef(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [state] = useSessionStream(sessionId);
  const [dialogOpen, setDialogOpen] = useState(Boolean(initialLayoutId));
  const [selectedRobotId, setSelectedRobotId] = useState('R1');
  const [layers, setLayers] = useState({ paths: true, qHeatmap: false, yieldHalos: true });
  const [heatmap, setHeatmap] = useState(null);

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === sessionRef.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (sessionRef.current?.requestFullscreen) await sessionRef.current.requestFullscreen();
      else toast('Fullscreen is not supported in this browser.', 'info');
    } catch (err) { toast(err.message); }
  };

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
      .then((table) => { if (!cancelled) setHeatmap({ ...table, modelId, destinationKey: targetKey }); })
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
      if (dialogOpen || helpOpen || e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.key === '?') { setHelpOpen(true); return; }
      if (document.activeElement?.tagName === 'BUTTON' && e.code === 'Space') return;
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
  }, [sessionId, status, control, toggleLayer, dialogOpen, helpOpen]);

  const created = (id) => {
    setDialogOpen(false);
    onSessionChange(id);
  };

  const dialog = <NewSessionDialog initialLayoutId={initialLayoutId} initialModelId={initialModelId} initialDraft={initialDraft} onTrainRequested={onTrainRequested ? (layoutId, modelId, draft) => { setDialogOpen(false); onTrainRequested(layoutId, modelId, draft); } : undefined} open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={created} />;

  if (!sessionId || (!state.layout && state.error)) {
    return (
      <div className="session session-idle">
        <header className="session-header">
          <div className="session-identity">
            <div className="eyebrow">Operations / Session</div>
            <h1 className="session-name">Session workspace</h1>
            <p className="session-metadata">Warehouse simulation and fleet inspection</p>
          </div>
          <span className="badge">No active session</span>
        </header>
        <div className="session-start-scroll">
          {state.error && <div className="inline-error" role="status">{state.error} Start a new simulation or review saved results in History & Compare.</div>}
          <GettingStarted onNavigate={onNavigate} onConfigure={() => setDialogOpen(true)} />
        </div>
        {dialog}
      </div>
    );
  }

  const stats = state.stats;
  return (
    <div ref={sessionRef} className={`session ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
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
      <div className="simulation-next-action"><span>{status === 'created' ? 'Your simulation is ready. Press Play to start, or Step to advance one simulation tick.' : status === 'finished' || status === 'interrupted' ? 'This run has ended. Review its recorded metrics and compare navigation methods.' : 'Virtual warehouse simulation. Pause to inspect a robot; a tick is one simulation step.'}</span><button type="button" className="guide-action" onClick={() => onNavigate('history')}>Analyze performance →</button></div>
      <div className="session-workspace">
      <section className="warehouse-workspace" aria-label="Warehouse workspace">
        <div className="workspace-heading">
          <div><span className="eyebrow">Warehouse</span><h2>{state.layout?.name ?? 'Live floor'}</h2></div>
          <div className="workspace-actions">
            <span className="workspace-summary">{state.robots.length} robots · {state.layout ? `${state.layout.width} × ${state.layout.height} cells` : 'Loading layout…'}</span>
            <button type="button" className="clay-btn clay-pill-sm" onClick={() => setInspectorOpen((v) => !v)} aria-expanded={inspectorOpen} aria-controls="operational-inspector">{inspectorOpen ? 'Hide inspector' : 'Show inspector'}</button>
            <button type="button" className="clay-btn clay-pill-sm" onClick={toggleFullscreen}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
            <button type="button" className="clay-btn clay-pill-sm" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">?</button>
          </div>
        </div>
      <div className="session-map">
        <WarehouseMapCanvas
          layout={state.layout}
          robots={state.robots}
          stations={state.stations}
          stock={state.stock}
          selectedRobotId={selected?.id}
          onSelectRobot={setSelectedRobotId}
          layers={layers}
          heatmap={heatmap?.modelId === modelId && heatmap?.destinationKey === targetKey ? heatmap : null}
          heatmapTarget={layers.qHeatmap ? selected?.target : null}
          flashCells={flashCells}
          flashToken={state.tick}
        />
      </div>
        <footer className="workspace-footer"><span>Floor overview</span><span>Space play / pause · 1–8 select robot · P / Q / H layers</span></footer>
      </section>
      <aside id="operational-inspector" className="session-side" hidden={!inspectorOpen} aria-label="Operational inspection">
        <div className="inspection-heading"><span className="eyebrow">Operations</span><h2>Session overview</h2></div>
        <div className="inspection-scroll">
        <Window title="Stats" className="operations-stats" style={{ flex: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
            {STATS.map(([key, label, explanation]) => (
              <div key={key} title={explanation} style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="stat-label">{label}</span>
                <span className="stat-value">{stats?.[key] == null ? '–' : Number.isInteger(stats[key]) ? stats[key] : Number(stats[key].toFixed(2))}</span>
              </div>
            ))}
          </div>
          {state.metricSamples.length > 1 && <div className="session-trend"><LineChart height={125} xLabel="tick" yLabel="Orders / 100 ticks" series={[{ label: 'Observed throughput', color: 'var(--green)', points: state.metricSamples.filter((m) => Number.isFinite(m.throughput_per_100)).map((m) => ({ x: m.tick, y: m.throughput_per_100 })) }]} /><p className="micro-copy">Latest {state.metricSamples.length} samples observed in this view.</p></div>}
          {stats?.failed > 0 && <p style={{ color: 'var(--red)', fontWeight: 650, marginTop: 10 }}>{stats.failed} failed</p>}
        </Window>
        <RobotsPanel robots={state.robots} selectedRobotId={selected?.id} onSelectRobot={setSelectedRobotId} productNames={productNames} />
        <OrdersPanel
          orders={state.orders}
          productNames={productNames}
          disabled={status === 'finished' || status === 'interrupted'}
          onInject={(priority) => run(() => api.injectOrder(sessionId, { priority }))}
        />
        </div>
      </aside>
      </div>
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <dl className="shortcut-list"><dt>Space</dt><dd>Play / pause</dd><dt>1–8</dt><dd>Select robot</dd><dt>P / Q / H</dt><dd>Paths / Q heatmap / yield halos</dd><dt>?</dt><dd>Open this reference</dd><dt>Map focus: + / −</dt><dd>Zoom in / out</dd><dt>Map focus: arrows</dt><dd>Pan the warehouse</dd><dt>Map focus: 0 / F</dt><dd>Fit warehouse / follow selected robot</dd></dl>
      </Dialog>
      {dialog}
    </div>
  );
}
