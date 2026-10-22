import React from 'react';

/**
 * MapPaintToolbar
 * ---------------
 * The "CANVAS TOOLS" pill that floats in the BOTTOM-LEFT corner of the screen.
 * It lets the user pick a "paint brush" (Rack, Pick, Pack, Goal, Charge, Erase)
 * and then click tiles on the warehouse map to change what each tile is.
 *
 * This component does NOT paint anything itself. It only remembers which brush
 * is selected (via the parent). The actual painting happens like this:
 *   1. User clicks a brush here -> onSelectBrush('rack') -> App sets activeBrush.
 *   2. App passes activeBrush down to WarehouseMapCanvas.
 *   3. User clicks a tile -> WarehouseMapCanvas calls onPaintCell(x, y, brush)
 *      -> App calls engine.paintCell(...) and re-syncs React state.
 *
 * Props (all passed from App.jsx):
 * - activeBrush          : id of the selected brush ('rack', 'picking', ...) or null when none is selected.
 * - onSelectBrush        : setter from App (setActiveBrush). Called with a brush id, or null to deselect.
 * - onResetDefaultLayout : App's handleResetDefaultLayout; restores the original floor plan via engine.resetWorld().
 */
export const MapPaintToolbar = ({
  activeBrush,
  onSelectBrush,
  onResetDefaultLayout,
}) => {
  // The list of brushes shown as buttons. Each `id` is the tile type string the
  // engine understands in paintCell(). `color` matches the tile color on the map
  // so the swatch previews what you'll paint. Note "Erase" is really the 'aisle'
  // brush: painting an aisle removes any rack/charger/pick/pack on that tile.
  // (The single Goal tile can't be erased, only moved by painting Goal elsewhere.)
  const tools = [
    { id: 'rack', label: 'Rack', color: '#DDD6C7', textColor: '#4A4338', icon: '■' },
    { id: 'picking', label: 'Pick', color: '#FF5A26', textColor: '#FFFFFF', icon: '◫' },
    { id: 'packing', label: 'Pack', color: '#2563EB', textColor: '#FFFFFF', icon: '▲' },
    { id: 'delivery', label: 'Goal', color: '#10B981', textColor: '#FFFFFF', icon: '★' },
    { id: 'charging', label: 'Charge', color: '#F59E0B', textColor: '#FFFFFF', icon: '⚡' },
    { id: 'aisle', label: 'Erase', color: '#EFECE4', textColor: '#736B5F', icon: '⌫' },
  ];

  // Outer card: absolutely positioned 20px from the bottom-left of the viewport,
  // laid out as one horizontal row of controls.
  return (
    <div
      className="clay-card"
      style={{
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        zIndex: 50,
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {/* Title: paintbrush icon + "CANVAS TOOLS" label (purely decorative) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8E8578" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
          <path d="M2 2l7.586 7.586"></path>
          <circle cx="11" cy="11" r="2"></circle>
        </svg>
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#736B5F', letterSpacing: '0.04em' }}>
          CANVAS TOOLS
        </span>
      </div>

      <div style={{ width: '1px', height: '22px', backgroundColor: '#E2DDD3' }} />

      {/* One button per brush. Clicking the already-active brush toggles it off
          (sends null), which returns the map to normal "click to inspect" mode. */}
      {tools.map((tool) => {
        // Is this the brush currently selected in App? Drives the highlighted style.
        const isActive = activeBrush === tool.id;
        return (
          <button
            key={tool.id}
            onClick={() => onSelectBrush(isActive ? null : tool.id)}
            className={`clay-btn clay-pill-sm ${isActive ? 'clay-btn-active' : ''}`}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              gap: '6px',
              backgroundColor: isActive ? '#E5DFD4' : '#FAF8F5',
              border: isActive ? '1.5px solid #23201A' : '1px solid rgba(255, 255, 255, 0.8)',
            }}
            title={`Select ${tool.label} paint brush (Click grid to apply)`}
          >
            {/* Small colored swatch with the brush's icon, followed by its text label */}
            <span
              style={{
                width: '13px',
                height: '13px',
                borderRadius: '3px',
                backgroundColor: tool.color,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                color: tool.textColor,
                fontWeight: 800,
                boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.6)',
              }}
            >
              {tool.icon}
            </span>
            <span>{tool.label}</span>
          </button>
        );
      })}

      <div style={{ width: '1px', height: '22px', backgroundColor: '#E2DDD3' }} />

      {/* Reset Layout Button: throws away all painted edits and restores the
          default warehouse layout (also resets the robot fleet and KPIs). */}
      <button
        onClick={onResetDefaultLayout}
        className="clay-btn clay-pill-sm"
        style={{
          padding: '4px 9px',
          fontSize: '11px',
          color: '#8E8578',
        }}
        title="Restore Canonical Warehouse Floor Plan"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10"></polyline>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
        </svg>
        Reset Grid
      </button>
    </div>
  );
};
