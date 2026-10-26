import { NAVIGATION_LABELS, NAVIGATION_MODES } from '../lib/navigation';
import { PixelIcon } from './PixelIcon';

const STATUS = {
  running: ['Running', 'live'], paused: ['Paused', 'hold'], created: ['Ready', 'hold'],
  finished: ['Finished', 'off'], interrupted: ['Stopped', 'off'],
};
const TICK_DIGITS = 5;

// The tick counter as an odometer: each digit sits in its own cell and flips when it changes.
function TickOdometer({ tick }) {
  const digits = String(tick).padStart(TICK_DIGITS, '0').split('');
  return (
    <div className="tick-odometer" title="Simulation tick: one step of the simulation (0.6 s)">
      <span className="tick-label">Tick</span>
      <span className="tick-digits">
        {/* Keyed on the digit so a changed digit remounts and replays the flip. */}
        {digits.map((d, i) => <span key={`${i}-${d}`} className="tick-digit">{d}</span>)}
      </span>
    </div>
  );
}

// Session identity and controls, floating over the warehouse floor.
export function SessionBar({
  session, connected, tick, layers, onToggleLayer, onControl, onNewSession, onSaveModel, onResults,
  panelsOpen, onTogglePanels, fullscreen, onToggleFullscreen, onHelp, audio, onToggleAudio,
}) {
  const status = session?.status ?? 'created';
  const config = session?.config ?? {};
  const running = status === 'running';
  const over = !session || status === 'finished' || status === 'interrupted';
  const [statusLabel, led] = connected ? STATUS[status] ?? [status, 'off'] : ['Offline', 'down'];
  const mode = NAVIGATION_MODES.find((m) => m.id === config.routing_mode);

  return (
    <>
      <header className="hud-glass hud-identity">
        <span className={`status-led led-${led}`} aria-hidden="true" />
        <div className="hud-identity-text">
          <div className="hud-identity-row">
            <h1 className="session-name">{session?.name ?? 'Loading session…'}</h1>
            <span className={`status-word led-${led}`}>{statusLabel}</span>
          </div>
          <div className="hud-meta">
            <span className="hud-chip" title={mode?.description}>{NAVIGATION_LABELS[config.routing_mode] ?? 'Shortest path'}</span>
            <span className="hud-chip">{session?.model_name ?? 'No model'}</span>
            {config.online_learning && <span className="hud-chip hud-chip-learning">Learning</span>}
          </div>
        </div>
        <TickOdometer tick={tick} />
      </header>

      <div className="hud-glass hud-toolbar" role="toolbar" aria-label="Simulation controls">
        <div className="bar-group">
          <button type="button" className={`px-btn ${running ? '' : 'px-primary'}`} style={{ minWidth: 92 }}
            onClick={() => onControl(running ? 'pause' : 'play')} disabled={over} title="Play / pause (Space)">
            <PixelIcon name={running ? 'pause' : 'play'} /> {running ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="px-btn" onClick={() => onControl('step')} disabled={running || over} title="Advance one tick">
            <PixelIcon name="step" /> Step
          </button>
          <button type="button" className="px-btn px-danger" onClick={() => onControl('stop')} disabled={over} title="End the session and save its results">
            <PixelIcon name="stop" /> Stop
          </button>
        </div>
        <div className="bar-group">
          <button type="button" className="px-btn px-toggle" aria-pressed={layers.paths} onClick={() => onToggleLayer('paths')} title="Show robot paths (P)">
            <span className="px-led" /><PixelIcon name="paths" /> Paths
          </button>
          <button type="button" className="px-btn px-toggle" onClick={onTogglePanels} aria-pressed={panelsOpen} aria-controls="operational-inspector"
            title={panelsOpen ? 'Hide stats, robots and orders' : 'Show stats, robots and orders'}>
            <span className="px-led" /><PixelIcon name="panels" /> Panels
          </button>
          {audio && (
            <>
              <button type="button" className="px-btn px-toggle" aria-pressed={audio.music} onClick={() => onToggleAudio('music')} title="Background music" aria-label="Background music">
                <span className="px-led" /><PixelIcon name="music" />
              </button>
              <button type="button" className="px-btn px-toggle" aria-pressed={audio.sfx} onClick={() => onToggleAudio('sfx')} title="Sound effects" aria-label="Sound effects">
                <span className="px-led" /><PixelIcon name="sfx" />
              </button>
            </>
          )}
          <button type="button" className="px-btn px-square" onClick={onToggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <PixelIcon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} />
          </button>
          <button type="button" className="px-btn px-square" onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            <PixelIcon name="help" />
          </button>
        </div>
        <div className="bar-group">
          {over && session && onResults && <button type="button" className="px-btn" onClick={onResults}><PixelIcon name="results" /> Results</button>}
          {config.online_learning && onSaveModel && (
            <button type="button" className="px-btn" onClick={onSaveModel}><PixelIcon name="save" /> Save model</button>
          )}
          <button type="button" className="px-btn px-primary" onClick={onNewSession}><PixelIcon name="plus" /> New session</button>
        </div>
      </div>
    </>
  );
}
