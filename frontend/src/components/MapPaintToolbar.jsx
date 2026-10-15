const TOOLS = [
  { id: 'rack', label: 'Rack', color: '#DDD6C7' },
  { id: 'packing', label: 'Packing', color: '#2563EB' },
  { id: 'dock', label: 'Dock', color: '#10B981' },
  { id: 'charger', label: 'Charger', color: '#F59E0B' },
  { id: 'aisle', label: 'Erase', color: '#EFECE4' },
];

export function MapPaintToolbar({ activeBrush, onSelectBrush, onReset, disabled }) {
  return (
    <div className="clay-card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="view-subtitle" style={{ margin: 0 }}>Paint</span>
      {TOOLS.map((tool) => (
        <button key={tool.id} type="button" disabled={disabled}
          onClick={() => onSelectBrush(activeBrush === tool.id ? null : tool.id)}
          className={`clay-btn clay-pill-sm ${activeBrush === tool.id ? 'clay-btn-active' : ''}`}
          style={{ fontSize: 11, gap: 6, border: activeBrush === tool.id ? '1.5px solid #23201A' : undefined }}
          aria-pressed={activeBrush === tool.id}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: tool.color }} />
          {tool.label}
        </button>
      ))}
      <button type="button" className="clay-btn clay-pill-sm" style={{ fontSize: 11, color: '#8E8578' }} onClick={onReset} disabled={disabled}>
        Undo all changes
      </button>
    </div>
  );
}
