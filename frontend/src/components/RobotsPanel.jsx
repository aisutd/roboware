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
      <div className="robot-inspector">
        <div className="eyebrow">{robot.id} / Robot inspector</div>
        <dl className="telemetry-grid">
          <dt>Task</dt><dd>{robot.order_id ?? 'No assigned order'}</dd>
          <dt>Position</dt><dd>{coordLabel(robot.x, robot.y)}</dd>
          <dt>Destination</dt><dd>{robot.target ? coordLabel(...robot.target) : 'No destination'}</dd>
          <dt>Battery</dt><dd style={{ color: batteryColor(robot.battery) }}>{Math.round(robot.battery)}%</dd>
          <dt>Payload</dt><dd>{load}</dd>
          <dt>Operation</dt><dd>{STATUS_TEXT[robot.status] ?? robot.status}</dd>
        </dl>
        {robot.fallback_leg && <span className="badge badge-warn">A* fallback routing</span>}
        {q && <p className="micro-copy">Q-values by direction. Amber marks the best available action.</p>}
      </div>
    </div>
  );
}

export function RobotsPanel({ robots, selectedRobotId, onSelectRobot, productNames }) {
  const selected = robots.find((r) => r.id === selectedRobotId) ?? robots[0];
  return (
    <Window title={`Robots (${robots.length})`} className="operations-robots" bodyStyle={{ padding: 0 }}>
      {robots.length === 0 && <p className="panel muted">Waiting for fleet data…</p>}
      {robots.map((robot) => (
        <div key={robot.id}>
          <button type="button" className={`robot-row ${robot.id === selected?.id ? 'selected' : ''}`} aria-pressed={robot.id === selected?.id} onClick={() => onSelectRobot(robot.id)}>
            <span className="robot-chip" style={{ background: robot.color }} />
            <span className="fleet-row-main"><span className="fleet-row-title"><strong>{robot.id}</strong><span>{STATUS_TEXT[robot.status] ?? robot.status}{robot.yielding ? ' · Yielding' : ''}</span></span>
              <span className="fleet-row-context">{coordLabel(robot.x, robot.y)} → {robot.target ? coordLabel(...robot.target) : '—'}{robot.order_id ? ` · ${robot.order_id}` : ''}</span>
            </span>
            <span className="fleet-battery"><span style={{ color: batteryColor(robot.battery) }}>{Math.round(robot.battery)}%</span><span className="mini-bar" title={`Battery ${Math.round(robot.battery)}%`}><span style={{ display: 'block', height: '100%', width: `${robot.battery}%`, background: batteryColor(robot.battery) }} /></span></span>
          </button>
          {robot.id === selected?.id && <RobotDetail robot={robot} productNames={productNames} />}
        </div>
      ))}
    </Window>
  );
}
