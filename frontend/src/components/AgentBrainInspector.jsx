import React, { useState, useRef } from 'react';
import { coordToLabel } from '../services/simulationEngine';

export const AgentBrainInspector = ({
  robots,
  selectedRobotId,
  onSelectRobot,
  hyperparameters,
  onChangeHyperparameters,
  onExportModel,
  onImportModel,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const fileInputRef = useRef(null);

  const selectedRobot = robots.find((r) => r.id === selectedRobotId) || robots[0];
  const qScores = selectedRobot ? selectedRobot.qScores : { up: 0, right: 0, down: 0, left: 0 };

  // Determine highest Q score for compass pad highlight
  const maxQ = Math.max(qScores.up, qScores.right, qScores.down, qScores.left);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result;
          onImportModel(content);
        } catch (err) {
          console.error('Error reading model JSON file:', err);
        }
      };
      reader.readAsText(file);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'CHARGING':
        return '#F59E0B';
      case 'RETURNING_TO_CHARGER':
        return '#F59E0B';
      case 'MOVING_TO_PICK':
      case 'PICKING':
        return '#FF5A26';
      case 'MOVING_TO_PACK':
      case 'PACKING':
        return '#2563EB';
      case 'MOVING_TO_DELIVERY':
      case 'DELIVERING':
        return '#10B981';
      case 'IDLE':
      default:
        return '#736B5F';
    }
  };

  return (
    <div
      className="clay-card"
      style={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        zIndex: 50,
        width: isCollapsed ? 'auto' : '360px',
        padding: '14px 16px',
        transition: 'all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isCollapsed ? '0' : '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: selectedRobot.color,
              boxShadow: `0 0 8px ${selectedRobot.color}`,
            }}
          />
          <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', color: '#23201A' }}>
            AGENT BRAIN INSPECTOR
          </span>
        </div>

        {/* Collapse Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="clay-btn clay-pill-sm"
          style={{ padding: '3px 7px', fontSize: '10px', color: '#8E8578' }}
        >
          {isCollapsed ? '▲ EXPAND' : '▼ HIDE'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Robot Selector Tabs */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {robots.map((r) => {
              const isSel = r.id === selectedRobotId;
              return (
                <button
                  key={r.id}
                  onClick={() => onSelectRobot(r.id)}
                  className={`clay-btn clay-pill-sm ${isSel ? 'active' : ''}`}
                  style={{
                    flex: 1,
                    padding: '5px 4px',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono',
                    fontWeight: 700,
                    backgroundColor: isSel ? '#EDE7DC' : '#FAF8F5',
                    border: isSel ? `1.5px solid ${r.color}` : '1px solid rgba(255, 255, 255, 0.8)',
                    color: isSel ? r.color : '#736B5F',
                  }}
                >
                  {r.id}
                </button>
              );
            })}
          </div>

          {/* Telemetry Card */}
          <div className="clay-card-flat" style={{ padding: '10px 12px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#23201A' }}>
                  {selectedRobot.name}
                </div>
                <div style={{ fontSize: '10px', color: '#8E8578', marginTop: '1px' }}>
                  Coord: <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#23201A' }}>{coordToLabel(selectedRobot.x, selectedRobot.y)}</span> (x:{selectedRobot.x}, y:{selectedRobot.y})
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 800,
                    padding: '2px 6px',
                    borderRadius: '9999px',
                    backgroundColor: 'rgba(35, 32, 26, 0.06)',
                    color: getStatusColor(selectedRobot.status),
                    letterSpacing: '0.04em',
                  }}
                >
                  {selectedRobot.status}
                </span>
                <div style={{ fontSize: '10px', fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#23201A', marginTop: '4px' }}>
                  BATTERY {Math.round(selectedRobot.battery)}%
                </div>
              </div>
            </div>

            {/* Battery bar */}
            <div style={{ width: '100%', height: '5px', backgroundColor: '#E2DDD3', borderRadius: '9999px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${selectedRobot.battery}%`,
                  height: '100%',
                  backgroundColor: selectedRobot.battery > 50 ? '#10B981' : selectedRobot.battery > 20 ? '#F59E0B' : '#EF4444',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* 4-Way Q-Score Compass Pad */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#736B5F', letterSpacing: '0.04em', marginBottom: '6px' }}>
              4-WAY Q-SCORE COMPASS PAD
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridTemplateRows: 'repeat(3, 1fr)',
                gap: '6px',
                width: '180px',
                margin: '0 auto',
              }}
            >
              {/* Row 1: Empty, UP, Empty */}
              <div />
              <div
                className="clay-card-flat"
                style={{
                  padding: '6px 2px',
                  textAlign: 'center',
                  backgroundColor: maxQ > 0 && qScores.up === maxQ ? '#FFE7DF' : '#FAF8F5',
                  border: maxQ > 0 && qScores.up === maxQ ? '1.5px solid #FF5A26' : '1px solid rgba(255,255,255,0.7)',
                }}
              >
                <div style={{ fontSize: '8px', fontWeight: 700, color: '#8E8578' }}>↑ UP</div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: '10px', fontWeight: 800, color: maxQ > 0 && qScores.up === maxQ ? '#FF5A26' : '#23201A' }}>
                  {qScores.up}
                </div>
              </div>
              <div />

              {/* Row 2: LEFT, Center Disc, RIGHT */}
              <div
                className="clay-card-flat"
                style={{
                  padding: '6px 2px',
                  textAlign: 'center',
                  backgroundColor: maxQ > 0 && qScores.left === maxQ ? '#FFE7DF' : '#FAF8F5',
                  border: maxQ > 0 && qScores.left === maxQ ? '1.5px solid #FF5A26' : '1px solid rgba(255,255,255,0.7)',
                }}
              >
                <div style={{ fontSize: '8px', fontWeight: 700, color: '#8E8578' }}>← LEFT</div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: '10px', fontWeight: 800, color: maxQ > 0 && qScores.left === maxQ ? '#FF5A26' : '#23201A' }}>
                  {qScores.left}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  backgroundColor: '#EAE5DC',
                  boxShadow: 'inset 2px 2px 4px rgba(35, 32, 26, 0.1)',
                }}
              >
                <span style={{ fontSize: '9px', fontWeight: 800, color: selectedRobot.color, fontFamily: 'JetBrains Mono' }}>
                  {selectedRobot.id}
                </span>
              </div>

              <div
                className="clay-card-flat"
                style={{
                  padding: '6px 2px',
                  textAlign: 'center',
                  backgroundColor: maxQ > 0 && qScores.right === maxQ ? '#FFE7DF' : '#FAF8F5',
                  border: maxQ > 0 && qScores.right === maxQ ? '1.5px solid #FF5A26' : '1px solid rgba(255,255,255,0.7)',
                }}
              >
                <div style={{ fontSize: '8px', fontWeight: 700, color: '#8E8578' }}>RIGHT →</div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: '10px', fontWeight: 800, color: maxQ > 0 && qScores.right === maxQ ? '#FF5A26' : '#23201A' }}>
                  {qScores.right}
                </div>
              </div>

              {/* Row 3: Empty, DOWN, Empty */}
              <div />
              <div
                className="clay-card-flat"
                style={{
                  padding: '6px 2px',
                  textAlign: 'center',
                  backgroundColor: maxQ > 0 && qScores.down === maxQ ? '#FFE7DF' : '#FAF8F5',
                  border: maxQ > 0 && qScores.down === maxQ ? '1.5px solid #FF5A26' : '1px solid rgba(255,255,255,0.7)',
                }}
              >
                <div style={{ fontSize: '8px', fontWeight: 700, color: '#8E8578' }}>↓ DOWN</div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: '10px', fontWeight: 800, color: maxQ > 0 && qScores.down === maxQ ? '#FF5A26' : '#23201A' }}>
                  {qScores.down}
                </div>
              </div>
              <div />
            </div>
          </div>

          {/* Hyperparameter Sliders */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#736B5F', letterSpacing: '0.04em' }}>
              BELLMAN HYPERPARAMETERS
            </div>

            {/* Learning Rate (Alpha) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                <span style={{ color: '#8E8578', fontWeight: 600 }}>Learning Rate (α)</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#23201A' }}>
                  {hyperparameters.learningRate}
                </span>
              </div>
              <input
                type="range"
                min="0.01"
                max="1.0"
                step="0.01"
                value={hyperparameters.learningRate}
                onChange={(e) =>
                  onChangeHyperparameters({
                    ...hyperparameters,
                    learningRate: parseFloat(e.target.value),
                  })
                }
                className="clay-slider"
              />
            </div>

            {/* Discount Factor (Gamma) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                <span style={{ color: '#8E8578', fontWeight: 600 }}>Discount Factor (γ)</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#23201A' }}>
                  {hyperparameters.discountFactor}
                </span>
              </div>
              <input
                type="range"
                min="0.50"
                max="0.99"
                step="0.01"
                value={hyperparameters.discountFactor}
                onChange={(e) =>
                  onChangeHyperparameters({
                    ...hyperparameters,
                    discountFactor: parseFloat(e.target.value),
                  })
                }
                className="clay-slider"
              />
            </div>

            {/* Exploration Rate (Epsilon) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                <span style={{ color: '#8E8578', fontWeight: 600 }}>Exploration Rate (ε)</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#23201A' }}>
                  {hyperparameters.explorationRate}
                </span>
              </div>
              <input
                type="range"
                min="0.00"
                max="1.00"
                step="0.01"
                value={hyperparameters.explorationRate}
                onChange={(e) =>
                  onChangeHyperparameters({
                    ...hyperparameters,
                    explorationRate: parseFloat(e.target.value),
                  })
                }
                className="clay-slider"
              />
            </div>
          </div>

          {/* Model JSON Export / Import */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onExportModel}
              className="clay-btn clay-pill-sm"
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: '11px',
                color: '#23201A',
              }}
              title="Download learned Q-table weights & warehouse configuration as JSON"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export JSON
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="clay-btn clay-pill-sm"
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: '11px',
                color: '#23201A',
              }}
              title="Import learned model JSON weights"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              Import JSON
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              style={{ display: 'none' }}
            />
          </div>
        </>
      )}
    </div>
  );
};
