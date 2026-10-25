// UI terminology only. API routing identifiers remain unchanged.
export const NAVIGATION_MODES = [
  { id: 'astar', label: 'Shortest-path navigation', technical: 'A*', description: 'Plans a shortest route around storage racks. Start here: no AI model or training is needed.' },
  { id: 'q_only', label: 'AI-trained navigation', technical: 'Q-learning', description: 'Uses routes learned through practice in this warehouse. Train a model first to use learned navigation; shortest-path routing is the fallback when a learned route is unavailable.' },
  { id: 'hybrid', label: 'Combined navigation', technical: 'Hybrid A* + Q-learning', description: 'Combines shortest-path planning with an AI-trained policy. Train a model first to add learned navigation; without it, the simulation uses shortest-path routing.' },
];

export const NAVIGATION_LABELS = Object.fromEntries(NAVIGATION_MODES.map((mode) => [mode.id, mode.label]));

export function trainingGuidance(mode, model) {
  if (mode === 'astar') return { needsTraining: false, message: 'No training required. You can create a simulation now using shortest-path navigation.' };
  if (!model) return { needsTraining: true, message: 'Choose and train a model to use learned navigation. With no model selected, this simulation uses shortest-path navigation instead.' };
  if (!model.trained_destinations) return { needsTraining: true, message: 'This model has not learned any destinations yet. Train it to use AI; otherwise this simulation falls back to shortest-path navigation.' };
  return { needsTraining: false, message: `This model has ${model.trained_destinations} trained destinations. Missing or incompatible learned routes may still use shortest-path navigation. The backend checks compatibility when the simulation is created.` };
}
