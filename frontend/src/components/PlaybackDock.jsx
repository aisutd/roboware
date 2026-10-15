import React from 'react';

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
  const speeds = [1, 2, 5, 10];

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
      {/* Play / Pause Toggle Button */}
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

      {/* Step Single Tick */}
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

      {/* Fast Train +100 Episodes */}
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

      {/* Speed Multiplier Pills */}
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

      {/* Reset World */}
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
