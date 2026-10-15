import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HyperparameterFields } from '../components/HyperparameterFields';
import { LineChart } from '../components/LineChart';
import { WarehouseMapCanvas } from '../components/WarehouseMapCanvas';
import { useToast } from '../components/toastContext';
import { useTrainingJob } from '../hooks/useTrainingJob';
import { averageCurve } from '../lib/curves';
import { coordLabel } from '../lib/grid';
import { DEFAULT_HYPERPARAMETERS } from '../lib/hyperparameters';
import { api } from '../services/api';

const HEAT_LAYERS = { paths: false, qHeatmap: true, yieldHalos: false };

function toPoints(values, episodes) {
  const n = values.length;
  return values.map((y, i) => ({ x: n > 1 ? Math.round((i / (n - 1)) * episodes) : episodes, y }));
}

export function ModelsView() {
  const toast = useToast();
  const fileRef = useRef(null);
  const [models, setModels] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [layout, setLayout] = useState(null);
  const [newModel, setNewModel] = useState({ name: '', layout_id: 'default', hyperparameters: DEFAULT_HYPERPARAMETERS });
  const [trainHp, setTrainHp] = useState(DEFAULT_HYPERPARAMETERS);
  const [jobId, setJobId] = useState(null);
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
      })
      .catch((err) => toast(err.message));
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
        setTrainHp({ ...DEFAULT_HYPERPARAMETERS, ...d.hyperparameters });
        setLayout(l);
        setHeatDest(d.destinations[0] ?? null);
      })
      .catch((err) => toast(err.message));
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
      .then((t) => { if (!cancelled) setHeatmap(t); })
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
      rewards: rewards.length ? [{ label: 'Average reward per episode', color: '#FF5A26', points: toPoints(rewards, n) }] : [],
      steps: steps.length ? [{ label: 'Average steps to reach the goal', color: '#2563EB', points: toPoints(steps, n) }] : [],
    };
  }, [curves, episodes]);

  const create = async (e) => {
    e.preventDefault();
    try {
      const model = await api.createModel(newModel);
      setNewModel({ ...newModel, name: '' });
      await refreshList();
      setSelectedId(model.id);
      toast(`Created "${model.name}"`, 'success');
    } catch (err) {
      toast(err.message);
    }
  };

  const train = async () => {
    try {
      const started = await api.trainModel(selectedId, { hyperparameters: trainHp });
      setJobId(started.id);
    } catch (err) {
      toast(err.message);
    }
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const model = await api.importModel(JSON.parse(await file.text()));
      await refreshList();
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
  const training = job && (job.status === 'queued' || job.status === 'running');

  return (
    <div className="view-scroll">
      <h1 className="view-title">Models</h1>
      <div className="split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form className="clay-card panel" onSubmit={create}>
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
              <HyperparameterFields value={newModel.hyperparameters} onChange={(hp) => setNewModel({ ...newModel, hyperparameters: hp })} />
              <button type="submit" className="clay-btn clay-btn-accent">Create model</button>
            </div>
          </form>
          <div className="clay-card panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="view-subtitle" style={{ margin: 0 }}>Saved models</div>
              <button type="button" className="clay-btn clay-pill-sm" onClick={() => fileRef.current?.click()}>Import JSON</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
            </div>
            {models.length === 0 && <p style={{ fontSize: 12, color: '#8E8578' }}>No models yet. Create one above, then train it.</p>}
            <table className="data-table">
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className={`clickable ${m.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(m.id); setConfirmDelete(false); }}>
                    <td><strong>{m.name}</strong><div style={{ fontSize: 10, color: '#8E8578' }}>v{m.version} · {layoutName(m.layout_id)}</div></td>
                    <td className="num">{m.trained_destinations} trained</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!detail ? (
          <div className="clay-card panel empty-state" style={{ minHeight: 300 }}>Select a model to train it and inspect what it learned.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="clay-card panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800 }}>{detail.name} <span className="badge">v{detail.version}</span></h2>
                  <div style={{ fontSize: 12, color: '#6B6357' }}>
                    {layoutName(detail.layout_id)} · {detail.trained_destinations} / {detail.layout_destinations.length} destinations trained
                    {detail.last_trained_at && ` · last trained ${new Date(detail.last_trained_at).toLocaleString()}`}
                  </div>
                  {!detail.layout_matches && <span className="badge badge-warn">Layout changed since this model was created; retrain it.</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a className="clay-btn clay-pill-sm" href={api.exportModelUrl(detail.id)} download>Export JSON</a>
                  <button type="button" className="clay-btn clay-pill-sm" onClick={remove}>{confirmDelete ? 'Click again to delete' : 'Delete'}</button>
                </div>
              </div>
            </div>

            <div className="clay-card panel">
              <div className="view-subtitle">Train</div>
              <HyperparameterFields value={trainHp} onChange={setTrainHp} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button type="button" className="clay-btn clay-btn-accent" onClick={train} disabled={training}>
                  {training ? 'Training…' : detail.trained_destinations ? 'Train more' : 'Train all destinations'}
                </button>
                {job && (
                  <div style={{ flex: 1 }}>
                    <div className="progress"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
                    <div style={{ fontSize: 11, color: '#6B6357', marginTop: 4 }}>
                      {job.done} / {job.total} destinations
                      {job.current_destination && ` · ${coordLabel(job.current_destination[0], job.current_destination[1])}`}
                    </div>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11, color: '#8E8578', marginTop: 8 }}>
                Training continues from the current Q-values, so pressing Train more adds episodes on top.
              </p>
            </div>

            <div className="clay-card panel">
              <div className="view-subtitle">Learning curve (averaged over destinations)</div>
              <LineChart series={chartSeries.rewards} xLabel="episode" yLabel="Reward" />
              <LineChart series={chartSeries.steps} xLabel="episode" yLabel="Steps" height={150} />
            </div>

            <div className="clay-card panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div className="view-subtitle" style={{ margin: 0 }}>What the robot learned for one destination</div>
                <select className="clay-select" style={{ width: 'auto' }} value={heatDest ? heatDest.join(',') : ''}
                  onChange={(e) => setHeatDest(e.target.value.split(',').map(Number))} disabled={!detail.destinations.length}>
                  {detail.destinations.map(([x, y]) => <option key={`${x},${y}`} value={`${x},${y}`}>{coordLabel(x, y)}</option>)}
                </select>
              </div>
              {detail.destinations.length ? (
                <div style={{ height: 460 }}>
                  <WarehouseMapCanvas layout={layout} layers={HEAT_LAYERS} heatmap={heatmap} heatmapTarget={heatDest} />
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#8E8578' }}>Train the model to see its Q-value heatmap and policy arrows.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
