// Receiving on the map: the lane and dock light at each unload bay, the delivery truck that backs in,
// drops pallets and drives off, the pallets on the bay floor, and the crate a restocking robot carries.
import { TICK_SECONDS } from '../lib/pixelArt';
import { OUTWARD, TRUCK_LENGTH, TRUCK_ROOM, TRUCK_UNIT, truckPaint } from '../lib/receiving';

const W = 16;
const H = 48;
const RIBS = [18, 22, 26, 30, 34, 38, 42];
const VISIBLE = new Set(['arriving', 'unloading', 'leaving']);

// Top-down pixel truck, drawn pointing up with its rear doors at the bottom edge.
function TruckSprite({ paint, open }) {
  return (
    <svg className="truck-art" viewBox={`-3 -1 ${W + 6} ${H + 2}`} width={(W + 6) * TRUCK_UNIT} height={(H + 2) * TRUCK_UNIT}
      shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="2" width={W - 1} height={H - 1} fill="#000" opacity="0.32" />
      {/* wheels */}
      <g fill="#14181d">
        {[5, 34, 39].map((y) => <g key={y}><rect x="0" y={y} width="1" height="3" /><rect x={W - 1} y={y} width="1" height="3" /></g>)}
      </g>
      {/* cab */}
      <rect x="1" y="0" width={W - 2} height="12" fill={paint} />
      <rect x="2" y="1" width={W - 4} height="1" fill="#fff" opacity="0.28" />
      <rect x="3" y="3" width={W - 6} height="3" fill="#9fd3ff" />
      <rect x="4" y="3" width="2" height="1" fill="#fff" opacity="0.8" />
      <rect x="5" y="0" width="6" height="1" fill="#2a2f36" />
      <rect className="truck-headlight" x="1" y="0" width="2" height="1" fill="#ffe9a6" />
      <rect className="truck-headlight" x={W - 3} y="0" width="2" height="1" fill="#ffe9a6" />
      <rect x="0" y="4" width="1" height="1" fill="#2a2f36" />
      <rect x={W - 1} y="4" width="1" height="1" fill="#2a2f36" />
      <rect x="3" y="8" width={W - 6} height="3" fill="#000" opacity="0.18" />
      <rect x="12" y="9" width="1" height="3" fill="#2a2f36" />
      {/* hitch */}
      <rect x="6" y="12" width="4" height="1" fill="#2a2f36" />
      {/* trailer roof */}
      <rect x="1" y="13" width={W - 2} height="34" fill="#dfe5ea" />
      <rect x="1" y="13" width={W - 2} height="1" fill="#f5f8fa" />
      {RIBS.map((y) => <rect key={y} x="2" y={y} width={W - 4} height="1" fill="#c3ccd4" />)}
      <rect x="1" y="14" width="1" height="33" fill={paint} />
      <rect x={W - 2} y="14" width="1" height="33" fill={paint} />
      {/* the cargo mark: a kraft box */}
      <rect x="5" y="25" width="6" height="6" fill="#c9a46f" />
      <rect x="7" y="25" width="2" height="6" fill="#e8d3a8" />
      <rect x="5" y="25" width="6" height="1" fill="#a5814e" />
      {/* rear doors, tail and reversing lights */}
      <g className={`truck-doors ${open ? 'is-open' : ''}`}>
        <rect className="door-l" x="1" y="46" width="7" height="2" fill="#aab4bd" />
        <rect className="door-r" x="8" y="46" width="7" height="2" fill="#9aa4ad" />
      </g>
      <rect x="1" y="47" width="2" height="1" fill="#ff4d4d" className="truck-tail" />
      <rect x={W - 3} y="47" width="2" height="1" fill="#ff4d4d" className="truck-tail" />
      <rect x="4" y="47" width="1" height="1" fill="#fff" className="truck-reverse" />
      <rect x={W - 5} y="47" width="1" height="1" fill="#fff" className="truck-reverse" />
    </svg>
  );
}

// One bay: the painted lane outside it, a dock light, and the truck when one is here.
export function TruckDock({ anchor, truck, waiting, ghost = false }) {
  const visible = truck && VISIBLE.has(truck.state);
  const light = !truck ? 'idle' : truck.state === 'unloading' ? 'docked' : 'inbound';
  return (
    <div className={`truck-dock ${ghost ? 'is-ghost' : ''}`} style={{ left: anchor.x, top: anchor.y, transform: `rotate(${anchor.rotate}deg)`, '--span': `${Math.max(anchor.span, 48)}px`, '--room': `${TRUCK_ROOM}px` }}>
      <div className="dock-lane" />
      <span className={`dock-light light-${light}`} title={waiting ? `${waiting} refills waiting for a truck` : undefined} />
      {ghost && <div className="truck-ghost" style={{ width: (W + 6) * TRUCK_UNIT, height: TRUCK_LENGTH }} />}
      {visible && (
        <div key={`${truck.id}-${truck.state}`} className={`truck truck-${truck.state}`}
          style={{ '--dur': `${Math.max(1, truck.total) * TICK_SECONDS}s`, '--counter': `${-anchor.rotate}deg` }}
          title={`${truck.name} · ${truck.cargo.length + truck.unloaded} pallets`}>
          <TruckSprite paint={truckPaint(truck.name)} open={truck.state === 'unloading'} />
          <span className="truck-puff p1" /><span className="truck-puff p2" />
          {truck.state === 'unloading' && <span className="truck-name">{truck.name}</span>}
        </div>
      )}
    </div>
  );
}

// The road outside a drop-off zone: same lane as the trucks' but in drop-off green, with an exit arrow.
export function VanRoad({ anchor }) {
  return (
    <div className="truck-dock van-road" style={{ left: anchor.x, top: anchor.y, transform: `rotate(${anchor.rotate}deg)`, '--span': `${Math.max(anchor.span, 48)}px`, '--room': `${TRUCK_ROOM}px` }}>
      <div className="dock-lane" />
    </div>
  );
}

// A delivery van that pulls away from a drop-off zone the moment a robot drops an order there.
// delay (seconds) holds it at the door while the van ahead clears it.
export function DeliveryVan({ anchor, delay = 0 }) {
  return (
    <div className="truck-dock van-dock" style={{ left: anchor.x, top: anchor.y, transform: `rotate(${anchor.rotate}deg)` }}>
      <div className="van" style={{ animationDelay: `${delay}s` }}>
        <svg viewBox="-1 -1 14 24" width={14 * TRUCK_UNIT} height={24 * TRUCK_UNIT} shapeRendering="crispEdges" aria-hidden="true">
          <rect x="1" y="1" width="11" height="21" fill="#000" opacity="0.3" />
          <g fill="#14181d"><rect x="-1" y="3" width="1" height="3" /><rect x="12" y="3" width="1" height="3" /><rect x="-1" y="15" width="1" height="3" /><rect x="12" y="15" width="1" height="3" /></g>
          <rect x="0" y="0" width="12" height="22" fill="#eef2f5" />
          <rect x="0" y="0" width="12" height="1" fill="#fff" />
          <rect x="2" y="2" width="8" height="3" fill="#9fd3ff" />
          <rect x="3" y="2" width="2" height="1" fill="#fff" opacity="0.8" />
          <rect x="0" y="0" width="2" height="1" fill="#ffe9a6" /><rect x="10" y="0" width="2" height="1" fill="#ffe9a6" />
          <rect x="0" y="9" width="12" height="2" fill="#5fd38f" />
          <rect x="4" y="13" width="4" height="4" fill="#c9a46f" /><rect x="5.5" y="13" width="1" height="4" fill="#e8d3a8" />
          <rect x="0" y="21" width="2" height="1" fill="#ff4d4d" /><rect x="10" y="21" width="2" height="1" fill="#ff4d4d" />
        </svg>
        <span className="truck-puff p1" />
      </div>
    </div>
  );
}

// A pallet of stock on the bay floor. It slides in from the truck's side when dropped.
export function PalletSprite({ pallet, side, name }) {
  const [ox, oy] = OUTWARD[side] ?? [0, -1];
  return (
    <div className="pallet" style={{ '--fx': `${ox * 46}px`, '--fy': `${oy * 46}px` }} title={`${name ?? pallet.sku} ×${pallet.qty}${pallet.robot ? ` · ${pallet.robot} is coming for it` : ''}`}>
      <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="0" y="9" width="12" height="2" fill="#8a6a3f" />
        <rect x="1" y="11" width="2" height="1" fill="#5e4527" /><rect x="5" y="11" width="2" height="1" fill="#5e4527" /><rect x="9" y="11" width="2" height="1" fill="#5e4527" />
        <rect x="1" y="4" width="5" height="5" fill="#c9a46f" /><rect x="6" y="4" width="5" height="5" fill="#b8925c" />
        <rect x="3" y="0" width="6" height="4" fill="#d6b47e" />
        <rect x="3" y="4" width="1" height="5" fill="#e8d3a8" /><rect x="8" y="4" width="1" height="5" fill="#e8d3a8" /><rect x="5" y="0" width="2" height="4" fill="#efdcb5" />
      </svg>
      <span className="pallet-tag">{pallet.sku.replace('SKU-', '#')}<b>×{pallet.qty}</b></span>
      {pallet.robot && <span className="pallet-claim" />}
    </div>
  );
}

// The crate a robot carries from the bay to the shelf.
export function CargoCrate({ pallet }) {
  return (
    <span className="robot-cargo" title={`${pallet.sku} ×${pallet.qty}`}>
      <svg viewBox="0 0 6 5" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="0" y="0" width="6" height="5" fill="#c9a46f" /><rect x="2" y="0" width="2" height="5" fill="#e8d3a8" /><rect x="0" y="0" width="6" height="1" fill="#a5814e" />
      </svg>
      <b>{pallet.qty}</b>
    </span>
  );
}
