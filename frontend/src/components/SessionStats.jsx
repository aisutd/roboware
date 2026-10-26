import { ICON_CLIPBOARD, ICON_CLOCK, ICON_PACKAGE, TICK_SECONDS } from '../lib/pixelArt';

// Three 8-bit stat tiles: deliveries, average order time in whole seconds, and orders still in progress.
export function SessionStats({ stats, orders }) {
  const active = orders.filter((o) => o.status !== 'delivered' && o.status !== 'failed').length;
  const avgSeconds = stats?.avg_cycle_time == null ? null : Math.round(stats.avg_cycle_time * TICK_SECONDS);
  const tiles = [
    { key: 'delivered', label: 'Delivered', value: stats?.delivered ?? 0, icon: ICON_PACKAGE, tone: 'green', title: 'Orders delivered to the dock' },
    { key: 'avg', label: 'Avg order', value: avgSeconds, unit: 's', icon: ICON_CLOCK, tone: 'amber', title: 'Average time from an order arriving to its delivery' },
    { key: 'active', label: 'Active', value: active, icon: ICON_CLIPBOARD, tone: 'blue', title: 'Orders waiting, being picked, packed or shipped' },
  ];
  return (
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
  );
}
