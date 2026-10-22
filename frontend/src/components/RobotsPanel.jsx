import { batteryColor } from '../lib/battery';
import { ACTION_ARROWS, ACTIONS, coordLabel } from '../lib/grid';
import { Window } from './Window';

const STATUS_TEXT = {
  idle: 'Idle', parking: 'Parking', to_pick: 'Going to shelf', picking: 'Picking', to_pack: 'Going to packing',
  queued_pack: 'Waiting to pack', packing: 'Packing', to_dock: 'Going to dock', to_charger: 'Going to charge', charging: 'Charging',
};
const PAD = { up: [1, 2], left: [2, 1], right: [2, 3], down: [3, 2] };

function RobotDetail({ robot, productNames }) {
  const q = robot.q_scores;
  const best = q ? Math.max(...ACTIONS.map((a) => q[a])) : null;
  const load = robot.package_id ? `Package ${robot.package_id}`
    : robot.carrying?.length ? robot.carrying.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')
      : 'Empty';
  return (
    <div className="robot-detail">
      {q && (
        <div className="q-pad" title="Q-values at this cell; the best move is highlighted">
          {ACTIONS.map((a) => (
            <div key={a} className={q[a] === best ? 'best' : ''} style={{ gridRow: PAD[a][0], gridColumn: PAD[a][1] }}>
              {ACTION_ARROWS[a]} {q[a]}
            </div>
          ))}
        </div>
      )}
      <div style={{ lineHeight: 1.6, minWidth: 0 }}>
        <div style={{ color: 'var(--ink)', fontWeight: 650 }}>
          {coordLabel(robot.x, robot.y)}{robot.target && ` to ${coordLabel(robot.target[0], robot.target[1])}`}
        </div>
        <div>{load}</div>
        <div>{Math.round(robot.battery)}% battery</div>
        {robot.fallback_leg && <span className="badge badge-warn">A* fallback</span>}
      </div>
    </div>
  );
}

export function RobotsPanel({ robots, selectedRobotId, onSelectRobot, productNames }) {
  const selected = robots.find((r) => r.id === selectedRobotId) ?? robots[0];
  return (
    <Window title="Robots" style={{ flex: '0 1 auto' }} bodyStyle={{ padding: 0 }}>
      {robots.map((robot) => (
        <div key={robot.id}>
          <button type="button" className={`robot-row ${robot.id === selected?.id ? 'selected' : ''}`} onClick={() => onSelectRobot(robot.id)}>
            <span className="robot-chip" style={{ background: robot.color }} />
            <strong style={{ width: 24 }}>{robot.id}</strong>
            <span style={{ flex: 1, color: 'var(--ink-2)' }}>{STATUS_TEXT[robot.status] ?? robot.status}{robot.yielding ? ' (waiting)' : ''}</span>
            <span className="mini-bar" title={`Battery ${Math.round(robot.battery)}%`}>
              <div style={{ width: `${robot.battery}%`, background: batteryColor(robot.battery) }} />
            </span>
          </button>
          {robot.id === selected?.id && <RobotDetail robot={robot} productNames={productNames} />}
        </div>
      ))}
    </Window>
  );
}
