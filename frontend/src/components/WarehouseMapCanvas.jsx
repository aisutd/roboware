import { memo, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { Package } from 'lucide-react';
import { ACTION_ARROWS, ACTIONS, cellsOnLine, cellKey, colLabel, coordLabel } from '../lib/grid';
import { batteryColor } from '../lib/battery';
import { clampZoom, followOffset } from '../lib/mapCamera';

const CELL = 56;
const GAP = 4;
const PITCH = CELL + GAP;
const LABEL_W = 32;
const TILE_CLASS = { aisle: 'tile-aisle', rack: 'tile-rack', packing: 'tile-packing', dock: 'tile-delivery', charger: 'tile-charging' };
const DEFAULT_LAYERS = { paths: true, qHeatmap: false, yieldHalos: true };

const center = (v) => v * PITCH + CELL / 2;

const TileGlyph = memo(function TileGlyph({ kind, location }) {
  if (kind === 'rack') {
    return (
      <svg className="station-art rack-art" viewBox="0 0 56 56" aria-hidden="true">
        <rect x="5" y="4" width="46" height="48" rx="2" fill="#202a33" stroke="#60717e" />
        {[9, 29].map((y) => (
          <g key={y}>
            <rect x="10" y={y} width="16" height="16" rx="1" fill="#7c6c52" stroke="#a18a62" />
            <rect x="29" y={y} width="16" height="16" rx="1" fill="#625d4f" stroke="#95846a" />
            <path d={`M18 ${y}v16 M37 ${y}v16`} stroke="#bba27a" strokeWidth="2" />
            <path d={`M12 ${y + 12}h6 M31 ${y + 12}h6`} stroke="#d2c6ab" strokeWidth="2" />
          </g>
        ))}
        <path d="M6 5v46 M50 5v46" stroke="#718491" strokeWidth="3" />
        <path d="M6 6h44 M6 27h44 M6 49h44" stroke="#b0854f" strokeWidth="3" />
        <path d="M7 8h3 M46 8h3 M7 47h3 M46 47h3" stroke="#c6d1d8" strokeWidth="2" />
        <text x="28" y="55" textAnchor="middle" fill="#bcc9d3" fontSize="6" fontFamily="ui-monospace, monospace">{location}</text>
      </svg>
    );
  }
  if (!['charger', 'packing', 'dock'].includes(kind)) return null;
  return (
    <>
      <svg className="station-art" viewBox="0 0 56 56" aria-hidden="true">
        {kind === 'charger' && <>
          <path d="M8 35v10h40V35" fill="none" stroke="#a88b52" strokeWidth="2" />
          <rect x="12" y="5" width="32" height="10" rx="2" fill="#39413f" stroke="#8e9a94" />
          <path d="M18 9h7 M31 9h7" stroke="#9fc7b2" strokeWidth="2" />
          <path d="M17 15v8 M39 15v8" stroke="#c3a269" strokeWidth="3" />
          <path d="M29 19l-8 12h7l-2 11 10-15h-8z" fill="#dfb66b" />
          <path d="M6 22v8 M50 22v8" stroke="#786848" strokeWidth="2" />
        </>}
        {kind === 'packing' && <>
          <rect x="5" y="7" width="46" height="34" rx="3" fill="#2d3b47" stroke="#7991a3" />
          <rect x="9" y="11" width="13" height="26" rx="1" fill="#17232d" />
          {[15, 21, 27, 33].map((y) => <path key={y} d={`M11 ${y}h9`} stroke="#657b8d" strokeWidth="2" />)}
          <rect x="27" y="15" width="17" height="17" rx="1" fill="#8c7a5f" stroke="#bca07a" />
          <path d="M35 15v17" stroke="#d1b58b" strokeWidth="3" />
          <path d="M9 42v4 M47 42v4" stroke="#7991a3" strokeWidth="3" />
          <rect x="35" y="5" width="12" height="5" rx="1" fill="#7eafc2" />
        </>}
        {kind === 'dock' && <>
          <rect x="5" y="5" width="46" height="11" rx="1" fill="#273b3b" stroke="#719a95" />
          {[9, 13].map((y) => <path key={y} d={`M9 ${y}h38`} stroke="#587773" />)}
          <path d="M8 20v24h40V20" fill="none" stroke="#5f8d84" strokeWidth="2" strokeDasharray="4 3" />
          <path d="M23 38h10 M23 34h10 M28 38V21m-5 5 5-5 5 5" fill="none" stroke="#93c1b4" strokeWidth="2" />
          <path d="M5 19v8 M51 19v8" stroke="#c6ac6d" strokeWidth="3" />
        </>}
      </svg>
      <span className="tile-caption">{kind === 'charger' ? 'CHG' : kind === 'packing' ? 'PACK' : 'DOCK'}</span>
    </>
  );
});

// The chassis faces right at 0°, matching the simulation heading convention.
// Only the SVG rotates; the identity, battery, and payload stay readable.
function AMRRobot({ robot }) {
  const light = robot.battery <= 20 ? 'var(--red)' : robot.yielding ? 'var(--amber)'
    : robot.status === 'charging' ? 'var(--blue)' : 'var(--green)';
  return (
    <svg className="robot-art" viewBox="0 0 48 48" aria-hidden="true" style={{ transform: `rotate(${robot.heading}deg)` }}>
      {/* Recessed drive wheels and a rounded protective bumper. */}
      <rect x="14" y="3" width="18" height="7" rx="3" fill="#10171d" stroke="#63717b" />
      <rect x="14" y="38" width="18" height="7" rx="3" fill="#10171d" stroke="#63717b" />
      <path d="M19 4v4m5-4v4m5-4v4M19 40v4m5-4v4m5-4v4" stroke="#35424c" />
      <rect x="4" y="6" width="39" height="36" rx="12" fill="#141d24" stroke="#8997a1" strokeWidth="1.4" />
      <rect x="7" y="9" width="33" height="30" rx="10" fill="#303d47" stroke="#52636f" />
      <path d="M12 13q-3 3-3 8m3 14q-3-3-3-8" fill="none" stroke="#71818c" strokeWidth="1.2" />
      {/* Service deck, fasteners, and robot-specific identification strip. */}
      <rect x="13" y="14" width="20" height="20" rx="5" fill="#202c35" stroke="#4c606e" />
      <path d="M17 17h12" stroke={robot.color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="23" cy="25" r="5" fill="#111d25" stroke="#7e929f" />
      <circle cx="23" cy="25" r="2" fill="#8fa6b4" />
      <g fill="#9baab4">
        <circle cx="12" cy="13" r=".8" /><circle cx="35" cy="13" r=".8" />
        <circle cx="12" cy="35" r=".8" /><circle cx="35" cy="35" r=".8" />
      </g>
      {/* Forward lidar window, heading chevron, and operational lights. */}
      <rect x="37" y="17" width="6" height="14" rx="3" fill="#0c1922" stroke="#65808f" />
      <path d="M39 21l3 3-3 3" fill="none" stroke="#b6d5df" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M44 21l3 3-3 3" fill="none" stroke="#d7e8ee" strokeWidth="1.5" />
      <circle cx="10" cy="19" r="1.8" fill={light} />
      <circle cx="10" cy="29" r="1.8" fill={light} />
    </svg>
  );
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
  const boardRef = useRef(null);
  const gridRef = useRef(null);
  const dragRef = useRef(null);
  const paintStrokeRef = useRef(null);
  const strokeSequenceRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [follow, setFollow] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [geometry, setGeometry] = useState({ width: 0, height: 0, left: 0, top: 0 });
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
      const board = boardRef.current;
      const grid = gridRef.current;
      const actualW = board?.offsetWidth || boardW;
      const actualH = board?.offsetHeight || boardH;
      setScale(Math.max(0.05, Math.min(1, (el.clientWidth - 24) / actualW, (el.clientHeight - 24) / actualH)));
      if (board && grid) setGeometry({ width: actualW, height: actualH, left: grid.offsetLeft, top: grid.offsetTop });
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

  const selectedRobot = robots.find((robot) => robot.id === selectedRobotId);
  const effectiveScale = scale * zoom;
  const offset = follow && selectedRobot ? followOffset(selectedRobot, geometry, effectiveScale) : pan;
  const canPan = panMode && !activeBrush;
  const fit = () => { setZoom(1); setPan({ x: 0, y: 0 }); setFollow(false); };
  const move = (x, y) => { setFollow(false); setPan({ x: offset.x + x, y: offset.y + y }); };
  const cameraKey = (event) => {
    if (event.target !== event.currentTarget) return;
    const actions = {
      '+': () => setZoom((z) => clampZoom(z * 1.25)),
      '=': () => setZoom((z) => clampZoom(z * 1.25)),
      '-': () => setZoom((z) => clampZoom(z / 1.25)),
      '0': fit, ArrowLeft: () => move(60, 0), ArrowRight: () => move(-60, 0),
      ArrowUp: () => move(0, 60), ArrowDown: () => move(0, -60),
      f: () => { if (selectedRobot) setFollow((v) => !v); },
    };
    if (actions[event.key]) { event.preventDefault(); event.stopPropagation(); actions[event.key](); }
  };

  if (!layout) return <div ref={viewportRef} className="map-viewport map-loading" role="status">Waiting for warehouse layout…</div>;

  const paint = (x, y, start = false) => {
    if (!activeBrush) return;
    let previous = paintStrokeRef.current;
    if (start || !previous || previous.brush !== activeBrush) {
      strokeSequenceRef.current += 1;
      previous = null;
    }
    const line = cellsOnLine(previous ? [previous.x, previous.y] : [x, y], [x, y]);
    line.forEach(([cx, cy]) => onPaintCell?.(cx, cy, strokeSequenceRef.current));
    paintStrokeRef.current = { x, y, brush: activeBrush };
  };

  return (
    <div className="map-canvas">
      <div className="map-controls" role="group" aria-label="Warehouse camera">
        {layers.qHeatmap && !heatmap && <span className="micro-copy">Q-values unavailable or loading.</span>}
        <div className="bar-group">
          <button type="button" className="clay-btn clay-pill-sm" onClick={() => setZoom((z) => clampZoom(z / 1.25))} disabled={zoom <= .5} aria-label="Zoom out">−</button>
          <output className="camera-scale" aria-label="Map scale">{Math.round(effectiveScale * 100)}%</output>
          <button type="button" className="clay-btn clay-pill-sm" onClick={() => setZoom((z) => clampZoom(z * 1.25))} disabled={zoom >= 4} aria-label="Zoom in">+</button>
          <button type="button" className="clay-btn clay-pill-sm" onClick={fit}>Fit warehouse</button>
        </div>
        <div className="bar-group">
          <button type="button" className="clay-btn clay-pill-sm" aria-pressed={canPan} disabled={Boolean(activeBrush)} onClick={() => setPanMode((v) => !v)} title={activeBrush ? 'Deselect the paint brush to pan' : 'Drag the floor to pan'}>Pan</button>
          {[['←', 60, 0, 'Pan left'], ['↑', 0, 60, 'Pan up'], ['↓', 0, -60, 'Pan down'], ['→', -60, 0, 'Pan right']].map(([label, x, y, title]) => <button key={title} type="button" className="clay-btn clay-pill-sm" onClick={() => move(x, y)} aria-label={title}>{label}</button>)}
          <button type="button" className="clay-btn clay-pill-sm" aria-pressed={showGrid} onClick={() => setShowGrid((v) => !v)}>Grid</button>
          {robots.length > 0 && <button type="button" className="clay-btn clay-pill-sm" disabled={!selectedRobot} aria-pressed={follow} onClick={() => setFollow((v) => !v)}>Follow {selectedRobot?.id ?? 'robot'}</button>}
        </div>
      </div>
      <div ref={viewportRef} className={`map-viewport ${canPan ? 'map-pan' : ''}`} tabIndex={0} role="region" aria-label="Warehouse map. Use plus and minus to zoom, arrows to pan, zero to fit, F to follow." onKeyDown={cameraKey}
        onPointerDown={(event) => {
          if (!canPan || event.button !== 0 || event.target.closest('button')) return;
          dragRef.current = { x: event.clientX, y: event.clientY, pan: offset };
          setFollow(false);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag) setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
        }}
        onMouseUp={() => { paintStrokeRef.current = null; }}
        onMouseLeave={() => { paintStrokeRef.current = null; }}
        onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; paintStrokeRef.current = null; }}>
      <div ref={boardRef} className={`map-board ${showGrid ? '' : 'map-grid-hidden'} ${follow && selectedRobot ? 'map-follow' : ''}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${effectiveScale})` }}>
        <div className="map-cols" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, paddingLeft: LABEL_W + 8 }}>
          {Array.from({ length: width }, (_, x) => <div key={x} className="coord-label">{colLabel(x)}</div>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="map-rows" style={{ gridTemplateRows: `repeat(${height}, ${CELL}px)`, width: LABEL_W }}>
            {Array.from({ length: height }, (_, y) => <div key={y} className="coord-label">{y + 1}</div>)}
          </div>
          <div ref={gridRef} style={{ position: 'relative' }}>
            <div className="map-grid" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, gridTemplateRows: `repeat(${height}, ${CELL}px)` }}>
              {layout.cells.map((row, y) => row.map((kind, x) => {
                const key = cellKey(x, y);
                const products = productsByFace.get(key);
                const station = stationByCell.get(key);
                const h = heat?.cells.get(key);
                const flashing = flashCells?.has(key);
                const classes = ['tile-base', 'tile-cell', TILE_CLASS[kind] ?? 'tile-aisle'];
                if (kind === 'rack') {
                  if (row[x + 1] === 'rack') classes.push('rack-join-right');
                  if (layout.cells[y + 1]?.[x] === 'rack') classes.push('rack-join-down');
                }
                if (flashing) classes.push('tile-flash');
                if (errorCells?.has(key)) classes.push('tile-error');
                return (
                  <div
                    key={flashing ? `${key}-${flashToken}` : key}
                    className={classes.join(' ')}
                    title={`${coordLabel(x, y)} · ${kind === 'rack' ? 'Storage rack' : kind}`}
                    style={{ cursor: activeBrush ? 'crosshair' : 'default' }}
                    onMouseDown={(event) => { if (event.button === 0) { event.preventDefault(); paint(x, y, true); } }}
                    onMouseEnter={(e) => {
                      setHovered({ x, y, kind, products, best: h?.best });
                      if (e.buttons === 1) paint(x, y);
                      else paintStrokeRef.current = null;
                    }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <TileGlyph kind={kind} location={coordLabel(x, y)} />
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
                    <path d={d} fill="none" stroke="#10171d" strokeWidth={selectedRobotId === robot.id ? 6 : 4} strokeLinejoin="round" opacity="0.8" />
                    <path d={d} fill="none" stroke={robot.color} strokeWidth={selectedRobotId === robot.id ? 2.5 : 1.5} strokeLinejoin="round" strokeLinecap="round" opacity={selectedRobotId === robot.id ? 1 : 0.55} className="trajectory-path" />
                    {robot.target && (
                      <g stroke={robot.color} fill="none" opacity={selectedRobotId === robot.id ? 1 : 0.6}>
                        <circle cx={center(robot.target[0])} cy={center(robot.target[1])} r="8" strokeWidth="1.5" />
                        <circle cx={center(robot.target[0])} cy={center(robot.target[1])} r="2" fill={robot.color} />
                      </g>
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
                  aria-pressed={selectedRobotId === robot.id}
                  title={`${robot.id} · ${robot.status.replaceAll('_', ' ')} · ${Math.round(robot.battery)}% battery`}
                  aria-label={`Robot ${robot.id}, ${robot.status}, battery ${Math.round(robot.battery)}%`}
                >
                  {layers.yieldHalos && robot.yielding && <div className="yield-ring" />}
                  <AMRRobot robot={robot} />
                  <span className="robot-label">{robot.id}</span>
                  <span className="robot-battery"><div style={{ width: `${robot.battery}%`, background: batteryColor(robot.battery) }} /></span>
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


      </div>
    </div>
        {hovered ? (
          <div className="map-readout">
            <strong>{coordLabel(hovered.x, hovered.y)}</strong>
            <span style={{ textTransform: 'capitalize' }}>{hovered.kind}</span>
            {hovered.products && <span>{hovered.products.map((p) => `${p.name} (${stock?.[p.sku] ?? p.stock})`).join(', ')}</span>}
            {hovered.best !== undefined && <span style={{ color: 'var(--orange)' }}>Best Q {hovered.best.toFixed(1)}</span>}
          </div>
        ) : <div className="map-readout">{selectedRobot ? <><strong>{selectedRobot.id}</strong><span>{selectedRobot.status.replaceAll('_', ' ')}</span><span>Destination: {selectedRobot.target ? coordLabel(...selectedRobot.target) : 'None'}</span></> : <span>Hover over the floor to inspect storage, station, and policy details.</span>}</div>}
    </div>
  );
}
