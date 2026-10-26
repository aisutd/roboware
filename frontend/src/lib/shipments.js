// Vans leaving drop-off zones: which door each van uses and when it pulls away, so vans never overlap.
// A van takes the nearest free door of the zone its order was dropped in; if that zone is busy, the nearest
// free door of an adjacent drop-off zone (a few squares away); only when every one of those is busy does it
// wait for the first door to clear. Decided once per delivery, so a van never jumps mid-drive.
import { findShippingZones } from './grid';
import { TICK_SECONDS } from './pixelArt';

export const VAN_SECONDS = 2.4; // the drive-off animation
export const DOOR_CLEAR_SECONDS = 1.8; // how long a van blocks its door: by then it is more than a van length away
export const NEARBY_ZONE = 3; // squares from the drop-off within which another zone's doors may be borrowed
const MAX_WAIT_SECONDS = 4;

const zoneCache = new WeakMap();
function zonesOf(layout) {
  if (!zoneCache.has(layout)) {
    const zones = findShippingZones(layout.cells).filter((zone) => zone.side);
    const byCell = new Map();
    for (const zone of zones) {
      for (const [x, y] of zone.cells) byCell.set(`${x},${y}`, zone);
    }
    zoneCache.set(layout, { zones, byCell });
  }
  return zoneCache.get(layout);
}

const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const startOf = (van) => van.tick * TICK_SECONDS + van.delay;

// previous: vans still on screen ({ id, door: [x, y], side, tick, delay }); events: this frame's events.
export function scheduleVans(previous, events, tick, layout) {
  const now = tick * TICK_SECONDS;
  // Drop vans that have finished driving away.
  let vans = previous.filter((v) => startOf(v) + VAN_SECONDS + 0.2 > now);
  const deliveries = layout ? events.filter((e) => e.type === 'delivered' && e.at) : [];
  if (!deliveries.length) return vans.length === previous.length ? previous : vans;
  const { zones, byCell } = zonesOf(layout);
  for (const event of deliveries) {
    const own = byCell.get(`${event.at[0]},${event.at[1]}`);
    if (!own) continue; // a dock station: no van
    const nearby = zones.filter((z) => z !== own && z.cells.some((c) => distance(c, event.at) <= NEARBY_ZONE));
    const doors = [own, ...nearby].flatMap((zone) => zone.mouth.map((door) => ({
      door,
      side: zone.side,
      borrowed: zone !== own,
      freeAt: Math.max(now, ...vans.filter((v) => v.door[0] === door[0] && v.door[1] === door[1]).map((v) => startOf(v) + DOOR_CLEAR_SECONDS)),
    })));
    // Free doors first (own zone before a neighbour's, then nearest); otherwise whichever door clears soonest.
    doors.sort((a, b) => a.freeAt - b.freeAt || a.borrowed - b.borrowed || distance(a.door, event.at) - distance(b.door, event.at));
    const pick = doors[0];
    // In a rush of deliveries no van waits long: past MAX_WAIT_SECONDS that order just ships without a van.
    if (pick.freeAt - now > MAX_WAIT_SECONDS) continue;
    vans = [...vans, {
      id: `${event.order}-${tick}`, door: pick.door, side: pick.side, tick, delay: Math.ceil((pick.freeAt - now) * 100) / 100,
    }];
  }
  return vans;
}

// True when two vans would be on the same door at the same time (used by tests).
export function vansOverlap(vans) {
  return vans.some((a, i) => vans.some((b, j) => j > i && a.door[0] === b.door[0] && a.door[1] === b.door[1]
    && Math.abs(startOf(a) - startOf(b)) < DOOR_CLEAR_SECONDS - 1e-9));
}
