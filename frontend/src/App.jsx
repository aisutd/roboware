import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SimulationEngine } from './services/simulationEngine';
import { WarehouseMapCanvas } from './components/WarehouseMapCanvas';
import { TopMapHud } from './components/TopMapHud';
import { MapPaintToolbar } from './components/MapPaintToolbar';
import { PlaybackDock } from './components/PlaybackDock';
import { OrderDemandDrawer } from './components/OrderDemandDrawer';
import { AgentBrainInspector } from './components/AgentBrainInspector';

export default function App() {
  const engineRef = useRef(null);

  // Initialize engine once
  if (!engineRef.current) {
    engineRef.current = new SimulationEngine();
  }
  const engine = engineRef.current;

  // React state synced with engine
  const [tick, setTick] = useState(engine.tick);
  const [episode, setEpisode] = useState(engine.episode);
  const [stats, setStats] = useState({ ...engine.stats });
  const [grid, setGrid] = useState(engine.grid.map((r) => [...r]));
  const [robots, setRobots] = useState(engine.robots.map((r) => ({ ...r })));
  const [orders, setOrders] = useState([...engine.orders]);
  const [routingMode, setRoutingMode] = useState(engine.routingMode);
  const [autoDemandWave, setAutoDemandWave] = useState(engine.autoDemandWave);
  const [hyperparameters, setHyperparameters] = useState({ ...engine.hyperparameters });

  // UI Interactive state
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedRobotId, setSelectedRobotId] = useState('R1');
  const [activeBrush, setActiveBrush] = useState(null);
  const [isTraining, setIsTraining] = useState(false);

  // Cartographic layer toggles
  const [layers, setLayers] = useState({
    paths: true,
    qHeatmap: false,
    yieldHalos: true,
  });

  // Sync React state from engine
  const syncStateFromEngine = useCallback(() => {
    setTick(engine.tick);
    setEpisode(engine.episode);
    setStats({ ...engine.stats });
    setGrid(engine.grid.map((r) => [...r]));
    setRobots(engine.robots.map((r) => ({ ...r })));
    setOrders([...engine.orders]);
    setRoutingMode(engine.routingMode);
    setAutoDemandWave(engine.autoDemandWave);
    setHyperparameters({ ...engine.hyperparameters });
  }, [engine]);

  // Simulation step execution
  const handleStep = useCallback(() => {
    engine.step();
    syncStateFromEngine();
  }, [engine, syncStateFromEngine]);

  // Simulation timer loop
  useEffect(() => {
    if (!isPlaying) return;

    const baseDelay = 600; // ms per tick at 1x
    const intervalTime = Math.max(40, Math.floor(baseDelay / speed));

    const intervalId = setInterval(() => {
      handleStep();
    }, intervalTime);

    return () => clearInterval(intervalId);
  }, [isPlaying, speed, handleStep]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if focus is in an input
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === '1') {
        setSelectedRobotId('R1');
      } else if (e.key === '2') {
        setSelectedRobotId('R2');
      } else if (e.key === '3') {
        setSelectedRobotId('R3');
      } else if (e.key === '4') {
        setSelectedRobotId('R4');
      } else if (e.key.toLowerCase() === 'p') {
        setLayers((prev) => ({ ...prev, paths: !prev.paths }));
      } else if (e.key.toLowerCase() === 'q') {
        setLayers((prev) => ({ ...prev, qHeatmap: !prev.qHeatmap }));
      } else if (e.key.toLowerCase() === 'h') {
        setLayers((prev) => ({ ...prev, yieldHalos: !prev.yieldHalos }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handlers
  const handleTogglePlay = () => setIsPlaying((prev) => !prev);

  const handleChangeRoutingMode = (mode) => {
    engine.routingMode = mode;
    syncStateFromEngine();
  };

  const handleToggleLayer = (layerKey) => {
    setLayers((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }));
  };

  const handlePaintCell = (x, y, brushType) => {
    engine.paintCell(x, y, brushType);
    syncStateFromEngine();
  };

  const handleResetDefaultLayout = () => {
    engine.resetWorld();
    syncStateFromEngine();
  };

  const handleInjectOrder = () => {
    engine.injectLiveOrder();
    syncStateFromEngine();
  };

  const handleToggleAutoDemand = () => {
    engine.autoDemandWave = !engine.autoDemandWave;
    syncStateFromEngine();
  };

  const handleChangeHyperparameters = (newParams) => {
    engine.hyperparameters = newParams;
    syncStateFromEngine();
  };

  const handleFastTrain = () => {
    setIsTraining(true);
    setTimeout(() => {
      engine.fastTrain100();
      syncStateFromEngine();
      setIsTraining(false);
    }, 50);
  };

  const handleExportModel = () => {
    const jsonStr = engine.exportModelJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `roboware_model_ep${engine.episode}_tick${engine.tick}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportModel = (jsonContent) => {
    const res = engine.importModelJSON(jsonContent);
    if (res.success) {
      syncStateFromEngine();
    } else {
      alert(`Model import error: ${res.error}`);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Centered Miniature Spatial Canvas */}
      <WarehouseMapCanvas
        grid={grid}
        robots={robots}
        selectedRobotId={selectedRobotId}
        onSelectRobot={setSelectedRobotId}
        layers={layers}
        activeBrush={activeBrush}
        onPaintCell={handlePaintCell}
        simEngine={engine}
      />

      {/* Floating Top-Left OS HUD Pill */}
      <TopMapHud
        tick={tick}
        episode={episode}
        routingMode={routingMode}
        onChangeRoutingMode={handleChangeRoutingMode}
        layers={layers}
        onToggleLayer={handleToggleLayer}
      />

      {/* Floating Bottom-Left Paint Toolbar */}
      <MapPaintToolbar
        activeBrush={activeBrush}
        onSelectBrush={setActiveBrush}
        onResetDefaultLayout={handleResetDefaultLayout}
      />

      {/* Floating Bottom-Center Playback Dock */}
      <PlaybackDock
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
        onStep={handleStep}
        onFastTrain={handleFastTrain}
        isTraining={isTraining}
        onResetWorld={handleResetDefaultLayout}
        speed={speed}
        onChangeSpeed={setSpeed}
      />

      {/* Floating Top-Right Order Demand & KPI Drawer */}
      <OrderDemandDrawer
        stats={stats}
        orders={orders}
        onInjectOrder={handleInjectOrder}
        autoDemandWave={autoDemandWave}
        onToggleAutoDemand={handleToggleAutoDemand}
      />

      {/* Floating Bottom-Right Agent Brain Inspector */}
      <AgentBrainInspector
        robots={robots}
        selectedRobotId={selectedRobotId}
        onSelectRobot={setSelectedRobotId}
        hyperparameters={hyperparameters}
        onChangeHyperparameters={handleChangeHyperparameters}
        onExportModel={handleExportModel}
        onImportModel={handleImportModel}
      />
    </div>
  );
}
