import { useEffect, useMemo, useState } from 'react';
import { MapPaintToolbar } from '../components/MapPaintToolbar';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { cellKey, pickFaces } from '../lib/grid';
import { api } from '../services/api';

const NO_LAYERS = { paths: false, qHeatmap: false, yieldHalos: false };

export function LayoutsView() {
  const toast = useToast();
  const [layouts, setLayouts] = useState([]);
  const [listVersion, setListVersion] = useState(0);
  const [selectedId, setSelectedId] = useState('default');
  const [saved, setSaved] = useState(null);
  const [cells, setCells] = useState(null);
  const [name, setName] = useState('');
  const [brush, setBrush] = useState(null);
  const [errorCells, setErrorCells] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.listLayouts()
      .then((list) => { if (!cancelled) setLayouts(list); })
      .catch((err) => toast(err.message));
    return () => { cancelled = true; };
  }, [listVersion, toast]);

  useEffect(() => {
    let cancelled = false;
    api.getLayout(selectedId)
      .then((layout) => {
        if (cancelled) return;
        setSaved(layout);
        setCells(layout.cells.map((row) => [...row]));
        setName(layout.is_default ? `${layout.name} copy` : layout.name);
        setErrorCells(null);
      })
      .catch((err) => toast(err.message));
    return () => { cancelled = true; };
  }, [selectedId, toast]);

  const dirty = useMemo(() => Boolean(saved && cells && JSON.stringify(saved.cells) !== JSON.stringify(cells)), [saved, cells]);
  const preview = useMemo(() => {
    if (!saved || !cells) return null;
    return { ...saved, cells, products: dirty ? [] : saved.products, pick_faces: pickFaces(cells) };
  }, [saved, cells, dirty]);
  const counts = useMemo(() => {
    const c = { rack: 0, packing: 0, dock: 0, charger: 0 };
    cells?.forEach((row) => row.forEach((kind) => { if (kind in c) c[kind] += 1; }));
    return c;
  }, [cells]);

  const paint = (x, y) => {
    if (!brush || !saved) return;
    setCells((prev) => {
      if (prev[y][x] === brush) return prev;
      const next = prev.map((row) => [...row]);
      next[y][x] = brush;
      return next;
    });
    setErrorCells(null);
  };

  const save = async (asNew) => {
    const body = { name: name.trim() || 'Untitled layout', width: saved.width, height: saved.height, cells, products: null };
    try {
      const result = asNew ? await api.createLayout(body) : await api.updateLayout(saved.id, body);
      toast(asNew ? `Saved new layout "${result.name}"` : 'Layout saved', 'success');
      setListVersion((v) => v + 1);
      if (asNew) setSelectedId(result.id);
      else {
        setSaved(result);
        setCells(result.cells.map((row) => [...row]));
      }
    } catch (err) {
      const unreachable = err.detail?.unreachable;
      if (unreachable?.length) setErrorCells(new Set(unreachable.map(([x, y]) => cellKey(x, y))));
      toast(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '24px 32px 12px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <h1 className="view-title" style={{ margin: 0, marginRight: 8 }}>Layouts</h1>
        <label className="field">Layout
          <select className="clay-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}{l.is_default ? ' (built-in)' : ''}</option>)}
          </select>
        </label>
        <label className="field" style={{ minWidth: 220 }}>Name
          <input className="clay-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {saved && !saved.is_default && (
          <button type="button" className="clay-btn clay-btn-accent" onClick={() => save(false)} disabled={!dirty && name === saved.name}>Save</button>
        )}
        <button type="button" className="clay-btn" onClick={() => save(true)} disabled={!saved}>Save as new layout</button>
      </div>
      <div style={{ padding: '0 32px 8px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <MapPaintToolbar activeBrush={brush} onSelectBrush={setBrush} disabled={!cells}
          onReset={() => { setCells(saved.cells.map((row) => [...row])); setErrorCells(null); }} />
        <span style={{ fontSize: 12, color: '#6B6357' }}>
          {counts.rack} racks · {preview?.pick_faces.length ?? 0} pick faces · {counts.packing} packing · {counts.dock} docks · {counts.charger} chargers
          {dirty && ' · unsaved changes'}
        </span>
      </div>
      <p style={{ padding: '0 32px', fontSize: 11, color: '#8E8578' }}>
        {saved?.is_default ? 'The built-in layout is read-only; paint on it and use "Save as new layout". ' : ''}
        Products are spread over the pick faces automatically when you save. Models are tied to a layout, so retrain after editing one.
      </p>
      <div style={{ flex: 1, minHeight: 0 }}>
        <WarehouseMapCanvas layout={preview} layers={NO_LAYERS} activeBrush={brush} onPaintCell={paint} errorCells={errorCells} />
      </div>
    </div>
  );
}
