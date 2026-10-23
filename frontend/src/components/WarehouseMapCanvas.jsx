import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { Package } from 'lucide-react';
import { ACTION_ARROWS, ACTIONS, cellKey, colLabel, coordLabel } from '../lib/grid';
import { batteryColor } from '../lib/battery';

const CELL = 56;
const GAP = 4;
const PITCH = CELL + GAP;
const LABEL_W = 32;
const TILE_CLASS = { aisle: 'tile-aisle', rack: 'tile-rack', packing: 'tile-packing', dock: 'tile-delivery', charger: 'tile-charging' };
const DEFAULT_LAYERS = { paths: true, qHeatmap: false, yieldHalos: true };

const center = (v) => v * PITCH + CELL / 2;

function TileGlyph({ kind }) {
  if (kind === 'charger') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="var(--ink)" />
      </svg>
    );
  }
  if (kind === 'packing' || kind === 'dock') {
    return <span className="tile-caption">{kind === 'packing' ? 'PACK' : 'DOCK'}</span>;
  }
  if (kind === 'rack') return <div className="rack-inset" />;
  return null;
}

function FaceMarker({ products, stock }) {
  if (!products) return <div className="face-dot" />;
  const initial = products.reduce((n, p) => n + p.stock, 0);
  const left = products.reduce((n, p) => n + (stock?.[p.sku] ?? p.stock), 0);
  return (
    <div className="face-marker" title={products.map((p) => `${p.sku} ${p.name}: ${stock?.[p.sku] ?? p.stock}`).join('\n')}>
      <span>{products[0].sku.replace('SKU-', '#')}</span>
      <div className="face-stock"><div style={{ width: `${initial ? (100 * left) / initial : 0}%` }} /></div>
    </div>
  );
}

export function WarehouseMapCanvas({
  layout,
  robots = [],
  stations = [],
  stock = null,
  selectedRobotId = null,
  onSelectRobot,
  layers = DEFAULT_LAYERS,
  heatmap = null,
  heatmapTarget = null,
  flashCells = null,
  flashToken = 0,
  errorCells = null,
  activeBrush = null,
  onPaintCell,
}) {
  const viewportRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState(null);
  const width = layout?.width ?? 0;
  const height = layout?.height ?? 0;
  const gridW = width * PITCH - GAP;
  const gridH = height * PITCH - GAP;
  const boardW = gridW + LABEL_W + 8 + 72;
  const boardH = gridH + 24 + 72;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || !width) return undefined;
    const observer = new ResizeObserver(() => {
      setScale(Math.max(0.3, Math.min(1, (el.clientWidth - 24) / boardW, (el.clientHeight - 24) / boardH)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, boardW, boardH]);

  const productsByFace = useMemo(() => {
    const map = new Map();
    for (const p of layout?.products ?? []) {
      const key = cellKey(p.face[0], p.face[1]);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [layout]);
  const faceSet = useMemo(() => new Set((layout?.pick_faces ?? []).map(([x, y]) => cellKey(x, y))), [layout]);
  const stationByCell = useMemo(() => new Map(stations.map((s) => [cellKey(s.x, s.y), s])), [stations]);
  const heat = useMemo(() => {
    if (!heatmap || !layers.qHeatmap || !layout) return null;
    const cells = new Map();
    let min = Infinity;
    let max = -Infinity;
    layout.cells.forEach((row, y) => row.forEach((kind, x) => {
      if (kind === 'rack') return;
      const q = heatmap.values[y * width + x];
      const best = Math.max(...q);
      cells.set(cellKey(x, y), { best, action: ACTIONS[q.indexOf(best)] });
      min = Math.min(min, best);
      max = Math.max(max, best);
    }));
    return { cells, min, max };
  }, [heatmap, layers.qHeatmap, layout, width]);

  if (!layout) return <div ref={viewportRef} className="map-viewport" />;

  const paint = (x, y) => {
    if (activeBrush) onPaintCell?.(x, y);
  };

  return (
    <div ref={viewportRef} className="map-viewport">
      <div className="map-board" style={{ transform: `scale(${scale})` }}>
        <div className="map-cols" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, paddingLeft: LABEL_W + 8 }}>
          {Array.from({ length: width }, (_, x) => <div key={x} className="coord-label">{colLabel(x)}</div>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="map-rows" style={{ gridTemplateRows: `repeat(${height}, ${CELL}px)`, width: LABEL_W }}>
            {Array.from({ length: height }, (_, y) => <div key={y} className="coord-label">{y + 1}</div>)}
          </div>
          <div style={{ position: 'relative' }}>
            <div className="map-grid" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, gridTemplateRows: `repeat(${height}, ${CELL}px)` }}>
              {layout.cells.map((row, y) => row.map((kind, x) => {
                const key = cellKey(x, y);
                const products = productsByFace.get(key);
                const station = stationByCell.get(key);
                const h = heat?.cells.get(key);
                const flashing = flashCells?.has(key);
                const classes = ['tile-base', 'tile-cell', TILE_CLASS[kind] ?? 'tile-aisle'];
                if (flashing) classes.push('tile-flash');
                if (errorCells?.has(key)) classes.push('tile-error');
                return (
                  <div
                    key={flashing ? `${key}-${flashToken}` : key}
                    className={classes.join(' ')}
                    style={{ cursor: activeBrush ? 'crosshair' : 'default' }}
                    onMouseDown={() => paint(x, y)}
                    onMouseEnter={(e) => {
                      setHovered({ x, y, kind, products, best: h?.best });
                      if (e.buttons === 1) paint(x, y);
                    }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <TileGlyph kind={kind} />
                    {faceSet.has(key) && <FaceMarker products={products} stock={stock} />}
                    {station?.occupant && <div className="station-ring">{station.remaining}</div>}
                    {h && <div className="heat-fill" style={{ opacity: heat.max > heat.min ? 0.1 + (0.55 * (h.best - heat.min)) / (heat.max - heat.min) : 0.1 }} />}
                    {h && <span className="heat-arrow">{ACTION_ARROWS[h.action]}</span>}
                    {heatmapTarget && heatmapTarget[0] === x && heatmapTarget[1] === y && <div className="heat-target" />}
                  </div>
                );
              }))}
            </div>

            <svg className="map-overlay" width={gridW} height={gridH}>
              {layers.paths && robots.map((robot) => {
                if (!robot.path?.length) return null;
                const d = [`M ${center(robot.x)} ${center(robot.y)}`, ...robot.path.map(([x, y]) => `L ${center(x)} ${center(y)}`)].join(' ');
                return (
                  <g key={`path-${robot.id}`}>
                    <path d={d} fill="none" stroke={robot.color} strokeWidth="3" strokeLinejoin="miter" className="trajectory-path" />
                    {robot.target && (
                      <rect x={center(robot.target[0]) - 5} y={center(robot.target[1]) - 5} width="10" height="10" fill={robot.color} stroke="var(--ink)" strokeWidth="2" />
                    )}
                  </g>
                );
              })}
            </svg>

            {robots.map((robot) => {
              const carried = (robot.carrying ?? []).reduce((n, i) => n + i.qty, 0);
              return (
                <button
                  type="button"
                  key={robot.id}
                  onClick={() => onSelectRobot?.(robot.id)}
                  className={`robot-puck ${selectedRobotId === robot.id ? 'selected' : ''}`}
                  style={{ left: robot.x * PITCH + 6, top: robot.y * PITCH + 6, width: CELL - 12, height: CELL - 12, zIndex: 20, padding: 0 }}
                  aria-label={`Robot ${robot.id}, ${robot.status}, battery ${Math.round(robot.battery)}%`}
                >
                  {layers.yieldHalos && robot.yielding && <div className="yield-ring" />}
                  <span className="robot-stripe" style={{ background: robot.color }} />
                  <span className="robot-label">{robot.id}</span>
                  <span className="robot-battery"><div style={{ width: `${robot.battery}%`, background: batteryColor(robot.battery) }} /></span>
                  <div className="robot-nose-wrap" style={{ transform: `rotate(${robot.heading}deg)` }}>
                    <div className="robot-nose" style={{ borderLeftColor: 'var(--ink)' }} />
                  </div>
                  {(robot.package_id || carried > 0) && (
                    <span className="carry-badge" title={robot.package_id ? `Carrying ${robot.package_id}` : `${carried} item(s)`}>
                      {robot.package_id ? <Package size={10} strokeWidth={2.6} /> : carried}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {hovered && (
          <div className="map-tooltip">
            <strong>{coordLabel(hovered.x, hovered.y)}</strong>
            <span style={{ textTransform: 'capitalize' }}>{hovered.kind}</span>
            {hovered.products && <span>{hovered.products.map((p) => `${p.name} (${stock?.[p.sku] ?? p.stock})`).join(', ')}</span>}
            {hovered.best !== undefined && <span style={{ color: 'var(--orange)' }}>Best Q {hovered.best.toFixed(1)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
