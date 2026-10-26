import { PixelIcon } from './PixelIcon';

// Where a warehouse's own model stands. A warehouse can only run once its model is trained on its
// current floor; editing the floor makes the model out of date.
const STATES = {
  ready: { label: 'Trained', hint: 'This warehouse has a trained model and is ready to run.' },
  outdated: { label: 'Out of date', hint: 'The floor changed since its model was trained. Retrain it to run.' },
  training: { label: 'Training…', hint: 'Practising every spot in this warehouse.' },
  untrained: { label: 'Needs training', hint: 'Train this warehouse’s model before running a simulation.' },
};

export function ModelBadge({ status = 'untrained', compact = false }) {
  const state = STATES[status] ?? STATES.untrained;
  return (
    <span className={`model-badge model-${status}`} title={state.hint}>
      <PixelIcon name="brain" />{!compact && state.label}
    </span>
  );
}
