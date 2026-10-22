import React from 'react';

/**
 * PlaybackDock
 * ------------
 * The "media player" style control bar centered at the BOTTOM of the screen.
 * It controls time in the simulation: play/pause, step one tick, fast-train
 * 100 Q-learning episodes, change speed, and reset the world.
 *
 * Like the other HUD panels, it holds no state of its own. Every button just
 * calls a callback that App.jsx gave it, and App updates the engine + React state.
 *
 * Props (all passed from App.jsx):
 * - isPlaying     : true while App's setInterval loop is auto-stepping the engine.
 * - onTogglePlay  : flips isPlaying in App (same as pressing the Space bar).
 * - onStep        : App's handleStep; runs engine.step() once and re-syncs state.
 * - onFastTrain   : App's handleFastTrain; runs engine.fastTrain100() (100 training episodes, no animation).
 * - isTraining    : true while that fast-train is running; disables the button and spins its icon.
 * - onResetWorld  : App's handleResetDefaultLayout; restores default layout, robots and KPIs.
 * - speed         : current speed multiplier (1, 2, 5 or 10). App uses it to set the tick interval
 *                   (600ms / speed, never faster than 40ms).
 * - onChangeSpeed : App's setSpeed setter.
 */
export const PlaybackDock = ({
  isPlaying,
  onTogglePlay,
  onStep,
  onFastTrain,
  isTraining,
  onResetWorld,
  speed,
  onChangeSpeed,
}) => {
  // The speed multipliers offered as pill buttons.
  const speeds = [1, 2, 5, 10];

  // Card centered horizontally (left 50% + translateX(-50%)) 20px above the bottom edge.
  return (
    <div
      className="clay-card"
      style={{
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        padding: '8px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
      }}
    >
      {/* Play / Pause Toggle Button: shows a PAUSE icon while running and a PLAY
          icon while stopped. Turns accent-colored while the sim is playing. */}
      <button
        onClick={onTogglePlay}
        className={`clay-btn ${isPlaying ? 'clay-btn-accent' : ''}`}
        style={{
          padding: '7px 16px',
          fontWeight: 700,
          fontSize: '12px',
          minWidth: '92px',
        }}
        title="Toggle Simulation Run / Pause (Shortcut: Space)"
      >
        {isPlaying ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"></rect>
              <rect x="14" y="4" width="4" height="16" rx="1"></rect>
            </svg>
            PAUSE
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            PLAY
          </>
        )}
      </button>

      {/* Step Single Tick: advance exactly one tick. Disabled while playing,
          because the auto-play loop is already stepping. */}
      <button
        onClick={onStep}
        className="clay-btn"
        style={{
          padding: '7px 12px',
          fontSize: '12px',
        }}
        title="Advance Simulation by 1 Tick"
        disabled={isPlaying}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 4 15 12 5 20 5 4" fill="currentColor"></polygon>
          <line x1="19" y1="5" x2="19" y2="19"></line>
        </svg>
        Step
      </button>

      {/* Fast Train +100 Episodes: trains the Q-table offline in one go. App sets
          isTraining=true, waits 50ms so this "Training..." label can render, then
          runs the training synchronously and sets isTraining back to false. */}
      <button
        onClick={onFastTrain}
        disabled={isTraining}
        className="clay-btn"
        style={{
          padding: '7px 14px',
          fontSize: '12px',
          backgroundColor: isTraining ? '#EAE5DC' : '#FAF8F5',
          color: '#23201A',
        }}
        title="Fast-forward simulate 100 Q-Learning training episodes instantly"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FF5A26"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            animation: isTraining ? 'spin 1s linear infinite' : 'none',
          }}
        >
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#FF5A26" />
        </svg>
        {isTraining ? 'Training...' : '+100 Episodes'}
      </button>

      {/* Divider */}
      <div style={{ width: '1px', height: '26px', backgroundColor: '#E2DDD3' }} />

      {/* Speed Multiplier Pills: a segmented control. The pill matching the
          current `speed` prop gets the raised white style; clicking one sends its
          value up to App, which restarts the timer loop at the new interval. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#EAE5DC', padding: '3px', borderRadius: '9999px' }}>
        {speeds.map((s) => {
          const isActive = speed === s;
          return (
            <button
              key={s}
              onClick={() => onChangeSpeed(s)}
              className={`clay-btn clay-pill-sm ${isActive ? 'active' : ''}`}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono',
                fontWeight: 700,
                backgroundColor: isActive ? '#FAF8F5' : 'transparent',
                boxShadow: isActive ? '2px 3px 6px rgba(35, 32, 26, 0.1)' : 'none',
                border: 'none',
                color: isActive ? '#23201A' : '#736B5F',
              }}
              title={`Simulation Speed ${s}x`}
            >
              {s}x
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '26px', backgroundColor: '#E2DDD3' }} />

      {/* Reset World: same handler as the toolbar's "Reset Grid" button; restores
          the default layout and puts the robots and KPIs back to their starting state. */}
      <button
        onClick={onResetWorld}
        className="clay-btn"
        style={{
          padding: '7px 11px',
          fontSize: '12px',
          color: '#8E8578',
        }}
        title="Reset Entire Simulation World & Fleet State"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <polyline points="3 3 3 8 8 8"></polyline>
        </svg>
        Reset
      </button>
    </div>
  );
};
