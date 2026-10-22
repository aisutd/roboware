import React from 'react';

/**
 * TopMapHud
 * ---------
 * The heads-up-display pill in the TOP-LEFT corner of the screen. From left to
 * right it shows:
 *   1. The "RoboWare OS" brand badge (decorative).
 *   2. Live TICK and EPISODE counters read from the engine.
 *   3. A 3-way switch for the routing algorithm the robots use.
 *   4. Three toggles for the map overlay layers (Paths, Q-Heatmap, Yield Halos).
 *
 * It is a "dumb" component: no state of its own. Clicks call the callbacks
 * below, App.jsx updates the engine / its own state, and the new values flow
 * back down as props on the next render.
 *
 * Props (all passed from App.jsx):
 * - tick                : current simulation tick number (engine.tick, re-synced after every step).
 * - episode             : current training episode number (engine.episode).
 * - routingMode         : 'HYBRID' | 'Q_LEARNING' | 'A_STAR' - which pathfinding strategy is active.
 * - onChangeRoutingMode : App's handleChangeRoutingMode; writes engine.routingMode and re-syncs.
 * - layers              : { paths, qHeatmap, yieldHalos } booleans held in App state.
 *                         WarehouseMapCanvas reads the same object to decide what to draw.
 * - onToggleLayer       : App's handleToggleLayer(key); flips one of those booleans.
 *                         (Keyboard shortcuts P / Q / H in App do the same thing.)
 */
export const TopMapHud = ({
  tick,
  episode,
  routingMode,
  onChangeRoutingMode,
  layers,
  onToggleLayer,
}) => {
  // Card pinned 20px from the top-left of the viewport, laid out as one row.
  return (
    <div
      className="clay-card"
      style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        zIndex: 50,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      {/* RoboWare OS Brand Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #FF6F3D 0%, #FF5A26 100%)',
            boxShadow: '0 4px 10px rgba(255, 90, 38, 0.35), inset 1.5px 1.5px 3px rgba(255, 255, 255, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
            <circle cx="12" cy="5" r="2"></circle>
            <path d="M12 7v4"></path>
            <line x1="8" y1="16" x2="8" y2="16"></line>
            <line x1="16" y1="16" x2="16" y2="16"></line>
          </svg>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 800, fontSize: '13px', letterSpacing: '-0.02em', color: '#23201A' }}>
              RoboWare OS
            </span>
            <span
              style={{
                fontSize: '9px',
                fontWeight: 700,
                color: '#10B981',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                padding: '1px 5px',
                borderRadius: '6px',
                letterSpacing: '0.04em',
              }}
            >
              LIVE
            </span>
          </div>
          <div style={{ fontSize: '10px', color: '#8E8578', fontWeight: 600 }}>
            Fleet Spatial Grid v1.4
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '28px', backgroundColor: '#E2DDD3' }} />

      {/* Tick & Episode Counters: zero-padded (e.g. tick 42 -> "00042") with
          padStart so the width doesn't jump around as the numbers grow. */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#9E9587', letterSpacing: '0.05em' }}>TICK</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: '13px', fontWeight: 700, color: '#23201A' }}>
            {String(tick).padStart(5, '0')}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#9E9587', letterSpacing: '0.05em' }}>EPISODE</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: '13px', fontWeight: 700, color: '#FF5A26' }}>
            {String(episode).padStart(4, '0')}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '28px', backgroundColor: '#E2DDD3' }} />

      {/* Routing Mode Switcher: a segmented control with three buttons. Each one
          compares routingMode to its own value to decide if it looks "selected"
          (white raised pill) or not (transparent). Clicking sends the mode string
          up to App, which sets it on the engine so the next tick uses it:
            HYBRID     - A* pathfinding combined with the learned Q-values
            Q_LEARNING - pure Q-table, epsilon-greedy (sometimes explores randomly)
            A_STAR     - classic deterministic shortest path (Manhattan distance) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#EAE5DC', padding: '3px', borderRadius: '9999px' }}>
        <button
          onClick={() => onChangeRoutingMode('HYBRID')}
          className={`clay-btn clay-pill-sm ${routingMode === 'HYBRID' ? 'active' : ''}`}
          style={{
            fontSize: '11px',
            padding: '4px 10px',
            backgroundColor: routingMode === 'HYBRID' ? '#FAF8F5' : 'transparent',
            boxShadow: routingMode === 'HYBRID' ? '2px 3px 6px rgba(35, 32, 26, 0.1)' : 'none',
            border: 'none',
            color: routingMode === 'HYBRID' ? '#23201A' : '#736B5F',
          }}
          title="Hybrid A* Pathfinding + Q-Learning Policy Convergence"
        >
          Hybrid A* + Q
        </button>

        <button
          onClick={() => onChangeRoutingMode('Q_LEARNING')}
          className={`clay-btn clay-pill-sm ${routingMode === 'Q_LEARNING' ? 'active' : ''}`}
          style={{
            fontSize: '11px',
            padding: '4px 10px',
            backgroundColor: routingMode === 'Q_LEARNING' ? '#FAF8F5' : 'transparent',
            boxShadow: routingMode === 'Q_LEARNING' ? '2px 3px 6px rgba(35, 32, 26, 0.1)' : 'none',
            border: 'none',
            color: routingMode === 'Q_LEARNING' ? '#23201A' : '#736B5F',
          }}
          title="Pure Tabular Q-Learning Epsilon-Greedy Routing"
        >
          Q-Learning
        </button>

        <button
          onClick={() => onChangeRoutingMode('A_STAR')}
          className={`clay-btn clay-pill-sm ${routingMode === 'A_STAR' ? 'active' : ''}`}
          style={{
            fontSize: '11px',
            padding: '4px 10px',
            backgroundColor: routingMode === 'A_STAR' ? '#FAF8F5' : 'transparent',
            boxShadow: routingMode === 'A_STAR' ? '2px 3px 6px rgba(35, 32, 26, 0.1)' : 'none',
            border: 'none',
            color: routingMode === 'A_STAR' ? '#23201A' : '#736B5F',
          }}
          title="Deterministic Manhattan A* Pathfinding"
        >
          Pure A*
        </button>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '28px', backgroundColor: '#E2DDD3' }} />

      {/* Layer Toggles: each button flips one key of the `layers` object. The small
          dot is colored when that layer is on and grey when it is off.
            paths      - dashed line showing each robot's planned route
            qHeatmap   - tints tiles by learned Q-value and shows best-action arrows
            yieldHalos - pulsing ring around a robot that is waiting to avoid a collision */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          onClick={() => onToggleLayer('paths')}
          className={`clay-btn clay-pill-sm ${layers.paths ? 'clay-btn-active' : ''}`}
          style={{
            fontSize: '11px',
            gap: '4px',
            backgroundColor: layers.paths ? '#EDE7DC' : '#FAF8F5',
          }}
          title="Toggle Animated Robot Trajectory Paths"
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: layers.paths ? '#10B981' : '#B8B0A2',
            }}
          />
          Paths
        </button>

        <button
          onClick={() => onToggleLayer('qHeatmap')}
          className={`clay-btn clay-pill-sm ${layers.qHeatmap ? 'clay-btn-active' : ''}`}
          style={{
            fontSize: '11px',
            gap: '4px',
            backgroundColor: layers.qHeatmap ? '#EDE7DC' : '#FAF8F5',
          }}
          title="Toggle Q-Value Heatmap & Policy Arrows"
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: layers.qHeatmap ? '#FF5A26' : '#B8B0A2',
            }}
          />
          Q-Heatmap
        </button>

        <button
          onClick={() => onToggleLayer('yieldHalos')}
          className={`clay-btn clay-pill-sm ${layers.yieldHalos ? 'clay-btn-active' : ''}`}
          style={{
            fontSize: '11px',
            gap: '4px',
            backgroundColor: layers.yieldHalos ? '#EDE7DC' : '#FAF8F5',
          }}
          title="Toggle Multi-Agent Collision Yield Rings"
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: layers.yieldHalos ? '#F59E0B' : '#B8B0A2',
            }}
          />
          Yield Halos
        </button>
      </div>
    </div>
  );
};
