import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BuildKit } from '../components/BuildKit';
import { Dialog } from '../components/Dialog';
import { ModelBadge } from '../components/ModelBadge';
import { PixelChoice } from '../components/PixelChoice';
import { PixelIcon } from '../components/PixelIcon';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { MAX_SIDE, MIN_SIDE, cellKey, createBlueprintCells, findBays, findShippingZones, pickFaces, trimVoid, withGhostRing } from '../lib/grid';
import { KIT_KEYS } from '../lib/buildKit';
import { emptyLayoutHistory, layoutHistoryReducer } from '../lib/layoutHistory';
import { api } from '../services/api';

const NO_LAYERS = { paths: false, qHeatmap: false };
const DRAFT_ID = '__local_blueprint__';
const RING = { x: 1, y: 1 };
// Room left for the floating panels: the top bar, the Build kit on the left and the status strip below.
const STUDIO_INSET = { top: 76, right: 12, bottom: 70, left: 246 };
const NEEDS = [['packing', 'Packing'], ['charger', 'Charger'], ['dock', 'Dock'], ['unload', 'Unload']];
const SIZES = [
  { id: 'small', label: 'Small', width: 10, height: 8 },
  { id: 'medium', label: 'Medium', width: 16, height: 10 },
  { id: 'large', label: 'Large', width: 24, height: 14 },
];

const editableName = (layout) => (layout.is_default ? `${layout.name} copy` : layout.name);

export function LayoutsView({ onUseLayout }) {
  const toast = useToast();
  const [layouts, setLayouts] = useState([]);
  const [listVersion, setListVersion] = useState(0);
  const [loadVersion, setLoadVersion] = useState(0);
  const [selectedId, setSelectedId] = useState('default');
  const [saved, setSaved] = useState(null);
  const [history, edit] = useReducer(layoutHistoryReducer, emptyLayoutHistory);
  const cells = history.present;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [brush, setBrush] = useState('aisle');
  const [dockKind, setDockKind] = useState('dock');
  const [errorCells, setErrorCells] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [blueprint, setBlueprint] = useState({ name: 'New warehouse', size: 'medium', start: 'empty' });
  const pickerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.listLayouts()
      .then((list) => { if (!cancelled) setLayouts(list); })
      .catch((err) => { if (!cancelled) toast(err.message); });
    return () => { cancelled = true; };
  }, [listVersion, toast]);

  useEffect(() => {
    if (selectedId === DRAFT_ID) return undefined;
    let cancelled = false;
    api.getLayout(selectedId)
      .then((layout) => {
        if (cancelled) return;
        setSaved(layout);
        edit({ type: 'load', cells: layout.cells.map((row) => [...row]) });
        setLoadError(null);
        setProblem(null);
        setErrorCells(null);
        setName(editableName(layout));
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, [selectedId, loadVersion]);

  // Close the warehouse picker when clicking anywhere else.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const close = (event) => { if (!pickerRef.current?.contains(event.target)) setPickerOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [pickerOpen]);

  const dirty = useMemo(() => Boolean(saved && cells && JSON.stringify(saved.cells) !== JSON.stringify(cells)), [saved, cells]);
  const loading = !saved || saved.id !== selectedId || !cells;
  const unsaved = Boolean(saved?.is_draft) || dirty || Boolean(saved && name !== editableName(saved));
  const listed = layouts.find((l) => l.id === saved?.id);
  const status = saved?.is_draft || dirty ? 'untrained' : listed?.model_status ?? saved?.model_status ?? 'untrained';
  // The editor view: the floor inside a ring of ghost squares it can grow into.
  const preview = useMemo(() => {
    if (!saved || !cells) return null;
    const ring = withGhostRing(cells);
    const products = dirty ? [] : (saved.products ?? []).map((p) => ({ ...p, face: [p.face[0] + 1, p.face[1] + 1] }));
    return { ...saved, width: ring[0].length, height: ring.length, cells: ring, products, pick_faces: pickFaces(ring) };
  }, [saved, cells, dirty]);
  const counts = useMemo(() => {
    const result = { rack: 0, aisle: 0, packing: 0, dock: 0, shipping: 0, charger: 0, unload: 0, void: 0 };
    cells?.forEach((row) => row.forEach((kind) => { result[kind] += 1; }));
    return result;
  }, [cells]);
  const spots = preview ? preview.pick_faces.length : 0;
  // Unload bays that touch no outside edge: trucks could never reach them, so they light up red right away.
  const stranded = useMemo(() => {
    if (!preview) return null;
    const cells = [...findBays(preview.cells), ...findShippingZones(preview.cells)].filter((b) => !b.side).flatMap((b) => b.cells);
    return cells.length ? new Set(cells.map(([x, y]) => cellKey(x, y))) : null;
  }, [preview]);
  const strandedKinds = new Set(stranded ? [...stranded].map((key) => { const [x, y] = key.split(',').map(Number); return preview.cells[y][x]; }) : []);
  // "Dock" is met by a dock station or a drop-off zone (zones must reach the outside edge).
  const placed = (kind) => (kind === 'dock' ? counts.dock + counts.shipping : counts[kind]);
  const met = (kind) => Boolean(placed(kind)) && !strandedKinds.has(kind) && !(kind === 'dock' && strandedKinds.has('shipping'));
  const missing = NEEDS.filter(([kind]) => !met(kind));
  const highlighted = useMemo(() => (stranded && errorCells ? new Set([...stranded, ...errorCells]) : stranded ?? errorCells), [stranded, errorCells]);

  const clearFeedback = () => { setProblem(null); setErrorCells(null); setJustSaved(false); };
  const paint = (x, y, stroke) => {
    if (!brush || busy || loading) return;
    edit({ type: 'grow', x, y, brush, stroke });
    clearFeedback();
  };
  const changeHistory = (type) => { edit({ type }); clearFeedback(); };

  const open = (id) => {
    setPickerOpen(false);
    if (id === selectedId) return;
    if (unsaved && !window.confirm('Leave without saving your changes?')) return;
    setSelectedId(id);
    setLoadError(null);
    clearFeedback();
  };

  const createDraft = (event) => {
    event.preventDefault();
    const size = SIZES.find((s) => s.id === blueprint.size);
    const blank = blueprint.start === 'copy' && cells ? cells.map((row) => [...row]) : createBlueprintCells(size.width, size.height);
    const draftName = blueprint.name.trim() || 'New warehouse';
    if (unsaved && !window.confirm('Leave without saving your changes?')) return;
    // A local draft: nothing is stored until Save.
    setSaved({ id: DRAFT_ID, is_draft: true, is_default: false, name: draftName, width: blank[0].length, height: blank.length, cells: blank, products: [] });
    edit({ type: 'load', cells: blank });
    setName(draftName);
    setSelectedId(DRAFT_ID);
    setBrush(blueprint.start === 'copy' ? 'aisle' : 'rack');
    clearFeedback();
    setCreateOpen(false);
  };

  const save = async () => {
    if (loading || busy) return;
    const trimmed = trimVoid(cells);
    if (JSON.stringify(trimmed) !== JSON.stringify(cells)) edit({ type: 'set', cells: trimmed });
    const createNew = saved.is_draft || saved.is_default;
    const body = { name: name.trim() || 'Untitled warehouse', width: trimmed[0].length, height: trimmed.length, cells: trimmed, products: null };
    setBusy(true);
    clearFeedback();
    try {
      const result = createNew ? await api.createLayout(body) : await api.updateLayout(saved.id, body);
      setSaved(result);
      setName(result.name);
      edit({ type: 'load', cells: result.cells.map((row) => [...row]) });
      setSelectedId(result.id);
      setListVersion((v) => v + 1);
      setJustSaved(true);
      toast(`Saved "${result.name}". Train its model to run it.`, 'success');
    } catch (err) {
      const unreachable = err.detail?.unreachable ?? [];
      setErrorCells(unreachable.length ? new Set(unreachable.map(([x, y]) => cellKey(x + RING.x, y + RING.y))) : null);
      setProblem(unreachable.length ? 'Some spots can’t be reached. Connect the red squares with floor.' : err.message);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const key = (event) => {
      if (busy || loading || createOpen || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (event.ctrlKey || event.metaKey) {
        const k = event.key.toLowerCase();
        if (k === 'z' || k === 'y') {
          event.preventDefault();
          edit({ type: k === 'y' || event.shiftKey ? 'redo' : 'undo' });
          setProblem(null); setErrorCells(null);
        } else if (k === 's') {
          event.preventDefault();
          save();
        }
        return;
      }
      const tool = KIT_KEYS[event.key];
      if (tool) setBrush(tool === 'dock' ? dockKind : tool);
      else if (event.key === 'Escape') setBrush(null);
    };
    const unload = (event) => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  });

  const savedRealLayout = saved && !saved.is_draft && !unsaved;
  return (
    <div className="layout-studio">
      <div className="studio-map">
        {loadError ? (
          <div className="studio-empty" role="alert">
            <p>Couldn’t open this warehouse.</p>
            <button type="button" className="px-btn px-small" onClick={() => { setLoadError(null); setLoadVersion((v) => v + 1); }}>Try again</button>
          </div>
        ) : (
          <WarehouseMapCanvas key={selectedId} layout={loading ? null : preview} layers={NO_LAYERS} overlay minimap={false} inset={STUDIO_INSET}
            origin={RING} activeBrush={busy || loading ? null : brush} onPaintCell={paint} errorCells={highlighted} dockGhosts />
        )}
      </div>

      <header className="hud-glass studio-top">
        <div className="studio-picker" ref={pickerRef}>
          <button type="button" className="px-btn studio-picker-btn" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)} title="Switch warehouse">
            <PixelIcon name="warehouse" /><PixelIcon name="chevron" className="studio-picker-chevron" />
          </button>
          {pickerOpen && (
            <div className="studio-picker-menu hud-glass" role="menu">
              {layouts.map((layout) => (
                <button key={layout.id} type="button" role="menuitem" className={`studio-picker-item ${layout.id === selectedId ? 'is-current' : ''}`} onClick={() => open(layout.id)}>
                  <span className="studio-picker-name">{layout.name}</span>
                  {layout.is_default && <span className="studio-tag">built-in</span>}
                  <ModelBadge status={layout.model_status} compact />
                </button>
              ))}
              <button type="button" role="menuitem" className="studio-picker-item studio-picker-new" onClick={() => { setPickerOpen(false); setCreateOpen(true); }}>
                <PixelIcon name="plus" /> New warehouse
              </button>
            </div>
          )}
        </div>
        <input className="studio-name" value={name} disabled={busy || loading} maxLength={80} aria-label="Warehouse name"
          onChange={(event) => { setName(event.target.value); setJustSaved(false); }} />
        {saved?.is_default && <span className="studio-tag" title="The built-in warehouse never changes. Saving makes your own copy.">built-in</span>}
        <span className={`studio-dirty ${unsaved ? 'is-on' : ''}`} title={unsaved ? 'Unsaved changes' : 'All saved'} />
        <div className="studio-top-actions">
          <button type="button" className="px-btn px-small px-icon-btn" disabled={!history.past.length || busy || loading} onClick={() => changeHistory('undo')} title="Undo (Ctrl+Z)" aria-label="Undo"><PixelIcon name="undo" /></button>
          <button type="button" className="px-btn px-small px-icon-btn" disabled={!history.future.length || busy || loading} onClick={() => changeHistory('redo')} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><PixelIcon name="redo" /></button>
          <button type="button" className="px-btn px-small px-primary" disabled={busy || loading || !unsaved} onClick={save} title="Save (Ctrl+S)">
            <PixelIcon name="save" />{busy ? 'Saving…' : saved?.is_default ? 'Save copy' : 'Save'}
          </button>
        </div>
      </header>

      <BuildKit brush={busy || loading ? null : brush} onBrush={setBrush} dockKind={dockKind} onDockKind={setDockKind}
        counts={counts} disabled={busy || loading} />

      <footer className={`hud-glass studio-status ${problem ? 'has-problem' : ''}`}>
        {problem ? (
          <span className="studio-problem" role="alert">{problem}</span>
        ) : (
          <>
            <span className="studio-size" title="Floor size in squares">{cells ? `${cells[0].length}×${cells.length}` : '—'}</span>
            {NEEDS.map(([kind, label]) => (
              <span key={kind} className={`studio-need ${met(kind) ? 'is-met' : ''}`}
                title={(strandedKinds.has(kind) || (kind === 'dock' && strandedKinds.has('shipping'))) ? `Every ${label === 'Dock' ? 'drop-off' : label.toLowerCase()} zone must touch the outside edge of the warehouse` : placed(kind) ? `${placed(kind)} placed` : `Add at least one ${label.toLowerCase()}`}>{label}</span>
            ))}
            <span className="studio-spots" title="Floor squares next to a rack, where robots pick products">{spots} pick spots</span>
          </>
        )}
        <span className="studio-divider" />
        <ModelBadge status={status} />
        {savedRealLayout && status !== 'ready' && onUseLayout && (
          <button type="button" className={`px-btn px-small px-primary ${justSaved ? 'studio-nudge' : ''}`} onClick={() => onUseLayout(saved.id, 'models')}>
            <PixelIcon name="brain" /> Train
          </button>
        )}
        {savedRealLayout && status === 'ready' && onUseLayout && (
          <button type="button" className="px-btn px-small" onClick={() => onUseLayout(saved.id, 'session')}><PixelIcon name="play" /> Run</button>
        )}
        {!savedRealLayout && missing.length === 0 && <span className="studio-hint">Save, then train</span>}
      </footer>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New warehouse" pixel className="setup-dialog studio-create">
        <form onSubmit={createDraft} className="simulation-setup">
          <BlueprintPreview size={SIZES.find((s) => s.id === blueprint.size)} copy={blueprint.start === 'copy' ? cells : null} />
          <input className="setup-name" value={blueprint.name} maxLength={80} aria-label="Warehouse name" placeholder="New warehouse"
            onChange={(event) => setBlueprint({ ...blueprint, name: event.target.value })} />
          <div className="setup-row">
            <span className="setup-label">Start</span>
            <PixelChoice name="start" legend="Start from" value={blueprint.start} onChange={(start) => setBlueprint({ ...blueprint, start })}
              options={[{ id: 'empty', label: 'Empty floor' }, { id: 'copy', label: 'Copy this one', disabled: !cells }]} />
          </div>
          {blueprint.start === 'empty' && (
            <div className="setup-row">
              <span className="setup-label">Size</span>
              <PixelChoice name="size" legend="Size" value={blueprint.size} onChange={(size) => setBlueprint({ ...blueprint, size })}
                options={SIZES.map((s) => ({ ...s, tag: `${s.width}×${s.height}` }))} />
            </div>
          )}
          <p className="setup-hint">Any shape works: grow or cut the floor while you edit, up to {MAX_SIDE}×{MAX_SIDE}.</p>
          <div className="setup-footer">
            <span className="setup-summary" />
            <button type="button" className="px-btn" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="px-btn px-primary setup-go"><PixelIcon name="plus" />Create</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// A tiny pixel floor plan of the warehouse about to be made.
function BlueprintPreview({ size, copy }) {
  const grid = copy ?? Array.from({ length: Math.max(MIN_SIDE, size.height) }, () => Array(size.width).fill('aisle'));
  const w = grid[0].length;
  const h = grid.length;
  return (
    <div className="studio-blueprint" aria-hidden="true">
      <svg viewBox={`-0.5 -0.5 ${w + 1} ${h + 1}`} shapeRendering="crispEdges" style={{ aspectRatio: `${w + 1} / ${h + 1}` }}>
        {grid.flatMap((row, y) => row.map((kind, x) => (kind === 'void' ? null : (
          <rect key={`${x},${y}`} x={x + 0.06} y={y + 0.06} width={0.88} height={0.88} className={`bp-${kind}`} style={{ '--d': `${(x + y) * 12}ms` }} />
        ))))}
      </svg>
    </div>
  );
}
