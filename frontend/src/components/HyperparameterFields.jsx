const SLIDERS = [
  { key: 'learning_rate', label: 'Learning rate (α)', min: 0.01, max: 1, step: 0.01 },
  { key: 'discount_factor', label: 'Discount factor (γ)', min: 0.5, max: 0.99, step: 0.01 },
  { key: 'exploration_rate', label: 'Exploration rate (ε)', min: 0, max: 1, step: 0.01 },
];

export function HyperparameterFields({ value, onChange }) {
  const set = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {SLIDERS.map(({ key, label, min, max, step }) => (
        <label key={key} className="field">
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>{label}<span className="font-mono">{value[key]}</span></span>
          <input type="range" className="clay-slider" min={min} max={max} step={step} value={value[key]}
            onChange={(e) => set(key, Number(e.target.value))} />
        </label>
      ))}
      <div className="field-row">
        <label className="field">Episodes per destination
          <input className="clay-input" type="number" min="1" max="50000" value={value.episodes_per_destination}
            onChange={(e) => set('episodes_per_destination', Number(e.target.value))} />
        </label>
        <label className="field">Max steps per episode
          <input className="clay-input" type="number" min="1" max="5000" value={value.max_steps}
            onChange={(e) => set('max_steps', Number(e.target.value))} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={value.epsilon_decay} onChange={(e) => set('epsilon_decay', e.target.checked)} />
        Decay ε linearly to {value.epsilon_min} over training
      </label>
    </div>
  );
}
