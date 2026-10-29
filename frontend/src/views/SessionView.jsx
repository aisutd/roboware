import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GettingStarted } from '../components/GettingStarted';
import { Dialog } from '../components/Dialog';
import { NewSessionDialog } from '../components/NewSessionDialog';
import { OrdersPanel } from '../components/OrdersPanel';
import { RobotsPanel } from '../components/RobotsPanel';
import { SessionBar } from '../components/SessionBar';
import { PixelIcon } from '../components/PixelIcon';
import { SessionStats } from '../components/SessionStats';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { Window } from '../components/Window';
import { useToast } from '../components/toastContext';
import { useSessionStream } from '../hooks/useSessionStream';
import { useAudioPrefs, useSessionSounds } from '../hooks/useSessionSounds';
import { robotName } from '../lib/robotNames';
import { sound } from '../lib/sound';
import { cellKey } from '../lib/grid';
import { api } from '../services/api';

const FLASH_EVENTS = new Set(['delivered', 'picked', 'packed']);
// Floor area covered by the floating panels, so the warehouse fits in the space left over.
const MAP_INSET = { top: 76, right: 0, bottom: 100, left: 0 };
const MAP_INSET_PANELS = { ...MAP_INSET, right: 356 };
const SHORTCUTS = [
  [['Space'], 'Play / pause'],
  [['1', '…', '8'], 'Select a robot (press again to let go)'],
  [['Esc'], 'Deselect the robot'],
  [['P'], 'Show / hide paths'],
  [['Scroll'], 'Zoom in / out around the pointer'],
  [['+', '−'], 'Zoom in / out (map focused)'],
  [['Drag'], 'Move the camera'],
  [['←', '↑', '↓', '→'], 'Move the camera (map focused)'],
  [['0'], 'Reset the view (map focused)'],
  [['F'], 'Follow the selected robot (map focused)'],
  [['?'], 'Open this list'],
];

const FOLDED_KEY = 'roboware.foldedPanels';

// Which right-hand panels (stats, robots, orders) are folded to their title bar, remembered in this browser.
function useFoldedPanels() {
  const [folded, setFolded] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  const toggle = useCallback((key) => setFolded((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable (private mode); folding still works for this visit
    }
    return next;
  }), []);
  return [folded, toggle];
}

export function SessionView({ sessionId, onSessionChange, onNavigate, initialLayoutId = null, initialModelId = null, initialDraft = null, onTrainRequested }) {
  const toast = useToast();
  const sessionRef = useRef(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [folded, toggleFolded] = useFoldedPanels();
  const [helpOpen, setHelpOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [state] = useSessionStream(sessionId);
  const [dialogOpen, setDialogOpen] = useState(Boolean(initialLayoutId));
  const [selectedRobotId, setSelectedRobotId] = useState('R1');
  const [layers, setLayers] = useState({ paths: true });

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
  const selected = state.robots.find((r) => r.id === selectedRobotId) ?? null;
  // Clicking the selected robot again (on the map, its tag or its card) lets it go; null clears the selection.
  const selectRobot = useCallback((id) => setSelectedRobotId((prev) => (id && prev !== id ? id : null)), []);
  const productNames = useMemo(
    () => Object.fromEntries((state.layout?.products ?? []).map((p) => [p.sku, p.name])),
    [state.layout],
  );
  const flashCells = useMemo(
    () => new Set(state.events.filter((e) => FLASH_EVENTS.has(e.type) && e.at).map((e) => cellKey(e.at[0], e.at[1]))),
    [state.events],
  );
  // Each session gets its own crew of names (stable across reloads), e.g. { R1: 'Mochi', R2: 'Bolt' }.
  const robotIds = state.robots.map((r) => r.id).join(',');
  const robotNames = useMemo(
    () => Object.fromEntries(robotIds.split(',').filter(Boolean).map((id) => [id, robotName(id, sessionId ?? '')])),
    [robotIds, sessionId],
  );
  const [audio, toggleAudio] = useAudioPrefs();
  useSessionSounds({
    events: state.events, status, ready: Boolean(state.layout), prefs: audio,
    chatter: state.robotChatter, tick: state.tick, quietRobotId: selected?.id,
  });

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

  const control = useCallback((action) => {
    sound.play('click');
    return run(() => api.controlSession(sessionId, action));
  }, [run, sessionId]);
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
        selectRobot(`R${e.key}`);
      } else if (e.key === 'Escape') {
        selectRobot(null);
      } else if (e.key.toLowerCase() === 'p') {
        toggleLayer('paths');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionId, status, control, toggleLayer, selectRobot, dialogOpen, helpOpen]);

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

  return (
    <div ref={sessionRef} className={`session session-immersive ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
      <div className="session-map">
        <WarehouseMapCanvas
          layout={state.layout}
          robots={state.robots}
          stations={state.stations}
          stock={state.stock}
          selectedRobotId={selected?.id}
          onSelectRobot={selectRobot}
          layers={layers}
          flashCells={flashCells}
          flashToken={state.tick}
          robotCheers={state.robotCheers}
          robotChatter={state.robotChatter}
          robotReactions={state.robotReactions}
          robotTrails={state.robotTrails}
          receiving={state.receiving}
          shipments={state.shipments}
          paused={status !== 'running'}
          robotNames={robotNames}
          routingMode={session?.config?.routing_mode}
          overlay
          inset={inspectorOpen ? MAP_INSET_PANELS : MAP_INSET}
        />
      </div>
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
        onResults={() => onNavigate('history')}
        panelsOpen={inspectorOpen}
        onTogglePanels={() => setInspectorOpen((v) => !v)}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onHelp={() => setHelpOpen(true)}
        audio={audio}
        onToggleAudio={toggleAudio}
      />
      <aside id="operational-inspector" className="session-side hud-side" hidden={!inspectorOpen} aria-label="Stats, robots and orders">
        <Window title={<><PixelIcon name="stats" /> Stats</>} className="operations-stats" style={{ flex: 'none' }}
          collapsible collapsed={folded.stats} onToggle={() => toggleFolded('stats')}>
          <SessionStats stats={state.stats} orders={state.orders} receiving={state.receiving} />
        </Window>
        <RobotsPanel robots={state.robots} selectedRobotId={selected?.id} onSelectRobot={selectRobot} productNames={productNames}
          robotCheers={state.robotCheers} tick={state.tick} orders={state.orders} robotNames={robotNames}
          collapsed={folded.robots} onToggle={() => toggleFolded('robots')} />
        <OrdersPanel
          collapsed={folded.orders}
          onToggle={() => toggleFolded('orders')}
          orders={state.orders}
          productNames={productNames}
          robots={state.robots}
          selectedRobotId={selected?.id}
          onSelectRobot={selectRobot}
          robotCheers={state.robotCheers}
          robotNames={robotNames}
          tick={state.tick}
          disabled={status === 'finished' || status === 'interrupted'}
          onInject={(priority) => run(() => api.injectOrder(sessionId, { priority }))}
        />
      </aside>
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={action} className="shortcut-row">
              <dt>{keys.map((k) => <kbd key={k} className="px-key">{k}</kbd>)}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
      {dialog}
    </div>
  );
}
