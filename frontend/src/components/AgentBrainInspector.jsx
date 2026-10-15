import { useState } from 'react';
import { ACTION_ARROWS, ACTIONS, coordLabel } from '../lib/grid';

const STATUS_TEXT = {
  idle: 'Idle', parking: 'Parking', to_pick: 'Going to shelf', picking: 'Picking', to_pack: 'Going to packing',
  queued_pack: 'Waiting for packing', packing: 'Packing', to_dock: 'Shipping to dock', to_charger: 'Going to charge', charging: 'Charging',
};
const PAD = { up: [1, 2], left: [2, 1], right: [2, 3], down: [3, 2] };

export function AgentBrainInspector({ robots, selectedRobotId, onSelectRobot, productNames }) {
  const [collapsed, setCollapsed] = useState(false);
  const robot = robots.find((r) => r.id === selectedRobotId) ?? robots[0];
  if (!robot) return null;
  const q = robot.q_scores;
  const best = q ? Math.max(...ACTIONS.map((a) => q[a])) : null;
  return (
    <div className="clay-card hud" style={{ bottom: 20, right: 20, width: collapsed ? 'auto' : 330, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed ? 0 : 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em' }}>ROBOT INSPECTOR</span>
        <button type="button" className="clay-btn clay-pill-sm" style={{ fontSize: 10 }} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▲ EXPAND' : '▼ HIDE'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {robots.map((r) => (
              <button key={r.id} type="button" onClick={() => onSelectRobot(r.id)}
                className={`clay-btn clay-pill-sm ${r.id === robot.id ? 'active' : ''}`}
                style={{ flex: 1, fontFamily: 'JetBrains Mono', fontSize: 11, color: r.id === robot.id ? r.color : '#736B5F' }}>
                {r.id}
              </button>
            ))}
          </div>
          <div className="clay-card-flat" style={{ padding: '10px 12px', marginBottom: 10, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>{STATUS_TEXT[robot.status] ?? robot.status}{robot.yielding ? ' (waiting)' : ''}</strong>
              <span className="font-mono">BATTERY {Math.round(robot.battery)}%</span>
            </div>
            <div className="progress" style={{ height: 5, marginBottom: 8 }}>
              <div style={{ width: `${robot.battery}%`, background: robot.battery > 50 ? '#10B981' : robot.battery > 20 ? '#F59E0B' : '#EF4444' }} />
            </div>
            <div>At <span className="font-mono">{coordLabel(robot.x, robot.y)}</span>
              {robot.target && <> → <span className="font-mono">{coordLabel(robot.target[0], robot.target[1])}</span></>}
              {robot.order_id && <> · {robot.order_id}</>}
            </div>
            <div style={{ marginTop: 4, color: '#6B6357' }}>
              {robot.package_id ? `Carrying package ${robot.package_id}`
                : robot.carrying?.length ? `Carrying ${robot.carrying.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')}`
                  : 'Empty'}
              {robot.fallback_leg && <span className="badge badge-warn" style={{ marginLeft: 6 }}>A* FALLBACK</span>}
            </div>
          </div>
          <div className="view-subtitle">Q-values at this cell</div>
          {q ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 6, width: 190, margin: '0 auto' }}>
              {ACTIONS.map((a) => (
                <div key={a} className="clay-card-flat" style={{
                  gridRow: PAD[a][0], gridColumn: PAD[a][1], padding: '6px 2px', textAlign: 'center',
                  border: q[a] === best ? '1.5px solid #FF5A26' : undefined, background: q[a] === best ? '#FFE7DF' : undefined,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#8E8578' }}>{ACTION_ARROWS[a]} {a.toUpperCase()}</div>
                  <div className="font-mono" style={{ fontSize: 11, fontWeight: 800 }}>{q[a]}</div>
                </div>
              ))}
              <div style={{ gridRow: 2, gridColumn: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono', fontWeight: 800, color: robot.color }}>{robot.id}</div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#8E8578' }}>No Q-table for this target, so this leg uses A*.</div>
          )}
        </>
      )}
    </div>
  );
}
