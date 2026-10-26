import { memo, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { Package } from 'lucide-react';
import { ACTION_ARROWS, ACTIONS, cellsOnLine, cellKey, colLabel, coordLabel, findBays, findShippingZones } from '../lib/grid';
import { batteryColor } from '../lib/battery';
import { CHARGER_SPRITE, DOCK_SPRITE, PACKING_SPRITE, RACK_SPRITES } from '../lib/floorArt';
import { followOffset } from '../lib/mapCamera';
import { TRUCK_ROOM, dockAnchor, truckSides } from '../lib/receiving';
import { BUBBLE_TICKS, REACTION_TICKS, TRAIL_TICKS } from '../lib/chatter';
import { MiniMap } from './MiniMap';
import { PixelIcon } from './PixelIcon';
import { CargoCrate, DeliveryVan, PalletSprite, TruckDock, VanRoad } from './Receiving';
import { SpeechBubble, ThoughtBubble } from './RobotBubbles';
import { RobotPet } from './RobotPet';

const CELL = 56;
const GAP = 4;
const PITCH = CELL + GAP;
const LABEL_W = 32;
const TILE_CLASS = { aisle: 'tile-aisle', rack: 'tile-rack', packing: 'tile-packing', dock: 'tile-delivery', shipping: 'tile-shipping', charger: 'tile-charging', unload: 'tile-unload', void: 'tile-void', ghost: 'tile-ghost' };
// void: no floor (the warehouse can take any shape). ghost: the editor's ring of squares the floor can grow into.
const KIND_LABELS = { rack: 'Storage rack', aisle: 'Floor', packing: 'Packing', dock: 'Shipping dock', charger: 'Charger', shipping: 'Drop-off zone', unload: 'Unload bay', void: 'No floor', ghost: 'Add floor here' };
const DEFAULT_LAYERS = { paths: true, qHeatmap: false };
// Mouse-wheel zoom levels, relative to the fitted view (1 = whole warehouse).
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
const WHEEL_STEP = 60; // accumulated wheel delta (px) per zoom step, so a trackpad swipe doesn't skip levels
const WHEEL_COOLDOWN_MS = 110;
const DRAG_THRESHOLD = 4; // px the pointer must move before a press becomes a camera drag
const NO_INSET = { top: 0, right: 0, bottom: 0, left: 0 };
// The fitted view may scale the warehouse up to fill large screens, not just down to fit small ones.
const MAX_FIT_SCALE = 3;

const NO_ORIGIN = { x: 0, y: 0 };
const center = (v) => v * PITCH + CELL / 2;

const STATION_SPRITES = { charger: CHARGER_SPRITE, packing: PACKING_SPRITE, dock: DOCK_SPRITE };
const STATION_CAPTIONS = { charger: 'Charge', packing: 'Pack', dock: 'Dock' };

function Sprite({ layers, className, lift = 0 }) {
  return (
    <svg className={`station-art ${className}`} viewBox={`0 ${lift} 14 14`} shapeRendering="crispEdges" aria-hidden="true">
      {layers.map(({ fill, d, className: part }) => <path key={fill} className={part} d={d} fill={fill} />)}
    </svg>
  );
}

// Floor tiles as 8-bit sprites: shelves (three box layouts picked by position), chargers, packing stations, docks.
const TileGlyph = memo(function TileGlyph({ kind, location, variant, bay }) {
  if (kind === 'unload' || kind === 'shipping') {
    // Receiving bays point their chevrons in (stock arrives); drop-off zones point them out (parcels leave).
    const turn = kind === 'unload' ? INWARD_TURN[bay?.side] : OUTWARD_TURN[bay?.side];
    return (
      <span className={`zone-art zone-${kind} ${bay?.side ? '' : 'is-stranded'}`} style={{ '--in': `${turn ?? 0}deg` }}>
        {bay?.mouth && <svg className="zone-chevron" viewBox="0 0 7 4" shapeRendering="crispEdges" aria-hidden="true"><path d="M0 0h2v1h1v1h1v-1h1v-1h2v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z" /></svg>}
        {bay?.label && <span className="zone-caption">{kind === 'unload' ? 'Receiving' : 'Drop-off'}</span>}
      </span>
    );
  }
  if (kind === 'rack') {
    return (
      <>
        <Sprite layers={RACK_SPRITES[variant % RACK_SPRITES.length]} className="rack-art" />
        {location && <span className="tile-location">{location}</span>}
      </>
    );
  }
  if (!STATION_SPRITES[kind]) return null;
  return (
    <>
      {/* Lifted a little so the icon clears the caption underneath. */}
      <Sprite layers={STATION_SPRITES[kind]} className={`station-${kind}`} lift={1} />
      <span className="tile-caption">{STATION_CAPTIONS[kind]}</span>
    </>
  );
});

// Turn for the bay chevron (drawn pointing down) so it points into the warehouse from the truck's side.
const INWARD_TURN = { up: 0, down: 180, left: -90, right: 90 };
const OUTWARD_TURN = { up: 180, down: 0, left: 90, right: -90 };
// Stock level bands for the shelf bin: healthy, half, low (a truck gets called), out.
const stockLevel = (left, capacity) => (left <= 0 ? 'out' : left / capacity < 0.34 ? 'low' : left / capacity < 0.67 ? 'half' : 'full');
const LEVEL_TEXT = { full: 'well stocked', half: 'half full', low: 'running low', out: 'out of stock' };

// A stocked pick spot: the product number over one bar that empties and changes colour with the stock
// (green, yellow, red; an empty red outline when out). A small green dot means a refill is on the way.
// Exact counts live in the tooltip.
function FaceMarker({ products, stock, incoming }) {
  if (!products) return <div className="face-dot" />;
  const capacity = products.reduce((n, p) => n + (p.capacity ?? p.stock), 0);
  const left = products.reduce((n, p) => n + (stock?.[p.sku] ?? p.stock), 0);
  const coming = products.reduce((n, p) => n + (incoming?.[p.sku] ?? 0), 0);
  const level = stockLevel(left, capacity);
  const fill = capacity ? Math.min(100, Math.round((Math.max(0, left) / capacity) * 100)) : 0;
  const title = products.map((p) => `${p.name} (${p.sku}): ${stock?.[p.sku] ?? p.stock} of ${p.capacity ?? p.stock}`).join('\n')
    + ` · ${LEVEL_TEXT[level]}${coming ? ` · ${coming} on the way` : ''}`;
  return (
    <div className={`stock-bin stock-${level}`} title={title}>
      <span className="stock-sku">{products[0].sku.replace('SKU-', '#')}{coming > 0 && <i className="stock-incoming" />}</span>
      <span className="stock-bar"><span style={{ width: `${fill}%` }} /></span>
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
  initialShowGrid = false,
  // wheelZoom: the mouse wheel zooms the map. Off where the map sits inside a scrolling page.
  wheelZoom = true,
  // Last pick/pack/delivery/charge per robot from the session stream; makes that robot smile for a moment.
  robotCheers = null,
  // Session life: speech bubbles, yield nods, footprints and names per robot id (see lib/chatter.js).
  robotChatter = null,
  robotReactions = null,
  robotTrails = null,
  robotNames = null,
  // Trucks and pallets from the session stream ({ trucks, pallets, backlog }); null outside a session.
  receiving = null,
  // paused: freezes truck animations along with the simulation.
  paused = false,
  // dockGhosts: in the editor, outline where trucks will park at each valid bay.
  dockGhosts = false,
  // Vans leaving drop-off zones, each with its own door and start time so they never overlap (lib/shipments.js).
  shipments = null,
  // routingMode tells the thought bubble whether moves come from the learned policy or A*.
  routingMode = null,
  // overlay: float the Grid/Follow controls and the readout over the floor instead of in bars.
  overlay = false,
  // inset: px of the viewport covered by floating panels; the warehouse fits and centres in the rest.
  inset = NO_INSET,
  // origin: the cell shown as A1 (the editor pads the floor with a ring of ghost squares).
  origin = NO_ORIGIN,
  minimap = true,
}) {
  const viewportRef = useRef(null);
  const boardRef = useRef(null);
  const gridRef = useRef(null);
  const dragRef = useRef(null);
  const paintStrokeRef = useRef(null);
  // Last real pointer position. Growing the floor re-fits the map, so squares slide under a still pointer and
  // the browser reports them as entered; only squares the pointer actually moved onto get painted.
  const pointerRef = useRef(null);
  const strokeSequenceRef = useRef(0);
  const [zoomStep, setZoomStep] = useState(0);
  const zoom = ZOOM_STEPS[zoomStep];
  const wheel = useRef({ delta: 0, lastStep: 0, lastEvent: 0, handler: null, settle: null });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [follow, setFollow] = useState(false);
  // The grid toggle shows the background lines plus the A/B/C and 1/2/3 coordinate labels.
  const [showGrid, setShowGrid] = useState(initialShowGrid);
  const [geometry, setGeometry] = useState({ width: 0, height: 0, left: 0, top: 0, viewW: 0, viewH: 0 });
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState(null);
  const width = layout?.width ?? 0;
  const height = layout?.height ?? 0;
  const gridW = width * PITCH - GAP;
  const gridH = height * PITCH - GAP;
  // Unload bays and the side of the floor each one's trucks come from; the board leaves room there.
  const bays = useMemo(() => (layout ? findBays(layout.cells) : []), [layout]);
  const shipping = useMemo(() => (layout ? findShippingZones(layout.cells) : []), [layout]);
  // Trucks back into bays and vans drive off from drop-off zones: both need road room outside the floor.
  const sides = useMemo(() => truckSides([...bays, ...shipping]), [bays, shipping]);
  const room = (side) => (sides.has(side) ? TRUCK_ROOM : 0);
  const boardW = gridW + LABEL_W + 8 + 72 + room('left') + room('right');
  const boardH = gridH + 24 + 72 + room('up') + room('down');
  // Per zone cell: which side it opens to, whether it is on that edge (gets a chevron), and the caption cell.
  const bayCells = useMemo(() => {
    const map = new Map();
    [...bays, ...shipping].forEach((bay) => {
      const mouth = new Set(bay.mouth.map(([x, y]) => cellKey(x, y)));
      bay.cells.forEach(([x, y], i) => map.set(cellKey(x, y), { side: bay.side, mouth: mouth.has(cellKey(x, y)), label: i === 0 && bay.cells.length > 1 }));
    });
    return map;
  }, [bays, shipping]);
  const palletByCell = useMemo(() => new Map((receiving?.pallets ?? []).filter((p) => p.x != null).map((p) => [cellKey(p.x, p.y), p])), [receiving]);
  const productNames = useMemo(() => Object.fromEntries((layout?.products ?? []).map((p) => [p.sku, p.name])), [layout]);
  const insetX = inset.left + inset.right;
  const insetY = inset.top + inset.bottom;
  // Centre of the uncovered area relative to the viewport centre.
  const base = { x: (inset.left - inset.right) / 2, y: (inset.top - inset.bottom) / 2 };

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || !width) return undefined;
    const observer = new ResizeObserver(() => {
      const board = boardRef.current;
      const grid = gridRef.current;
      const actualW = board?.offsetWidth || boardW;
      const actualH = board?.offsetHeight || boardH;
      setScale(Math.max(0.05, Math.min(MAX_FIT_SCALE, (el.clientWidth - insetX - 24) / actualW, (el.clientHeight - insetY - 24) / actualH)));
      if (board && grid) setGeometry({ width: actualW, height: actualH, left: grid.offsetLeft, top: grid.offsetTop, viewW: el.clientWidth, viewH: el.clientHeight });
    });
    observer.observe(el);
    if (boardRef.current) observer.observe(boardRef.current);
    return () => observer.disconnect();
  }, [width, boardW, boardH, insetX, insetY]);

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
      if (kind === 'rack' || kind === 'void') return;
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
  // Dragging the floor pans the camera, except while a layout-editor brush is active (then dragging paints).
  const canPan = !activeBrush;
  // The part of the floor on screen (outside the floating panels), in cells, for the minimap. Null at the fitted view.
  const view = (() => {
    if (zoomStep === 0 || !geometry.viewW || !width) return null;
    const tx = offset.x + base.x;
    const ty = offset.y + base.y;
    const toCell = (px, py) => ({
      x: ((px - tx) / effectiveScale + geometry.width / 2 - geometry.left) / PITCH,
      y: ((py - ty) / effectiveScale + geometry.height / 2 - geometry.top) / PITCH,
    });
    const a = toCell(-geometry.viewW / 2 + inset.left, -geometry.viewH / 2 + inset.top);
    const b = toCell(geometry.viewW / 2 - inset.right, geometry.viewH / 2 - inset.bottom);
    const x = Math.max(0, a.x);
    const y = Math.max(0, a.y);
    return { x, y, w: Math.max(0, Math.min(width, b.x) - x), h: Math.max(0, Math.min(height, b.y) - y) };
  })();
  // Minimap click: centre the camera on that cell (zooming in to 200% first if showing the whole floor).
  // The target is kept far enough from the edges that the view never shows empty space past the floor.
  const jumpTo = (x, y) => {
    const step = zoomStep === 0 ? 3 : zoomStep;
    const cellPx = scale * ZOOM_STEPS[step] * PITCH;
    const keepInside = (target, cells, visiblePx) => {
      const half = visiblePx / cellPx / 2;
      return half * 2 >= cells ? (cells - 1) / 2 : Math.max(half - 0.5, Math.min(cells - 0.5 - half, target));
    };
    const cx = keepInside(x, width, geometry.viewW - inset.left - inset.right);
    const cy = keepInside(y, height, geometry.viewH - inset.top - inset.bottom);
    setFollow(false);
    setZoomStep(step);
    setPan(followOffset({ x: cx, y: cy }, geometry, scale * ZOOM_STEPS[step]));
  };
  const fit = () => { setZoomStep(0); setPan({ x: 0, y: 0 }); setFollow(false); };
  const move = (x, y) => { setFollow(false); setPan({ x: offset.x + x, y: offset.y + y }); };
  // Steps the zoom, keeping the floor point under `anchor` (px from the viewport centre) where it is.
  // Zooming all the way out returns to the fitted, centred view. The board glides briefly between levels.
  const zoomTo = (step, anchor = { x: 0, y: 0 }) => {
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, step));
    if (next === zoomStep) return;
    const board = boardRef.current;
    if (board) {
      board.classList.add('map-zooming');
      clearTimeout(wheel.current.settle);
      wheel.current.settle = setTimeout(() => board.classList.remove('map-zooming'), 220);
    }
    if (next === 0) {
      fit();
      return;
    }
    if (!(follow && selectedRobot)) {
      const ratio = ZOOM_STEPS[next] / zoom;
      const tx = offset.x + base.x;
      const ty = offset.y + base.y;
      setPan({ x: anchor.x - ratio * (anchor.x - tx) - base.x, y: anchor.y - ratio * (anchor.y - ty) - base.y });
    }
    setZoomStep(next);
  };
  const cameraKey = (event) => {
    if (event.target !== event.currentTarget) return;
    const actions = {
      '+': () => zoomTo(zoomStep + 1), '=': () => zoomTo(zoomStep + 1), '-': () => zoomTo(zoomStep - 1),
      '0': fit, ArrowLeft: () => move(60, 0), ArrowRight: () => move(-60, 0),
      ArrowUp: () => move(0, 60), ArrowDown: () => move(0, -60),
      f: () => { if (selectedRobot) setFollow((v) => !v); },
    };
    if (actions[event.key]) { event.preventDefault(); event.stopPropagation(); actions[event.key](); }
  };

  // Mouse wheel zooms in steps around the pointer. Wheel deltas are pooled so a trackpad swipe or a fast
  // spin moves one level at a time. The listener is non-passive so the page doesn't scroll as well.
  useEffect(() => {
    wheel.current.handler = (event) => {
      event.preventDefault();
      const state = wheel.current;
      const now = performance.now();
      if (now - state.lastEvent > 250) state.delta = 0;
      state.lastEvent = now;
      state.delta += event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
      if (Math.abs(state.delta) < WHEEL_STEP || now - state.lastStep < WHEEL_COOLDOWN_MS) return;
      const direction = state.delta < 0 ? 1 : -1;
      state.delta = 0;
      state.lastStep = now;
      const box = viewportRef.current.getBoundingClientRect();
      zoomTo(zoomStep + direction, { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 });
    };
  });
  const hasLayout = Boolean(layout);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !hasLayout || !wheelZoom) return undefined;
    const onWheel = (event) => wheel.current.handler?.(event);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasLayout, wheelZoom]);

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

  const cameraButtons = (
    <div className="bar-group" style={{ marginLeft: 'auto' }}>
      <button type="button" className="clay-btn clay-pill-sm" aria-pressed={showGrid} onClick={() => setShowGrid((v) => !v)} title="Show grid lines and cell coordinates">Grid</button>
      {robots.length > 0 && <button type="button" className="clay-btn clay-pill-sm" disabled={!selectedRobot} aria-pressed={follow} onClick={() => setFollow((v) => !v)}>Follow {selectedRobot?.id ?? 'robot'}</button>}
    </div>
  );
  const label = (x, y) => (x < origin.x || y < origin.y ? '' : coordLabel(x - origin.x, y - origin.y));
  const readout = hovered ? (
    <div className="map-readout">
      <strong>{label(hovered.x, hovered.y)}</strong>
      <span style={{ textTransform: 'capitalize' }}>{hovered.kind}</span>
      {hovered.products && <span>{hovered.products.map((p) => `${p.name} (${stock?.[p.sku] ?? p.stock})`).join(', ')}</span>}
      {hovered.best !== undefined && <span style={{ color: 'var(--orange)' }}>Best Q {hovered.best.toFixed(1)}</span>}
    </div>
  ) : (
    <div className="map-readout">{selectedRobot ? <><strong>{selectedRobot.id}</strong><span>{selectedRobot.status.replaceAll('_', ' ')}</span><span>Destination: {selectedRobot.target ? coordLabel(...selectedRobot.target) : 'None'}</span></> : <span>Hover over the floor to inspect storage, station, and policy details.</span>}</div>
  );

  // Floating version for the session: LED toggles plus a terminal-style line describing the hovered tile.
  const hudControls = (
    <div className="hud-glass map-hud" role="group" aria-label="Warehouse camera">
      <div className="bar-group">
        <button type="button" className="px-btn px-toggle px-small" aria-pressed={showGrid} onClick={() => setShowGrid((v) => !v)} title="Show grid lines and cell coordinates">
          <span className="px-led" /><PixelIcon name="grid" /> Grid
        </button>
        {robots.length > 0 && (
          <button type="button" className="px-btn px-toggle px-small" disabled={!selectedRobot} aria-pressed={follow} onClick={() => setFollow((v) => !v)} title="Keep the camera on the selected robot (F)">
            <span className="px-led" /><PixelIcon name="follow" /> Follow {selectedRobot?.id ?? 'robot'}
          </button>
        )}
      </div>
      <div className="map-terminal" aria-live="polite">
        <span className="map-terminal-prompt">&gt;</span>
        {hovered ? (
          <>
            <strong>{label(hovered.x, hovered.y)}</strong>
            <span>{KIND_LABELS[hovered.kind] ?? hovered.kind}</span>
            {hovered.products && <span>{hovered.products.map((p) => `${p.name} (${stock?.[p.sku] ?? p.stock})`).join(', ')}</span>}
          </>
        ) : <span className="map-terminal-cursor" />}
      </div>
    </div>
  );

  return (
    <div className={`map-canvas ${overlay ? 'map-canvas-overlay' : ''}`}>
      {overlay && minimap && (
        <MiniMap layout={layout} robots={robots} selectedRobotId={selectedRobotId} view={view} onJump={jumpTo}
          style={{ right: inset.right + 12 }} />
      )}
      {overlay ? hudControls : (
        <div className="map-controls" role="group" aria-label="Warehouse camera">
          {layers.qHeatmap && !heatmap && <span className="micro-copy">Q-values unavailable or loading.</span>}
          {cameraButtons}
        </div>
      )}
      <div ref={viewportRef} className={`map-viewport ${canPan ? 'map-pan' : ''}`} tabIndex={0} role="region" aria-label="Warehouse map. Drag to move the camera, scroll to zoom, click a robot to inspect it. Arrows pan, plus and minus zoom, zero resets the view, F follows the selected robot." onKeyDown={cameraKey}
        onPointerDown={(event) => {
          // Pressing on a robot selects it instead of starting a drag.
          if (!canPan || event.button !== 0 || event.target.closest('button')) return;
          dragRef.current = { x: event.clientX, y: event.clientY, pan: offset, moving: false };
        }}
        onPointerMove={(event) => {
          pointerRef.current = [event.clientX, event.clientY];
          const drag = dragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (!drag.moving) {
            // Wait for real movement so a plain click still reaches the tile or robot underneath.
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            drag.moving = true;
            setFollow(false);
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          setPan({ x: drag.pan.x + dx, y: drag.pan.y + dy });
        }}
        onMouseUp={() => { paintStrokeRef.current = null; }}
        onMouseLeave={() => { paintStrokeRef.current = null; }}
        onPointerUp={(event) => {
          // A plain click off the warehouse floor (not a drag, not a button) lets the selected robot go.
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag && !drag.moving && selectedRobot && !gridRef.current?.contains(event.target)) {
            setFollow(false);
            onSelectRobot?.(null);
          }
        }} onPointerCancel={() => { dragRef.current = null; paintStrokeRef.current = null; }}>
      <div ref={boardRef} className={`map-board ${showGrid ? '' : 'map-grid-hidden'} ${follow && selectedRobot ? 'map-follow' : ''} ${paused ? 'map-paused' : ''}`}
        style={{
          transform: `translate(${offset.x + base.x}px, ${offset.y + base.y}px) scale(${effectiveScale})`,
          ...(sides.has('up') && { paddingTop: 28 + TRUCK_ROOM }), ...(sides.has('down') && { paddingBottom: 28 + TRUCK_ROOM }),
          ...(sides.has('left') && { paddingLeft: 28 + TRUCK_ROOM }), ...(sides.has('right') && { paddingRight: 28 + TRUCK_ROOM }),
        }}>
        {showGrid && (
          <div className="map-cols" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, paddingLeft: LABEL_W + 8 }}>
            {Array.from({ length: width }, (_, x) => <div key={x} className="coord-label">{x < origin.x ? '' : colLabel(x - origin.x)}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {showGrid && (
            <div className="map-rows" style={{ gridTemplateRows: `repeat(${height}, ${CELL}px)`, width: LABEL_W }}>
              {Array.from({ length: height }, (_, y) => <div key={y} className="coord-label">{y < origin.y ? '' : y + 1 - origin.y}</div>)}
            </div>
          )}
          <div ref={gridRef} style={{ position: 'relative' }}>
            <div className="map-grid" style={{ gridTemplateColumns: `repeat(${width}, ${CELL}px)`, gridTemplateRows: `repeat(${height}, ${CELL}px)` }}>
              {layout.cells.map((row, y) => row.map((kind, x) => {
                const key = cellKey(x, y);
                const products = productsByFace.get(key);
                const station = stationByCell.get(key);
                const h = heat?.cells.get(key);
                const flashing = flashCells?.has(key);
                const classes = ['tile-base', 'tile-cell', TILE_CLASS[kind] ?? 'tile-aisle'];
                if (errorCells?.has(key)) classes.push('tile-error');
                return (
                  <div
                    key={key}
                    className={classes.join(' ')}
                    title={[label(x, y), KIND_LABELS[kind] ?? kind].filter(Boolean).join(' · ')}
                    style={{ cursor: activeBrush ? 'crosshair' : 'default' }}
                    onMouseDown={(event) => { if (event.button === 0) { event.preventDefault(); pointerRef.current = [event.clientX, event.clientY]; paint(x, y, true); } }}
                    onMouseEnter={(e) => {
                      setHovered({ x, y, kind, products, best: h?.best });
                      const moved = !pointerRef.current || e.clientX !== pointerRef.current[0] || e.clientY !== pointerRef.current[1];
                      if (e.buttons === 1 && moved) paint(x, y);
                      else paintStrokeRef.current = null;
                    }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <TileGlyph kind={kind} location={showGrid ? label(x, y) : null} variant={x * 7 + y * 3} bay={bayCells.get(key)} />
                    {palletByCell.has(key) && <PalletSprite key={palletByCell.get(key).id} pallet={palletByCell.get(key)} side={bayCells.get(key)?.side} name={productNames[palletByCell.get(key).sku]} />}
                    {/* Keyed on the tick so each event replays the flash without rebuilding the tile. */}
                    {flashing && <span key={flashToken} className="tile-flash" />}
                    {faceSet.has(key) && <FaceMarker products={products} stock={stock} incoming={receiving?.incoming} />}
                    {station?.occupant && <div className="station-ring">{station.remaining}</div>}
                    {h && <div className="heat-fill" style={{ opacity: heat.max > heat.min ? 0.1 + (0.55 * (h.best - heat.min)) / (heat.max - heat.min) : 0.1 }} />}
                    {h && <span className="heat-arrow">{ACTION_ARROWS[h.action]}</span>}
                    {heatmapTarget && heatmapTarget[0] === x && heatmapTarget[1] === y && <div className="heat-target" />}
                  </div>
                );
              }))}
            </div>

            <svg className="map-overlay" width={gridW} height={gridH}>
              {/* Faint paw prints on the cells each robot just left, fading over a few ticks. */}
              {robotTrails && robots.map((robot) => (robotTrails[robot.id] ?? []).map((step) => {
                const age = flashToken - step.tick;
                const across = step.dx !== 0;
                const cx = center(step.x) + step.dx * 6;
                const cy = center(step.y) + step.dy * 6;
                return (
                  <g key={`prints-${robot.id}-${step.tick}`} className="footprints" fill={robot.color} opacity={(0.2 * (1 - age / TRAIL_TICKS)).toFixed(3)}>
                    <rect x={cx - 2 + (across ? 0 : -5)} y={cy - 2 + (across ? -5 : 0)} width="4" height="4" />
                    <rect x={cx - 2 + (across ? -step.dx * 8 : 5)} y={cy - 2 + (across ? 5 : -step.dy * 8)} width="4" height="4" />
                  </g>
                );
              }))}
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

            {/* Each bay's dock outside the floor, with its truck backing in, unloading or driving off. */}
            {bays.filter((bay) => bay.side).map((bay, i) => (
              <TruckDock key={`dock-${bay.cells[0].join(',')}`} anchor={dockAnchor(bay, PITCH, GAP)} ghost={dockGhosts}
                truck={receiving?.trucks?.find((t) => t.bay === i)} waiting={receiving?.backlog?.length ?? 0} />
            ))}

            {/* The road each drop-off zone's vans drive away on. */}
            {shipping.filter((zone) => zone.side).map((zone) => (
              <VanRoad key={`road-${zone.cells[0].join(',')}`} anchor={dockAnchor(zone, PITCH, GAP)} />
            ))}
            {/* A van pulls away from a drop-off zone for every delivery there. */}
            {(shipments ?? []).map((van) => (
              <DeliveryVan key={van.id} anchor={dockAnchor({ side: van.side, mouth: [van.door] }, PITCH, GAP)} delay={van.delay} />
            ))}

            {robots.map((robot) => {
              const carried = (robot.carrying ?? []).reduce((n, i) => n + i.qty, 0);
              const selected = selectedRobotId === robot.id;
              const name = robotNames?.[robot.id];
              const chatter = robotChatter?.[robot.id];
              const speaking = chatter && flashToken - chatter.tick < BUBBLE_TICKS && !selected;
              const nodded = robotReactions?.[robot.id];
              return (
                <button
                  type="button"
                  key={robot.id}
                  onClick={() => onSelectRobot?.(robot.id)}
                  className={`robot-puck ${selectedRobotId === robot.id ? 'selected' : ''}`}
                  style={{ '--robot': robot.color, left: robot.x * PITCH + 6, top: robot.y * PITCH + 6, width: CELL - 12, height: CELL - 12, zIndex: selected ? 30 : speaking ? 25 : 20, padding: 0 }}
                  aria-pressed={selectedRobotId === robot.id}
                  title={`${name ? `${name} (${robot.id})` : robot.id} · ${robot.status.replaceAll('_', ' ')} · ${Math.round(robot.battery)}% battery`}
                  aria-label={`Robot ${name ? `${name}, ` : ''}${robot.id}, ${robot.status}, battery ${Math.round(robot.battery)}%`}
                >
                  <RobotPet robot={robot} cheer={robotCheers?.[robot.id]} tick={flashToken}
                    nodding={nodded !== undefined && flashToken - nodded <= REACTION_TICKS} />
                  {speaking && <SpeechBubble chatter={chatter} />}
                  {selected && <ThoughtBubble robot={robot} routingMode={routingMode} />}
                  {robot.pallet && <CargoCrate pallet={robot.pallet} />}
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
      {!overlay && readout}
    </div>
  );
}
