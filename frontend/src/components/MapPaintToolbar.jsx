import { BatteryCharging, Grid2X2, Package, Rows3, Truck } from 'lucide-react';

const TOOLS = [
  { id: 'rack', label: 'Storage racks', Icon: Rows3, hint: 'Blocked storage infrastructure. Drag to create continuous rack rows.' },
  { id: 'aisle', label: 'Walkable aisles', Icon: Grid2X2, hint: 'Clear equipment and restore a walkable floor cell.' },
  { id: 'packing', label: 'Packing stations', Icon: Package, hint: 'Equipment where picked orders are packed.' },
  { id: 'charger', label: 'Charging stations', Icon: BatteryCharging, hint: 'Robot charging equipment. Keep routes to destinations open.' },
  { id: 'dock', label: 'Shipping docks', Icon: Truck, hint: 'Delivery destinations for completed packages.' },
];

export function MapPaintToolbar({ activeBrush, onSelectBrush, onReset, disabled, resetLabel = 'Reset to saved' }) {
  const selected = TOOLS.find((tool) => tool.id === activeBrush);
  return (
    <div className="blueprint-tools">
      <div className="blueprint-tool-list" role="group" aria-label="Warehouse equipment brushes">
        {TOOLS.map(({ id, label, Icon, hint }) => (
          <button key={id} type="button" disabled={disabled} title={hint}
            onClick={() => onSelectBrush(activeBrush === id ? null : id)}
            className={`clay-btn clay-pill-sm ${activeBrush === id ? 'clay-btn-active' : ''}`} aria-pressed={activeBrush === id}>
            <Icon size={15} aria-hidden="true" />{label}
          </button>
        ))}
        <button type="button" className="clay-btn clay-pill-sm" onClick={onReset} disabled={disabled}>{resetLabel}</button>
      </div>
      <p className="brush-instruction"><strong>{selected ? `Selected: ${selected.label}` : 'Inspect / navigate'}</strong><span>{selected ? `${selected.hint} Click the selected tool again to return to navigation.` : 'Select equipment to paint. With no brush selected, use Pan to navigate the floor.'}</span></p>
    </div>
  );
}
