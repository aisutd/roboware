import { ICON_CLIPBOARD, ICON_CLOCK, ICON_PACKAGE, TICK_SECONDS } from '../lib/pixelArt';
import { truckPaint } from '../lib/receiving';
import { PixelIcon } from './PixelIcon';

// What the receiving dock is up to, in a few words.
function dockLine(receiving) {
  const truck = receiving?.trucks?.[0];
  if (truck?.state === 'en_route') return { truck, text: `${truck.name} on the road`, eta: `${Math.max(1, Math.round((truck.timer + 5) * TICK_SECONDS))}s` };
  if (truck?.state === 'arriving') return { truck, text: `${truck.name} backing in` };
  if (truck?.state === 'unloading') return { truck, text: `${truck.name} unloading`, eta: `${truck.cargo.length} left` };
  if (truck?.state === 'leaving') return { truck, text: `${truck.name} heading out` };
  const waiting = receiving?.backlog?.length ?? 0;
  return { truck: null, text: waiting ? `${waiting} refill${waiting > 1 ? 's' : ''} on order` : 'Shelves stocked' };
}


// Three 8-bit stat tiles: deliveries, average order time in whole seconds, and orders still in progress.
export function SessionStats({ stats, orders, receiving = null }) {
  const active = orders.filter((o) => o.status !== 'delivered' && o.status !== 'failed').length;
  const avgSeconds = stats?.avg_cycle_time == null ? null : Math.round(stats.avg_cycle_time * TICK_SECONDS);
  const tiles = [
    { key: 'delivered', label: 'Delivered', value: stats?.delivered ?? 0, icon: ICON_PACKAGE, tone: 'green', title: 'Orders delivered to the dock' },
    { key: 'avg', label: 'Avg order', value: avgSeconds, unit: 's', icon: ICON_CLOCK, tone: 'amber', title: 'Average time from an order arriving to its delivery' },
    { key: 'active', label: 'Active', value: active, icon: ICON_CLIPBOARD, tone: 'blue', title: 'Orders waiting, being picked, packed or shipped' },
  ];
  const dock = receiving ? dockLine(receiving) : null;
  return (
    <>
    <div className="stat-tiles">
      {tiles.map(({ key, label, value, unit, icon, tone, title }) => (
        <div key={key} className={`stat-tile tone-${tone}`} title={title}>
          <svg className="stat-tile-icon" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true"><path d={icon} /></svg>
          {/* Keyed on the value so each change replays the pop animation. */}
          <span key={`${key}-${value}`} className="stat-tile-value">
            {value ?? '–'}{unit && value != null && <small>{unit}</small>}
          </span>
          <span className="stat-tile-label">{label}</span>
        </div>
      ))}
    </div>
    {dock && (
      <div className={`dock-board ${dock.truck ? `dock-${dock.truck.state}` : ''}`} style={dock.truck ? { '--truck': truckPaint(dock.truck.name) } : undefined}
        title="Delivery trucks bring stock to the unload bay; robots shelve it">
        <span className="dock-board-icon"><PixelIcon name="truck" /></span>
        <span className="dock-board-text">{dock.text}</span>
        {dock.eta && <span className="dock-board-eta">{dock.eta}</span>}
        <span className="dock-board-total" title="Units put back on shelves this run">+{receiving.restocked ?? 0}</span>
      </div>
    )}
    </>
  );
}
