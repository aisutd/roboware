import { coordLabel } from '../lib/grid';
import { isSnoozing } from '../lib/pet';
import { STAGE_ICONS } from '../lib/pixelArt';
import { PixelIcon } from './PixelIcon';
import { RobotPet } from './RobotPet';
import { Window } from './Window';

const STATUS_TEXT = {
  idle: 'Idle', parking: 'Parking', to_pick: 'To shelf', picking: 'Picking', to_pack: 'To packing',
  queued_pack: 'Waiting to pack', packing: 'Packing', to_dock: 'To dock', to_charger: 'To charger', charging: 'Charging',
};
const BATTERY_SEGMENTS = 5;

const batteryTone = (level) => (level > 50 ? 'good' : level > 20 ? 'low' : 'critical');

// An 8-bit battery: five cells that empty as the robot works.
function PixelBattery({ level }) {
  const lit = Math.ceil((Math.max(0, Math.min(100, level)) / 100) * BATTERY_SEGMENTS);
  return (
    <span className={`pixel-battery battery-${batteryTone(level)}`} title={`Battery ${Math.round(level)}%`}>
      <span className="pixel-battery-cells">
        {Array.from({ length: BATTERY_SEGMENTS }, (_, i) => <span key={i} className={i < lit ? 'on' : ''} />)}
      </span>
      <span className="pixel-battery-value">{Math.round(level)}%</span>
    </span>
  );
}

// The robot's current order, in the same stage colour and icon as its ticket in the Orders tab.
function OrderTag({ orderId, status }) {
  const stage = STAGE_ICONS[status] ? status : 'picking';
  return (
    <span className={`fleet-order stage-${stage} ${STAGE_ICONS[status] ? 'on' : ''}`} title={`Working on ${orderId} (${status ?? 'assigned'})`}>
      <svg viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true"><path d={STAGE_ICONS[stage]} /></svg>
      {orderId.replace('ORD-', '#')}
    </span>
  );
}

function RobotChips({ robot, productNames }) {
  const load = robot.package_id ? `Package ${robot.package_id}`
    : robot.carrying?.length ? robot.carrying.map((i) => `${i.qty}× ${productNames[i.sku] ?? i.sku}`).join(', ')
      : null;
  return (
    <div className="fleet-chips">
      {!robot.order_id && <span className="fleet-chip">No order</span>}
      {robot.target && <span className="fleet-chip">→ {coordLabel(robot.target[0], robot.target[1])}</span>}
      {load && <span className="fleet-chip fleet-chip-load">{load}</span>}
      {robot.fallback_leg && <span className="fleet-chip fleet-chip-warn">A* fallback</span>}
    </div>
  );
}

export function RobotsPanel({ robots, selectedRobotId, onSelectRobot, productNames, robotCheers, tick, orders = [], collapsed = false, onToggle, robotNames = {} }) {
  const selected = robots.find((r) => r.id === selectedRobotId);
  const orderStatus = Object.fromEntries(orders.map((o) => [o.id, o.status]));
  return (
    <Window title={<><PixelIcon name="robot" /> Robots <span className="win-count">{robots.length}</span></>} className="operations-robots" bodyStyle={{ padding: 8 }}
      collapsible collapsed={collapsed} onToggle={onToggle}>
      {robots.length === 0 && <p className="muted" style={{ padding: 6 }}>Waiting for the fleet…</p>}
      <div className="fleet-list">
        {robots.map((robot) => {
          const isSelected = robot.id === selected?.id;
          return (
            <button key={robot.id} type="button" className={`fleet-card ${isSelected ? 'selected' : ''}`} style={{ '--robot': robot.color }}
              aria-pressed={isSelected} onClick={() => onSelectRobot(robot.id)}>
              <span className="fleet-card-row">
                <span className="fleet-pet"><RobotPet robot={robot} cheer={robotCheers?.[robot.id]} tick={tick} /></span>
                <span className="fleet-id"><span className="fleet-name">{robotNames[robot.id] ?? robot.id}</span>{robotNames[robot.id] && <span className="fleet-tag">{robot.id}</span>}</span>
                <span className="fleet-status">
                  <span className="fleet-status-text">{robot.yielding ? 'Waiting' : isSnoozing(robot) ? 'Napping' : STATUS_TEXT[robot.status] ?? robot.status}</span>
                  {robot.order_id && <OrderTag orderId={robot.order_id} status={orderStatus[robot.order_id]} />}
                </span>
                <PixelBattery level={robot.battery} />
              </span>
              {isSelected && <RobotChips robot={robot} productNames={productNames} />}
            </button>
          );
        })}
      </div>
    </Window>
  );
}
