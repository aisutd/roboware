import { useState, useRef } from 'react';
import { COL_LETTERS, ROW_NUMBERS, coordToLabel, GRID_COLS, GRID_ROWS } from '../services/simulationEngine';

export const WarehouseMapCanvas = ({
  grid,
  robots,
  selectedRobotId,
  onSelectRobot,
  layers,
  activeBrush,
  onPaintCell,
  simEngine,
}) => {
  const [hoveredCell, setHoveredCell] = useState(null);
  const containerRef = useRef(null);

  // Cell dimensions in grid
  const cellWidth = 56;
  const cellHeight = 56;
  const gridPixelWidth = GRID_COLS * cellWidth;
  const gridPixelHeight = GRID_ROWS * cellHeight;

  const handleCellClick = (x, y) => {
    if (activeBrush) {
      onPaintCell(x, y, activeBrush);
    }
  };

  const getTileClass = (type) => {
    switch (type) {
      case 'rack':
        return 'tile-rack';
      case 'picking':
        return 'tile-picking';
      case 'packing':
        return 'tile-packing';
      case 'delivery':
        return 'tile-delivery';
      case 'charging':
        return 'tile-charging';
      case 'aisle':
      default:
        return 'tile-aisle';
    }
  };

  // Helper to get robot battery ring color
  const getBatteryColor = (level) => {
    if (level > 50) return '#10B981'; // sage green
    if (level > 20) return '#F59E0B'; // amber
    return '#EF4444'; // critical red
  };

  return (
    <div className="map-viewport" style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#F4F1EA',
      backgroundImage: 'radial-gradient(#E2DDD3 1px, transparent 1px)',
      backgroundSize: '28px 28px',
    }}>
      {/* Centered Miniature Architectural Grid Board */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          padding: '36px 36px 36px 36px',
          backgroundColor: 'rgba(246, 243, 237, 0.7)',
          borderRadius: '2rem',
          boxShadow: '16px 24px 50px rgba(35, 32, 26, 0.12), inset 3px 3px 6px rgba(255, 255, 255, 0.95), inset -3px -3px 8px rgba(185, 176, 162, 0.35)',
          border: '1.5px solid rgba(255, 255, 255, 0.85)',
          display: 'inline-block',
        }}
      >
        {/* Top Coordinate Header (A to P) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, ${cellWidth}px)`,
          gap: '6px',
          marginBottom: '8px',
          paddingLeft: '32px', // offset for row numbers
        }}>
          {COL_LETTERS.map((letter) => (
            <div key={letter} className="coord-label" style={{ textAlign: 'center', color: '#9E9587', fontWeight: 700 }}>
              {letter}
            </div>
          ))}
        </div>

        {/* Main Grid with Left Coordinate Markers */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* Left Row Numbers (1 to 10) */}
          <div style={{
            display: 'grid',
            gridTemplateRows: `repeat(${GRID_ROWS}, ${cellHeight}px)`,
            gap: '6px',
            width: '24px',
            alignItems: 'center',
          }}>
            {ROW_NUMBERS.map((num) => (
              <div key={num} className="coord-label" style={{ textAlign: 'right', color: '#9E9587', fontWeight: 700, paddingRight: '4px' }}>
                {num}
              </div>
            ))}
          </div>

          {/* 16x10 Interactive Tile Board */}
          <div style={{ position: 'relative' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${GRID_COLS}, ${cellWidth}px)`,
                gridTemplateRows: `repeat(${GRID_ROWS}, ${cellHeight}px)`,
                gap: '6px',
                position: 'relative',
              }}
            >
              {grid.map((row, y) =>
                row.map((cell, x) => {
                  const maxQ = simEngine ? simEngine.getMaxQForCell(x, y) : 0;
                  const bestAction = simEngine ? simEngine.getBestPolicyForCell(x, y) : null;
                  const normalizedQ = Math.min(1, maxQ / 80);

                  return (
                    <div
                      key={`${x}-${y}`}
                      className={`tile-base ${getTileClass(cell.type)}`}
                      onClick={() => handleCellClick(x, y)}
                      onMouseEnter={() => setHoveredCell({ x, y, type: cell.type, maxQ })}
                      onMouseLeave={() => setHoveredCell(null)}
                      style={{
                        width: `${cellWidth}px`,
                        height: `${cellHeight}px`,
                        cursor: activeBrush ? 'crosshair' : 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Tile Decorative Visuals */}
                      {cell.type === 'charging' && (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))' }}>
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#FFE27A" />
                        </svg>
                      )}

                      {cell.type === 'delivery' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#FFFFFF' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1v12zm0 0v7" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" fill="#10B981" />
                          </svg>
                          <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' }}>GOAL</span>
                        </div>
                      )}

                      {cell.type === 'picking' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#FFFFFF' }}>
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7"></rect>
                            <rect x="14" y="3" width="7" height="7"></rect>
                            <rect x="14" y="14" width="7" height="7"></rect>
                            <rect x="3" y="14" width="7" height="7"></rect>
                          </svg>
                          <span style={{ fontSize: '8px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>PICK</span>
                        </div>
                      )}

                      {cell.type === 'packing' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#FFFFFF' }}>
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                            <line x1="12" y1="22.08" x2="12" y2="12"></line>
                          </svg>
                          <span style={{ fontSize: '8px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>PACK</span>
                        </div>
                      )}

                      {cell.type === 'rack' && (
                        <div style={{
                          width: '80%',
                          height: '80%',
                          borderRadius: '4px',
                          border: '1.5px dashed rgba(160, 150, 135, 0.45)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <div style={{
                            width: '4px',
                            height: '4px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(120, 110, 95, 0.4)',
                          }} />
                        </div>
                      )}

                      {/* Q-Value Heatmap Layer */}
                      {layers.qHeatmap && cell.type !== 'rack' && normalizedQ > 0.05 && (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundColor: `rgba(235, 87, 87, ${normalizedQ * 0.45})`,
                            pointerEvents: 'none',
                            borderRadius: 'inherit',
                            mixBlendMode: 'multiply',
                          }}
                        />
                      )}

                      {/* Directional Policy Arrows Overlay */}
                      {layers.qHeatmap && bestAction && cell.type !== 'rack' && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '2px',
                            right: '3px',
                            fontSize: '11px',
                            fontWeight: 800,
                            color: 'rgba(35, 32, 26, 0.75)',
                            pointerEvents: 'none',
                            fontFamily: 'JetBrains Mono',
                          }}
                        >
                          {bestAction.arrow}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* SVG Cartographic Overlay for Trajectories & Yield Rings */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${gridPixelWidth + (GRID_COLS - 1) * 6}px`,
                height: `${gridPixelHeight + (GRID_ROWS - 1) * 6}px`,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              <defs>
                <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Trajectory Paths */}
              {layers.paths &&
                robots.map((robot) => {
                  if (!robot.path || robot.path.length === 0) return null;
                  const startCenterX = robot.x * (cellWidth + 6) + cellWidth / 2;
                  const startCenterY = robot.y * (cellHeight + 6) + cellHeight / 2;

                  let pathString = `M ${startCenterX} ${startCenterY}`;
                  robot.path.forEach((pt) => {
                    const cx = pt.x * (cellWidth + 6) + cellWidth / 2;
                    const cy = pt.y * (cellHeight + 6) + cellHeight / 2;
                    pathString += ` L ${cx} ${cy}`;
                  });

                  return (
                    <g key={`path-${robot.id}`}>
                      {/* Underline halo */}
                      <path
                        d={pathString}
                        fill="none"
                        stroke={robot.color}
                        strokeWidth="5"
                        strokeOpacity="0.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Animated dashed cartographic trajectory */}
                      <path
                        d={pathString}
                        fill="none"
                        stroke={robot.color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="trajectory-path"
                      />
                      {/* Destination dot marker */}
                      {robot.targetX !== null && (
                        <circle
                          cx={robot.targetX * (cellWidth + 6) + cellWidth / 2}
                          cy={robot.targetY * (cellHeight + 6) + cellHeight / 2}
                          r="4"
                          fill={robot.color}
                          stroke="#FAF8F5"
                          strokeWidth="2"
                        />
                      )}
                    </g>
                  );
                })}
            </svg>

            {/* 3D Tactile Robot Pucks (R1–R4) */}
            {robots.map((robot) => {
              const puckLeft = robot.x * (cellWidth + 6) + 4;
              const puckTop = robot.y * (cellHeight + 6) + 4;
              const isSelected = selectedRobotId === robot.id;
              const circumference = 2 * Math.PI * 18;
              const batteryDash = (robot.battery / 100) * circumference;

              return (
                <div
                  key={robot.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRobot(robot.id);
                  }}
                  className={`robot-puck ${isSelected ? 'selected' : ''}`}
                  style={{
                    left: `${puckLeft}px`,
                    top: `${puckTop}px`,
                    width: `${cellWidth - 8}px`,
                    height: `${cellHeight - 8}px`,
                    zIndex: 20,
                  }}
                >
                  {/* Pulsing Amber Yield Ring if Yielding */}
                  {layers.yieldHalos && robot.isYielding && (
                    <div className="yield-ring" />
                  )}

                  {/* Circular SVG Battery Progress Ring */}
                  <svg
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      transform: 'rotate(-90deg)',
                    }}
                    viewBox="0 0 48 48"
                  >
                    {/* Background Ring */}
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke="rgba(185, 176, 162, 0.2)"
                      strokeWidth="3"
                    />
                    {/* Active Battery Ring */}
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke={getBatteryColor(robot.battery)}
                      strokeWidth="3.2"
                      strokeDasharray={2 * Math.PI * 20}
                      strokeDashoffset={2 * Math.PI * 20 * (1 - robot.battery / 100)}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
                    />
                  </svg>

                  {/* Ceramic Robot Disc Body */}
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#FAF8F5',
                      boxShadow: 'inset 2px 2px 4px rgba(255, 255, 255, 0.95), inset -2px -2px 3px rgba(185, 176, 162, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {/* Directional Triangle Nose */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: `rotate(${robot.heading}deg)`,
                        transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                        pointerEvents: 'none',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          right: '-3px',
                          width: 0,
                          height: 0,
                          borderTop: '5px solid transparent',
                          borderBottom: '5px solid transparent',
                          borderLeft: `7px solid ${robot.color}`,
                          filter: 'drop-shadow(1px 0 1px rgba(0,0,0,0.15))',
                        }}
                      />
                    </div>

                    {/* Robot ID Label */}
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono',
                        fontSize: '11px',
                        fontWeight: 800,
                        color: robot.color,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {robot.id}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Floating Cell Hover Tooltip */}
        {hoveredCell && (
          <div
            className="clay-card-flat"
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '42px',
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 30,
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#8E8578', fontWeight: 600 }}>COORD:</span>
              <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#23201A' }}>
                {coordToLabel(hoveredCell.x, hoveredCell.y)}
              </span>
            </div>
            <div style={{ width: '1px', height: '14px', backgroundColor: '#DDD6C7' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#8E8578', fontWeight: 600 }}>TYPE:</span>
              <span style={{ fontWeight: 700, textTransform: 'capitalize', color: '#23201A' }}>
                {hoveredCell.type}
              </span>
            </div>
            <div style={{ width: '1px', height: '14px', backgroundColor: '#DDD6C7' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#8E8578', fontWeight: 600 }}>MAX Q:</span>
              <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#FF5A26' }}>
                {hoveredCell.maxQ.toFixed(1)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
