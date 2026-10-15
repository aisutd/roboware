import { Pause, Play, SkipForward, Square } from 'lucide-react';

const SPEEDS = [1, 2, 5, 10, 'max'];

export function PlaybackDock({ status, speed, onPlay, onPause, onStep, onStop, onSpeed }) {
  const running = status === 'running';
  const over = status === 'finished' || status === 'interrupted';
  return (
    <div className="clay-card hud" style={{ bottom: 20, left: '50%', transform: 'translateX(-50%)', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <button type="button" onClick={running ? onPause : onPlay} disabled={over}
        className={`clay-btn ${running ? 'clay-btn-accent' : ''}`} style={{ padding: '7px 16px', fontWeight: 700, fontSize: 12, minWidth: 92 }}
        title="Play / pause (Space)">
        {running ? <><Pause size={14} /> PAUSE</> : <><Play size={14} /> PLAY</>}
      </button>
      <button type="button" onClick={onStep} disabled={running || over} className="clay-btn" style={{ fontSize: 12 }} title="Advance one tick">
        <SkipForward size={14} /> Step
      </button>
      <div style={{ display: 'flex', gap: 4, background: '#EAE5DC', padding: 3, borderRadius: 9999 }}>
        {SPEEDS.map((s) => (
          <button key={s} type="button" onClick={() => onSpeed(s)} disabled={over}
            className={`clay-btn clay-pill-sm ${speed === s ? 'active' : ''}`}
            style={{ fontFamily: 'JetBrains Mono', fontSize: 11, border: 'none', background: speed === s ? '#FAF8F5' : 'transparent' }}>
            {s === 'max' ? 'MAX' : `${s}x`}
          </button>
        ))}
      </div>
      <button type="button" onClick={onStop} disabled={over} className="clay-btn" style={{ fontSize: 12, color: '#8E8578' }} title="End the session and save its results">
        <Square size={13} /> Stop
      </button>
    </div>
  );
}
