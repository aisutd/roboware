import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HyperparameterFields } from '../components/HyperparameterFields';
import { LineChart } from '../components/LineChart';
import { ModelBadge } from '../components/ModelBadge';
import { PixelIcon } from '../components/PixelIcon';
import { RobotPet } from '../components/RobotPet';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { useTrainingJob } from '../hooks/useTrainingJob';
import { averageCurve } from '../lib/curves';
import { coordLabel } from '../lib/grid';
import { DEFAULT_HYPERPARAMETERS } from '../lib/hyperparameters';
import { ROBOT_COLORS } from '../lib/pet';
import { api } from '../services/api';

const HEAT_LAYERS = { paths: false, qHeatmap: true };
const NO_LAYERS = { paths: false, qHeatmap: false };
const TRAINEE = { id: 'R1', color: ROBOT_COLORS[0], status: 'to_pick', path: [[1, 0]], battery: 100, heading: 'right' };
const NAPPER = { id: 'R1', color: ROBOT_COLORS[0], status: 'idle', battery: 100 };

function toPoints(values, episodes) {
  const n = values.length;
  return values.map((y, i) => ({ x: n > 1 ? Math.round((i / (n - 1)) * episodes) : episodes, y }));
}

function ago(iso) {
  if (!iso) return null;
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

// Training Lab: every warehouse has its own model, and a warehouse can only run once that model is
// trained on its current floor. Pick a warehouse, press Train, then look at the routes it learned.
export function ModelsView({ initialLayoutId = null, onUseModel, onBackToSetup }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [layouts, setLayouts] = useState([]);
  const [models, setModels] = useState([]);
  const [listVersion, setListVersion] = useState(0);
  const [layoutId, setLayoutId] = useState(initialLayoutId);
  const [layout, setLayout] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [hp, setHp] = useState(DEFAULT_HYPERPARAMETERS);
  const [jobId, setJobId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [heatDest, setHeatDest] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = useCallback(() => { setListVersion((v) => v + 1); setDetailVersion((v) => v + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listLayouts(), api.listModels()])
      .then(([l, m]) => {
        if (cancelled) return;
        setLayouts(l);
        setModels(m);
        setLayoutId((current) => current ?? l[0]?.id ?? null);
      })
      .catch((err) => { if (!cancelled) toast(err.message); });
    return () => { cancelled = true; };
  }, [listVersion, toast]);

  const entry = layouts.find((l) => l.id === layoutId);
  // This warehouse's model: the one trained on its current floor, else its newest one.
  const model = useMemo(() => {
    const own = models.filter((m) => m.layout_id === layoutId);
    return own.find((m) => m.id === entry?.model_id) ?? own[0] ?? null;
  }, [models, layoutId, entry]);
  const modelId = model?.id ?? null;

  useEffect(() => {
    if (!layoutId) return undefined;
    let cancelled = false;
    Promise.all([api.getLayout(layoutId), modelId ? api.getModel(modelId) : null])
      .then(([l, d]) => {
        if (cancelled) return;
        setLayout(l);
        setDetail(d);
        if (d) setHp({ ...DEFAULT_HYPERPARAMETERS, ...d.hyperparameters });
        setHeatDest((current) => (d?.destinations.some(([x, y]) => current && x === current[0] && y === current[1]) ? current : d?.destinations[0] ?? null));
      })
      .catch((err) => { if (!cancelled) toast(err.message); });
    return () => { cancelled = true; };
  }, [layoutId, modelId, detailVersion, toast]);

  const job = useTrainingJob(jobId, (finished) => {
    if (finished.status === 'completed') toast(`Trained ${finished.total} spots. Ready to run!`, 'success');
    else toast(`Training failed: ${finished.error}`);
    setJobId(null);
    refresh();
  });

  useEffect(() => {
    if (!modelId || !heatDest || !detail?.layout_matches) return undefined;
    let cancelled = false;
    api.getQTable(modelId, heatDest)
      .then((t) => { if (!cancelled) setHeatmap({ ...t, key: `${modelId}:${heatDest.join(',')}` }); })
      .catch(() => { if (!cancelled) setHeatmap(null); });
    return () => { cancelled = true; };
  }, [modelId, heatDest, detail]);

  const curves = job?.curves && Object.keys(job.curves).length ? job.curves : detail?.training_history;
  const chart = useMemo(() => {
    const steps = averageCurve(curves, 'steps', 80);
    const n = Object.values(curves ?? {})[0]?.episodes ?? hp.episodes_per_destination;
    return steps.length ? [{ label: 'Steps to reach a spot', color: '#e4b366', points: toPoints(steps, n) }] : [];
  }, [curves, hp.episodes_per_destination]);

  const training = Boolean(jobId) || starting;
  const status = entry?.model_status ?? 'untrained';
  const total = detail?.layout_destinations.length ?? layout?.destinations?.length ?? 0;
  const learned = detail?.layout_matches ? detail.trained_destinations : 0;
  const progress = job && Number.isFinite(job.progress) ? job.progress : null;

  const train = async () => {
    setStarting(true);
    setConfirmDelete(false);
    try {
      let id = modelId;
      if (!id) {
        const created = await api.createModel({ name: `${entry?.name ?? 'Warehouse'} model`, layout_id: layoutId, hyperparameters: hp });
        id = created.id;
        setModels((list) => [created, ...list]);
      }
      const started = await api.trainModel(id, { hyperparameters: hp });
      setJobId(started.id);
    } catch (err) {
      toast(err.message);
    } finally { setStarting(false); }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = await api.importModel(JSON.parse(await file.text()));
      setLayoutId(imported.layout_id);
      refresh();
      toast(`Imported "${imported.name}"`, 'success');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }
  };

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      await api.deleteModel(modelId);
      setConfirmDelete(false);
      setHeatmap(null);
      refresh();
    } catch (err) { toast(err.message); }
  };

  const select = (id) => {
    if (training || id === layoutId) return;
    setLayoutId(id);
    setDetail(null);
    setHeatmap(null);
    setConfirmDelete(false);
  };

  const showHeat = detail?.layout_matches && heatmap?.key === `${modelId}:${heatDest?.join(',')}`;
  return (
    <div className="view-scroll lab">
      <aside className="lab-list" aria-label="Warehouses">
        <div className="lab-list-head">
          <h1 className="lab-title"><PixelIcon name="brain" /> Training Lab</h1>
          <p className="lab-sub">Each warehouse learns its own routes.</p>
        </div>
        {layouts.map((l) => (
          <button key={l.id} type="button" className="lab-card" aria-pressed={l.id === layoutId} disabled={training && l.id !== layoutId} onClick={() => select(l.id)}>
            <span className="lab-card-name">{l.name}</span>
            <ModelBadge status={l.model_status} />
          </button>
        ))}
        <button type="button" className="px-btn px-small lab-import" onClick={() => fileRef.current?.click()} disabled={training} title="Import a model file (.json)">
          <PixelIcon name="upload" /> Import
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
      </aside>

      <section className="lab-main">
        <header className="lab-head">
          <div className="lab-head-title">
            <h2>{entry?.name ?? 'Warehouse'}</h2>
            <ModelBadge status={training ? 'training' : status} />
          </div>
          <div className="lab-head-actions">
            {onBackToSetup && <button type="button" className="px-btn px-small" onClick={onBackToSetup}>Back to setup</button>}
            {model && (
              <>
                <a className="px-btn px-small px-icon-btn" href={api.exportModelUrl(model.id)} download title="Export model (.json)" aria-label="Export model"><PixelIcon name="download" /></a>
                <button type="button" className={`px-btn px-small ${confirmDelete ? 'px-danger' : 'px-icon-btn'}`} onClick={remove} disabled={training}
                  title="Delete this model" aria-label="Delete model">
                  <PixelIcon name="trash" />{confirmDelete && 'Delete?'}
                </button>
              </>
            )}
          </div>
        </header>

        <div className="lab-arena">
          {layout ? (
            <WarehouseMapCanvas key={layoutId} wheelZoom={false} layout={layout} layers={showHeat ? HEAT_LAYERS : NO_LAYERS}
              heatmap={showHeat ? heatmap : null} heatmapTarget={showHeat ? heatDest : null} />
          ) : <div className="lab-arena-empty">Loading…</div>}
          {showHeat && detail.destinations.length > 0 && (
            <label className="lab-routes hud-glass">
              <span>Routes to</span>
              <select className="setup-select" value={heatDest?.join(',') ?? ''} onChange={(e) => setHeatDest(e.target.value.split(',').map(Number))}>
                {detail.destinations.map(([x, y]) => <option key={`${x},${y}`} value={`${x},${y}`}>{coordLabel(x, y)}</option>)}
              </select>
            </label>
          )}
          {!training && status !== 'ready' && layout && (
            <div className="lab-sleeper hud-glass">
              <span className="lab-sleeper-pet"><RobotPet robot={NAPPER} tick={0} /></span>
              <span>{status === 'outdated' ? 'The floor changed. Retrain to catch up.' : 'No routes learned yet.'}</span>
            </div>
          )}
        </div>

        <div className="lab-train">
          <button type="button" className="px-btn px-primary lab-train-btn" onClick={train} disabled={training || !layoutId}>
            <PixelIcon name="brain" />{training ? 'Training…' : status === 'ready' ? 'Train more' : status === 'outdated' ? 'Retrain' : 'Train'}
          </button>
          <div className="lab-progress" aria-live="polite">
            <div className="lab-track">
              <div className="lab-fill" style={{ width: `${Math.round((progress ?? (total ? learned / total : 0)) * 100)}%` }} />
              {training && <span className="lab-runner" style={{ left: `${Math.round((progress ?? 0) * 100)}%` }}><RobotPet robot={TRAINEE} tick={0} /></span>}
            </div>
            <span className="lab-progress-text">
              {training
                ? `${job?.done ?? 0} / ${job?.total ?? total} spots${job?.current_destination ? ` · ${coordLabel(...job.current_destination)}` : ''}`
                : `${learned} / ${total} spots learned${detail?.last_trained_at && status === 'ready' ? ` · ${ago(detail.last_trained_at)}` : ''}`}
            </span>
          </div>
          {status === 'ready' && !training && onUseModel && (
            <button type="button" className="px-btn" onClick={() => onUseModel(layoutId, modelId)}><PixelIcon name="play" /> Run</button>
          )}
        </div>
        {job?.pollingError && <p className="lab-note">Lost touch with training ({job.pollingError}). Retrying…</p>}

        {chart.length > 0 && (
          <div className="lab-curve">
            <span className="lab-curve-title">Getting faster</span>
            <LineChart series={chart} xLabel="practice run" yLabel="Steps" height={150} />
          </div>
        )}

        <details className="advanced-options lab-tune">
          <summary><PixelIcon name="chevron" className="setup-chevron" /> Fine-tune training</summary>
          <div className="advanced-fields"><HyperparameterFields value={hp} onChange={setHp} /></div>
        </details>
      </section>
    </div>
  );
}
