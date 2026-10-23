// Same defaults as backend Hyperparameters (backend/app/simulation/models.py).
export const DEFAULT_HYPERPARAMETERS = {
  learning_rate: 0.1, discount_factor: 0.95, exploration_rate: 0.3, epsilon_decay: false, epsilon_min: 0.05,
  step_reward: -1, goal_reward: 10, episodes_per_destination: 3000, max_steps: 200,
};
