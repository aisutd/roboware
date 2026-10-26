import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { HyperparameterFields } from '../components/HyperparameterFields';
import { LineChart } from '../components/LineChart';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { useTrainingJob } from '../hooks/useTrainingJob';
import { averageCurve } from '../lib/curves';
import { coordLabel } from '../lib/grid';
import { DEFAULT_HYPERPARAMETERS } from '../lib/hyperparameters';
import { api } from '../services/api';

const HEAT_LAYERS = { paths: false, qHeatmap: true };

function toPoints(values, episodes) {
  const n = values.length;
  return values.map((y, i) => ({ x: n > 1 ? Math.round((i / (n - 1)) * episodes) : episodes, y }));
}

export function ModelsView({ initialLayoutId = null, initialModelId = null, onUseModel, onBackToSetup, onNavigate }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [createOpen, setCreateOpen] = useState(Boolean(initialLayoutId) && !initialModelId);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [models, setModels] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [layouts, setLayouts] = useState([]);
  const [selectedId, setSelectedId] = useState(initialModelId);
  const [detail, setDetail] = useState(null);
  const [layout, setLayout] = useState(null);
  const [newModel, setNewModel] = useState({ name: '', layout_id: initialLayoutId ?? 'default', hyperparameters: DEFAULT_HYPERPARAMETERS });
  const [trainHp, setTrainHp] = useState(DEFAULT_HYPERPARAMETERS);
  const [jobId, setJobId] = useState(null);
  const [trainStarting, setTrainStarting] = useState(false);
  const [heatDest, setHeatDest] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [detailVersion, setDetailVersion] = useState(0);
  const refreshList = useCallback(() => setListVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listModels(), api.listLayouts()])
      .then(([m, l]) => {
        if (cancelled) return;
        setModels(m);
        setLayouts(l);
        setListError(null);
      })
      .catch((err) => { if (!cancelled) { setListError(err.message); toast(err.message); } })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [listVersion, toast]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    api.getModel(selectedId)
      .then(async (d) => {
        const l = await api.getLayout(d.layout_id);
        if (cancelled) return;
        setDetail(d);
        setDetailError(null);
        setTrainHp({ ...DEFAULT_HYPERPARAMETERS, ...d.hyperparameters });
        setLayout(l);
        setHeatDest(d.destinations[0] ?? null);
      })
      .catch((err) => { if (!cancelled) { setDetailError(err.message); toast(err.message); } });
    return () => { cancelled = true; };
  }, [selectedId, detailVersion, toast]);

  const job = useTrainingJob(jobId, (finished) => {
    if (finished.status === 'completed') toast(`Training finished: ${finished.total} destinations`, 'success');
    else toast(`Training failed: ${finished.error}`);
    setJobId(null);
    refreshList();
    setDetailVersion((v) => v + 1);
  });

  useEffect(() => {
    if (!selectedId || !heatDest) return undefined;
    let cancelled = false;
    api.getQTable(selectedId, heatDest)
      .then((t) => { if (!cancelled) setHeatmap({ ...t, modelId: selectedId, destinationKey: heatDest.join(',') }); })
      .catch(() => { if (!cancelled) setHeatmap(null); });
    return () => { cancelled = true; };
  }, [selectedId, heatDest, detail]);

  const curves = job?.curves && Object.keys(job.curves).length ? job.curves : detail?.training_history;
  const episodes = trainHp.episodes_per_destination;
  const chartSeries = useMemo(() => {
    const rewards = averageCurve(curves, 'rewards', 100);
    const steps = averageCurve(curves, 'steps', 100);
    const n = Object.values(curves ?? {})[0]?.episodes ?? episodes;
    return {
      rewards: rewards.length ? [{ label: 'Average reward per episode', color: '#e4b366', points: toPoints(rewards, n) }] : [],
      steps: steps.length ? [{ label: 'Average steps to reach the goal', color: '#8eafe4', points: toPoints(steps, n) }] : [],
    };
  }, [curves, episodes]);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const model = await api.createModel(newModel);
      setCreateOpen(false);
      setNewModel({ ...newModel, name: '' });
      await refreshList();
      setDetail(null);
      setHeatmap(null);
      setSelectedId(model.id);
      toast(`Created "${model.name}"`, 'success');
    } catch (err) {
      setCreateError(err.message);
      toast(err.message);
    } finally { setCreating(false); }
  };

  const train = async () => {
    setTrainStarting(true);
    try {
      const started = await api.trainModel(selectedId, { hyperparameters: trainHp });
      setJobId(started.id);
    } catch (err) {
      toast(err.message);
    } finally { setTrainStarting(false); }
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const model = await api.importModel(JSON.parse(await file.text()));
      await refreshList();
      setDetail(null);
      setHeatmap(null);
      setSelectedId(model.id);
      toast(`Imported "${model.name}"`, 'success');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteModel(selectedId);
      setSelectedId(null);
      setDetail(null);
      setConfirmDelete(false);
      refreshList();
    } catch (err) {
      toast(err.message);
    }
  };

  const layoutName = (id) => layouts.find((l) => l.id === id)?.name ?? id;
  const training = Boolean(jobId) || trainStarting;

  return (
    <div className="view-scroll training-page">
      <div className="product-page-heading"><div><span className="eyebrow">Routing intelligence</span><h1 className="view-title">Training Lab</h1><p>Teach virtual robots how to reach warehouse destinations. Training is optional for shortest-path navigation.</p></div><button type="button" className="clay-btn clay-btn-accent" onClick={() => setCreateOpen(true)} disabled={training}>New model</button></div>
      <div className="learning-intro"><div><strong>When do I need training?</strong><p>Shortest-path navigation (A*) works immediately. To use AI-trained navigation (Q-learning) or add learned routes to combined navigation, create a model for your warehouse and train it. A model stores what the virtual robots learn; it does not control physical robots.</p><p>Start with the default training settings. One training attempt is called an episode; a destination is a shelf pick face or a station the robot needs to reach.</p></div>{onNavigate && <button type="button" className="clay-btn clay-pill-sm" onClick={() => onBackToSetup ? onBackToSetup() : onNavigate('session')}>{onBackToSetup ? 'Back to simulation setup' : 'Run without training'}</button>}</div>
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create routing model">          <form className="model-create-form" onSubmit={create}>
            <div className="view-subtitle">New model</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="field">Name
                <input className="clay-input" required maxLength={80} value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} />
              </label>
              <label className="field">Layout
                <select className="clay-select" value={newModel.layout_id} onChange={(e) => setNewModel({ ...newModel, layout_id: e.target.value })}>
                  {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <p className="field-hint">A model is a saved learning profile for this warehouse. Create it, then press Train. Default settings are a useful starting point.</p>
              <details className="advanced-options"><summary>Advanced training settings</summary><div className="advanced-fields"><HyperparameterFields value={newModel.hyperparameters} onChange={(hp) => setNewModel({ ...newModel, hyperparameters: hp })} /></div></details>
              {createError && <div className="inline-error" role="alert">{createError}</div>}
              <button type="submit" className="clay-btn clay-btn-accent" disabled={creating}>{creating ? 'Creating…' : 'Create model'}</button>
            </div>
          </form>
      </Dialog>
      <div className="training-lab">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="clay-card panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="view-subtitle" style={{ margin: 0 }}>Saved models</div>
              <button type="button" className="clay-btn clay-pill-sm" onClick={() => fileRef.current?.click()} disabled={training}>Import JSON</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
            </div>
            {listError && <div className="inline-error" role="alert">{listError}<button type="button" className="clay-btn clay-pill-sm" onClick={() => { setListLoading(true); refreshList(); }}>Retry</button></div>}
            {models.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>{listLoading ? 'Loading model library…' : listError ? 'Model library unavailable.' : 'No models yet. Create a routing model to begin.'}</p>}
            <div className="model-library">
              {models.map((m) => (
                <button key={m.id} type="button" className={`model-card ${m.id === selectedId ? 'selected' : ''}`} aria-pressed={m.id === selectedId} disabled={training}
                  onClick={() => { if (m.id !== selectedId) { setSelectedId(m.id); setDetail(null); setDetailError(null); setHeatmap(null); } setConfirmDelete(false); }}>
                  <div className="model-card-title"><strong>{m.name}</strong><span className={`badge ${m.trained_destinations ? 'badge-live' : ''}`}>{m.trained_destinations ? 'Trained' : 'Untrained'}</span></div>
                  <span className="micro-copy">v{m.version} · {layoutName(m.layout_id)}</span>
                  <span className="model-coverage">{m.trained_destinations} trained destinations</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {!detail ? (
          <div className="clay-card panel empty-state" style={{ minHeight: 300 }} role="status">{detailError ? <><span>{detailError}</span><button type="button" className="clay-btn" onClick={() => { setDetailError(null); setDetailVersion((v) => v + 1); }}>Retry model</button></> : selectedId ? 'Loading model and warehouse…' : 'Select a model to train it and inspect what it learned.'}</div>
        ) : (
          <div className="training-detail">
            <div className="clay-card panel training-summary">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800 }}>{detail.name} <span className="badge">v{detail.version}</span></h2>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    {layoutName(detail.layout_id)} · {detail.trained_destinations} / {detail.layout_destinations.length} destinations trained
                    {detail.last_trained_at && ` · last trained ${new Date(detail.last_trained_at).toLocaleString()}`}
                  </div>
                  {!detail.layout_matches && <span className="badge badge-warn">Layout changed since this model was created; retrain it.</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a className="clay-btn clay-pill-sm" href={api.exportModelUrl(detail.id)} download>Export JSON</a>
                  <button type="button" className="clay-btn clay-pill-sm" onClick={remove} disabled={training}>{confirmDelete ? 'Confirm delete' : 'Delete'}</button>{confirmDelete && <button type="button" className="clay-btn clay-pill-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>}
                </div>
              </div>
            </div>

            <div className="clay-card panel training-settings">
              <div className="view-subtitle">Training configuration</div>
              <div className="model-readiness"><span className={`badge ${!detail.layout_matches ? 'badge-warn' : detail.trained_destinations === detail.layout_destinations.length ? 'badge-live' : 'badge-warn'}`}>{!detail.layout_matches ? 'Retrain required' : !detail.trained_destinations ? 'Untrained' : detail.trained_destinations === detail.layout_destinations.length ? 'Ready' : 'Partially trained'}</span><span className="micro-copy">{detail.trained_destinations} / {detail.layout_destinations.length} destinations</span></div>
              <p className="setup-intro">Press Train to let a virtual robot practice reaching each warehouse destination. You can inspect its learned routes below when training finishes.</p>
              <p className="field-hint">Current settings: {trainHp.episodes_per_destination} practice attempts per destination, up to {trainHp.max_steps} steps per attempt.</p>
              <details className="advanced-options"><summary>Advanced training settings <span>Learning rate, exploration, and practice limits</span></summary><div className="advanced-fields"><HyperparameterFields value={trainHp} onChange={setTrainHp} /></div></details>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button type="button" className="clay-btn clay-btn-accent" onClick={train} disabled={training}>
                  {training ? 'Training…' : detail.trained_destinations ? 'Train more' : 'Train all destinations'}
                </button>
                {Number.isFinite(job?.progress) && (
                  <div style={{ flex: 1 }}>
                    <div className="progress"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
                    <div style={{ fontSize: 11, color: 'var(--ink-2)', marginTop: 4 }}>
                      {job.done} / {job.total} destinations
                      {job.current_destination && ` · ${coordLabel(job.current_destination[0], job.current_destination[1])}`}
                    </div>
                  </div>
                )}
              </div>
              {!training && detail.trained_destinations > 0 && onUseModel && <div className="training-next-step"><p>{detail.layout_matches ? 'This model has learned routes. You can now configure a simulation using this warehouse and model.' : 'The warehouse has changed. Retrain before relying on the learned routes; unavailable routes use shortest-path navigation.'}</p><button type="button" className="clay-btn clay-pill-sm" onClick={() => onUseModel(detail.layout_id, detail.id)}>Configure simulation with this model →</button></div>}
              {job?.pollingError && <div className="inline-error" role="alert">Training monitor disconnected: {job.pollingError}. Retrying automatically; the backend job may still be running.</div>}
              <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
                Training continues from the current Q-values, so pressing Train more adds episodes on top.
              </p>
            </div>

            <div className="clay-card panel training-curves">
              <div className="view-subtitle">Learning progress</div><p className="field-hint">Averaged over trained destinations. Reward is the practice score; steps are moves needed to reach a destination. Review actual delivery performance in History & Compare after running a simulation.</p>
              <LineChart series={chartSeries.rewards} xLabel="episode" yLabel="Reward" />
              <LineChart series={chartSeries.steps} xLabel="episode" yLabel="Steps" height={150} />
            </div>

            <div className="clay-card panel training-policy">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <div className="view-subtitle" style={{ margin: 0 }}>Destination policy</div>
                <select aria-label="Policy destination" className="clay-select" style={{ width: 'auto' }} value={heatDest ? heatDest.join(',') : ''}
                  onChange={(e) => setHeatDest(e.target.value.split(',').map(Number))} disabled={!detail.destinations.length}>
                  {detail.destinations.map(([x, y]) => <option key={`${x},${y}`} value={`${x},${y}`}>{coordLabel(x, y)}</option>)}
                </select>
              </div>
              {detail.destinations.length ? (
                <div className="policy-viewport">
                  <WarehouseMapCanvas wheelZoom={false} layout={layout} layers={HEAT_LAYERS} heatmap={heatmap?.modelId === selectedId && heatmap?.destinationKey === heatDest?.join(',') ? heatmap : null} heatmapTarget={heatDest} />
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Train the model to see its Q-value heatmap and policy arrows.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
