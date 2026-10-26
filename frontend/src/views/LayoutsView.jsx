import { useEffect, useMemo, useReducer, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { MapPaintToolbar } from '../components/MapPaintToolbar';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { cellKey, coordLabel, createBlueprintCells, pickFaces } from '../lib/grid';
import { emptyLayoutHistory, layoutHistoryReducer } from '../lib/layoutHistory';
import { api } from '../services/api';

const NO_LAYERS = { paths: false, qHeatmap: false };
const DRAFT_ID = '__local_blueprint__';

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
  const [validationError, setValidationError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [listError, setListError] = useState(null);
  const [name, setName] = useState('');
  const [brush, setBrush] = useState(null);
  const [errorCells, setErrorCells] = useState(null);
  const [unreachable, setUnreachable] = useState([]);
  const [savedNotice, setSavedNotice] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [blueprint, setBlueprint] = useState({ name: 'New warehouse', width: 16, height: 10 });
  const [dimensionError, setDimensionError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.listLayouts()
      .then((list) => { if (!cancelled) { setLayouts(list); setListError(null); } })
      .catch((err) => { if (!cancelled) setListError(err.message); });
    return () => { cancelled = true; };
  }, [listVersion]);

  useEffect(() => {
    if (selectedId === DRAFT_ID) return undefined;
    let cancelled = false;
    api.getLayout(selectedId)
      .then((layout) => {
        if (cancelled) return;
        setSaved(layout);
        edit({ type: 'load', cells: layout.cells.map((row) => [...row]) });
        setLoadError(null);
        setValidationError(null);
        setName(layout.is_default ? `${layout.name} copy` : layout.name);
        setErrorCells(null);
        setUnreachable([]);
      })
      .catch((err) => { if (!cancelled) { setLoadError(err.message); toast(err.message); } });
    return () => { cancelled = true; };
  }, [selectedId, loadVersion, toast]);

  const dirty = useMemo(() => Boolean(saved && cells && JSON.stringify(saved.cells) !== JSON.stringify(cells)), [saved, cells]);
  const preview = useMemo(() => {
    if (!saved || !cells) return null;
    return { ...saved, cells, products: dirty ? [] : saved.products, pick_faces: pickFaces(cells) };
  }, [saved, cells, dirty]);
  const counts = useMemo(() => {
    const result = { rack: 0, aisle: 0, packing: 0, dock: 0, charger: 0 };
    cells?.forEach((row) => row.forEach((kind) => { if (kind in result) result[kind] += 1; }));
    return result;
  }, [cells]);
  const loading = !saved || saved.id !== selectedId;
  const unsaved = Boolean(saved?.is_draft) || dirty || Boolean(saved && name !== (saved.is_default ? `${saved.name} copy` : saved.name));
  const clearFeedback = () => { setValidationError(null); setErrorCells(null); setUnreachable([]); setSavedNotice(null); };
  const changeHistory = (type) => { edit({ type }); clearFeedback(); };

  const paint = (x, y, stroke) => {
    if (!brush || !saved || busy || loading) return;
    edit({ type: 'paint', x, y, brush, stroke });
    clearFeedback();
  };

  const createDraft = (event) => {
    event.preventDefault();
    try {
      const width = Number(blueprint.width);
      const height = Number(blueprint.height);
      const blank = createBlueprintCells(width, height);
      if (!blueprint.name.trim()) throw new Error('Enter a warehouse name.');
      if (unsaved && !window.confirm('Discard the current unsaved changes and start a new blueprint?')) return;
      // This is explicitly a local draft. No persistence call occurs until Save.
      setSaved({ id: DRAFT_ID, is_draft: true, is_default: false, name: blueprint.name.trim(), width, height, cells: blank, products: [] });
      edit({ type: 'load', cells: blank });
      setName(blueprint.name.trim());
      setSelectedId(DRAFT_ID);
      setBrush('rack');
      setLoadError(null);
      setDimensionError(null);
      clearFeedback();
      setCreateOpen(false);
    } catch (err) { setDimensionError(err.message); }
  };

  const save = async (asNew) => {
    if (!saved || loading || busy) return;
    const createNew = asNew || saved.is_draft || saved.is_default;
    const body = { name: name.trim() || 'Untitled layout', width: saved.width, height: saved.height, cells, products: null };
    setBusy(true);
    setValidationError(null);
    setErrorCells(null);
    setUnreachable([]);
    setSavedNotice(null);
    try {
      const result = createNew ? await api.createLayout(body) : await api.updateLayout(saved.id, body);
      setSaved(result);
      setName(result.name);
      edit({ type: 'load', cells: result.cells.map((row) => [...row]) });
      setSelectedId(result.id);
      setSavedNotice(result);
      setListVersion((value) => value + 1);
      toast(`Saved "${result.name}". Ready to train a model or configure a simulation.`, 'success');
    } catch (err) {
      const destinations = err.detail?.unreachable ?? [];
      setUnreachable(destinations);
      if (destinations.length) setErrorCells(new Set(destinations.map(([x, y]) => cellKey(x, y))));
      setValidationError(err.message);
      toast(err.message);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const key = (event) => {
      if (busy || loading || createOpen || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
        event.preventDefault();
        edit({ type: event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo' });
        setErrorCells(null); setValidationError(null); setUnreachable([]); setSavedNotice(null);
      }
    };
    const unload = (event) => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  }, [busy, loading, unsaved, createOpen]);

  return (
    <div className="layout-editor blueprint-studio">
      <div className="product-page-heading editor-heading">
        <div><span className="eyebrow">Warehouse configuration</span><h1 className="view-title">Warehouse Blueprint Studio</h1><p>Design your warehouse layout, place equipment, and save it before training a navigation model.</p></div>
        <div className="blueprint-header-actions"><span className={`badge ${unsaved ? 'badge-warn' : ''}`}>{saved?.is_draft ? 'Local draft · not saved' : unsaved ? 'Unsaved changes' : 'No pending changes'}</span><button type="button" className="clay-btn" disabled={busy} onClick={() => { setDimensionError(null); setCreateOpen(true); }}>New blueprint</button></div>
      </div>
      <div className="editor-settings">
        <label className="field">Warehouse blueprint
          <select className="clay-select" value={selectedId} disabled={busy} onChange={(event) => {
            if (!unsaved || window.confirm('Discard unsaved layout changes?')) {
              setSelectedId(event.target.value); setLoadError(null); clearFeedback();
            }
          }}>
            {selectedId === DRAFT_ID && <option value={DRAFT_ID}>{name} (local draft)</option>}
            {!layouts.some((layout) => layout.id === 'default') && <option value="default">Default warehouse (built-in)</option>}
            {saved && !saved.is_draft && saved.id !== 'default' && !layouts.some((layout) => layout.id === saved.id) && <option value={saved.id}>{saved.name}</option>}
            {layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}{layout.is_default ? ' (built-in)' : ''}</option>)}
          </select>
        </label>
        <label className="field blueprint-name">Name<input className="clay-input" disabled={busy || loading} maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setSavedNotice(null); }} /></label>
        <div className="blueprint-dimensions"><span className="eyebrow">Grid dimensions</span><strong>{loading ? '—' : `${saved.width} × ${saved.height}`} <span>cells</span></strong><span>Logical grid · no physical units</span></div>
        <div className="blueprint-save-actions">
          {saved && !saved.is_default && !saved.is_draft && <button type="button" className="clay-btn clay-btn-accent" onClick={() => save(false)} disabled={busy || loading || (!dirty && name === saved.name)}>Save changes</button>}
          <button type="button" className={`clay-btn ${saved?.is_draft ? 'clay-btn-accent' : ''}`} onClick={() => save(true)} disabled={busy || loading}>{busy ? 'Saving…' : saved?.is_draft ? 'Save blueprint' : 'Save as new layout'}</button>
        </div>
      </div>
      <div className="editor-brushes">
        <MapPaintToolbar resetLabel={saved?.is_draft ? 'Clear draft floor' : 'Reset to saved'} activeBrush={busy || loading ? null : brush} onSelectBrush={setBrush} disabled={!cells || busy || loading} onReset={() => { edit({ type: 'replace', cells: saved.cells.map((row) => [...row]) }); clearFeedback(); }} />
        <div className="bar-group blueprint-history" role="group" aria-label="Blueprint edit history">
          <button type="button" className="clay-btn clay-pill-sm" disabled={!history.past.length || busy || loading} onClick={() => changeHistory('undo')} title="Undo stroke (Ctrl/Cmd+Z)">Undo</button>
          <button type="button" className="clay-btn clay-pill-sm" disabled={!history.future.length || busy || loading} onClick={() => changeHistory('redo')} title="Redo stroke (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)">Redo</button>
          <span className="micro-copy">One undo step per drag stroke</span>
        </div>
      </div>
      <div className="blueprint-readiness" hidden={loading} aria-label="Equipment inventory">
        <span>{counts.rack} rack cells · {counts.aisle} aisle cells · {preview?.pick_faces.length ?? 0} pick faces</span>
        {[['packing', 'Packing'], ['charger', 'Charging'], ['dock', 'Shipping']].map(([kind, label]) => <span key={kind} className={counts[kind] ? 'equipment-present' : 'equipment-missing'}>{counts[kind] ? '✓' : '○'} {label}: {counts[kind]}</span>)}
        <span>At least one of each station type is required; keep routes connected.</span>
      </div>
      <p className="editor-note">{saved?.is_default ? 'The built-in warehouse is preserved: use Save as new layout for your edits. ' : ''}Drag to paint continuous rows; use Walkable aisles to erase. Racks block movement but remain storage—custom wall or obstacle types are not supported. Products are assigned to pick faces when saved.</p>
      {savedNotice && <div className="blueprint-next-step" role="status"><div><strong>Blueprint saved: {savedNotice.name}</strong><p>{savedNotice.width} × {savedNotice.height} cells · Next, configure robots and navigation. Shortest-path navigation needs no training; train a model only to use learned routes.</p></div>{onUseLayout && <div className="bar-group"><button className="clay-btn clay-pill-sm" type="button" onClick={() => onUseLayout(savedNotice.id, 'models')}>Train AI (optional)</button><button className="clay-btn clay-pill-sm" type="button" onClick={() => onUseLayout(savedNotice.id, 'session')}>Configure simulation</button></div>}</div>}
      {validationError && <div className="inline-error" role="alert"><strong>Blueprint could not be saved.</strong> {validationError}{unreachable.length > 0 && <p>Destinations {unreachable.map(([x, y]) => coordLabel(x, y)).join(', ')} cannot be reached from the chargers and are marked in red. Paint walkable aisles to connect them, then save again.</p>}</div>}
      {listError && <div className="inline-error" role="alert">Saved warehouse list unavailable: {listError} <button type="button" className="clay-btn clay-pill-sm" onClick={() => setListVersion((value) => value + 1)}>Retry list</button></div>}
      {loadError && <div className="inline-error" role="alert">Unable to load this layout: {loadError} <button type="button" className="clay-btn clay-pill-sm" onClick={() => { setLoadError(null); setLoadVersion((value) => value + 1); }}>Retry layout</button></div>}
      <div className="blueprint-map"><WarehouseMapCanvas key={selectedId} layout={loading ? null : preview} layers={NO_LAYERS} activeBrush={busy || loading ? null : brush} onPaintCell={paint} errorCells={errorCells} /></div>
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New warehouse blueprint">
        <form onSubmit={createDraft} className="blueprint-create-form">
          <p>Start with an empty walkable floor, then place storage and equipment. Existing warehouses are not resized or overwritten.</p>
          <label className="field">Warehouse name<input className="clay-input" required maxLength={80} value={blueprint.name} onChange={(event) => setBlueprint({ ...blueprint, name: event.target.value })} /></label>
          <div className="field-row">{[['width', 'Width'], ['height', 'Height']].map(([key, label]) => <label className="field" key={key}>{label} (cells)<input type="number" className="clay-input" required min={4} max={40} step={1} value={blueprint[key]} onChange={(event) => setBlueprint({ ...blueprint, [key]: event.target.value })} /><span className="field-hint">4–40 whole cells</span></label>)}</div>
          <p className="micro-copy">Dimensions describe logical cells only. Meters, feet, imported floor plans, and physical equipment sizes are not supported.</p>
          {dimensionError && <div className="inline-error" role="alert">{dimensionError}</div>}
          <div className="blueprint-dialog-actions"><button type="button" className="clay-btn" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="clay-btn clay-btn-accent">Create local draft</button></div>
        </form>
      </Dialog>
    </div>
  );
}
