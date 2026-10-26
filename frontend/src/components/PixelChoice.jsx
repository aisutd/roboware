import { PixelIcon } from './PixelIcon';

// A row of pixel radio buttons; the checked one lights up. Options: { id, label, tag?, icon?, disabled?, title? }.
export function PixelChoice({ name, options, value, onChange, legend }) {
  return (
    <div className="setup-choice" role="radiogroup" aria-label={legend}>
      {options.map((option) => (
        <label key={option.id} className={`setup-choice-item ${option.disabled ? 'is-disabled' : ''}`} title={option.title}>
          <input type="radio" name={name} value={option.id} checked={value === option.id} disabled={option.disabled} onChange={() => onChange(option.id)} />
          <span className="setup-choice-face">{option.icon && <PixelIcon name={option.icon} />}{option.tag && <b className="setup-choice-tag">{option.tag}</b>}{option.label}</span>
        </label>
      ))}
    </div>
  );
}
