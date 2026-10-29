// A small overview of the warehouse: shelves and stations, a dot per robot, and a box showing the part
// of the floor on screen while zoomed in. Clicking it moves the camera there.

const CELL_COLORS = { rack: '#6b5a3e', packing: '#8fb8ff', dock: '#7fd8a6', charger: '#f0c06a', unload: '#e8c547', shipping: '#5fd38f' };
const MAX_W = 120;
const MAX_H = 72;

export function MiniMap({ layout, robots, selectedRobotId, view, onJump, style }) {
  const { width, height, cells } = layout;
  const cell = Math.max(3, Math.min(10, Math.floor(MAX_W / width), Math.floor(MAX_H / height)));
  const jump = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * height);
    onJump(Math.max(0, Math.min(width - 1, x)), Math.max(0, Math.min(height - 1, y)));
  };
  return (
    <div className="hud-glass minimap" style={style}>
      <svg width={width * cell} height={height * cell} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges"
        onClick={jump} role="img" aria-label="Warehouse overview. Click to move the camera there.">
        <rect width={width} height={height} className="minimap-floor" />
        {cells.flatMap((row, y) => row.map((kind, x) => (kind === 'void'
          ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} className="minimap-void" />
          : CELL_COLORS[kind]
          ? <rect key={`${x},${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} fill={CELL_COLORS[kind]} opacity={kind === 'rack' ? 0.8 : 0.9} />
          : null)))}
        {view && (
          <rect className="minimap-view" x={view.x} y={view.y} width={view.w} height={view.h} />
        )}
        {robots.map((robot) => (
          <rect key={robot.id} className={robot.id === selectedRobotId ? 'minimap-robot selected' : 'minimap-robot'}
            x={robot.x + 0.15} y={robot.y + 0.15} width={0.7} height={0.7} fill={robot.color} />
        ))}
      </svg>
    </div>
  );
}
