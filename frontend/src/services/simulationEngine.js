/**
 * RoboWare Simulation & Reinforcement Learning Engine (Module 1)
 *
 * Implements the exact mathematical contract and reinforcement learning logic from
 * `base_reference_model.ipynb` scaled to a 16 x 10 grid (160 states, 4 actions).
 *
 * Features:
 * 1. 2D Q-Learning Engine (takeAction, learn, chooseAction, fastTrain)
 * 2. 2D Manhattan A* Pathfinding around warehouse storage racks
 * 3. Multi-Robot Fleet Management & Collision Avoidance (yield halos, priority resolution)
 * 4. Dynamic Battery Drain & Charging Traffic Routing
 * 5. Model JSON I/O (exact notebook schema export/import)
 * 6. High-level SimulationEngine class for UI orchestration and reactive subscriptions
 *
 * ---------------------------------------------------------------------------
 * HOW TO READ THIS FILE (a short guide for new readers)
 * ---------------------------------------------------------------------------
 * This is the "brain" of the RoboWare front end. It has no React code in it:
 * it is plain JavaScript that the React components import and call. The UI
 * only draws whatever this module tells it (robot positions, Q-values, KPIs).
 *
 * The warehouse is a grid of 16 columns (x = 0..15, labelled A..P) by 10 rows
 * (y = 0..9, labelled 1..10). y grows DOWNWARDS, like screen coordinates, so
 * "up" means y - 1. Some cells are storage racks (walls the robots can't
 * enter); the rest are aisles. There is one delivery goal cell, two charging
 * docks on the left wall, picking zones (where items are collected) and
 * packing stations.
 *
 * Two different "movement brains" live here, and it helps to keep them apart:
 *   - Q-learning (sections 1 and 4): a single learning agent that discovers,
 *     by trial and error, which direction to move from every cell to reach the
 *     goal. Its knowledge is the Q-table, which the UI shows as a heatmap and
 *     arrows. It mirrors the course notebook `base_reference_model.ipynb`.
 *   - A* pathfinding (section 2): a classic shortest-path search. The live
 *     fleet of 4 robots (section 3) actually drives with A* so the animation
 *     is always sensible, even before the Q-table has been trained.
 *
 * Sections, in order:
 *   CONSTANTS            grid size, action list, rewards, default layout
 *   STATE UTILITIES      converting between (x, y) and a single state number
 *   1. Q-LEARNING        takeAction (environment), learn (Bellman update),
 *                        chooseAction (epsilon-greedy), fastTrain (loop)
 *   2. A* PATHFINDING    findPathAStar
 *   3. FLEET SIMULATION  createRobotFleet, charging dock choice, collision
 *                        priority, and stepSimulationTick (one clock tick)
 *   4. MODEL JSON I/O    save / load the Q-table in the notebook's format
 *   5. ENGINE CLASS      SimulationEngine: holds all state, wraps the pure
 *                        functions above, and notifies React subscribers
 *
 * Most functions in sections 1-4 are "pure-ish": they take everything they
 * need as arguments (with defaults), which makes them easy to test on their
 * own. The class in section 5 is the only place that keeps long-lived state.
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================
// Everything here is exported so the UI and tests share one source of truth.
// GRID_COLS / GRID_ROWS are just friendlier aliases for width / height.

export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 10;
export const GRID_COLS = GRID_WIDTH;
export const GRID_ROWS = GRID_HEIGHT;
export const TOTAL_STATES = GRID_WIDTH * GRID_HEIGHT; // 160 states

export const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
export const ROW_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Turns a grid coordinate into a human-friendly, spreadsheet-style label
 * such as "O9" (column letter + 1-based row number), used in the UI and logs.
 *
 * Accepts three call styles so callers don't have to convert first:
 *   coordToLabel(14, 8), coordToLabel([14, 8]) or coordToLabel({ x: 14, y: 8 }).
 * If x is outside A..P it falls back to "C<x>" instead of crashing; if y is
 * missing, only the column letter is returned.
 */
export function coordToLabel(x, y) {
  if (Array.isArray(x)) {
    y = x[1];
    x = x[0];
  } else if (x && typeof x === 'object') {
    y = x.y;
    x = x.x;
  }
  const col = COL_LETTERS[x] || `C${x}`;
  const row = (y !== undefined && y !== null) ? (y + 1) : '';
  return `${col}${row}`;
}

// 4 discrete actions matching the reference notebook contract
export const ACTIONS = ['up', 'down', 'left', 'right'];
export const ACTION_NAMES = ACTIONS;

// Lets functions accept an action either by name ('up') or by index (0).
// Looking either one up returns the numeric index used for the Q-table column.
export const ACTION_MAP = {
  up: 0,
  down: 1,
  left: 2,
  right: 3,
  0: 0,
  1: 1,
  2: 2,
  3: 3,
};

// How each action changes the position. The array order MUST match ACTIONS
// (up, down, left, right) because the action index is used to look it up.
// Remember y grows downwards, so "up" is dy = -1.
export const ACTION_DELTAS = [
  { dx: 0, dy: -1 }, // 0: up
  { dx: 0, dy: 1 },  // 1: down
  { dx: -1, dy: 0 }, // 2: left
  { dx: 1, dy: 0 },  // 3: right
];

// Hyperparameters matching base_reference_model.ipynb contract
//  - learningRate (alpha): how far each update moves the old Q-value toward
//    the new estimate. 0.1 = cautious, smooth learning.
//  - discountFactor (gamma): how much future rewards count compared with an
//    immediate one. 0.95 means the agent is far-sighted.
//  - explorationRate (epsilon): chance of trying a random move instead of the
//    best-known one, so the agent keeps discovering new routes.
//  - stepReward: -1 on every move that isn't the goal. This small "cost of
//    time" is what pushes the agent to find SHORT paths, not just any path.
//  - goalReward: +10 for arriving at the delivery goal.
export const DEFAULT_HYPERPARAMS = {
  learningRate: 0.1,     // alpha
  discountFactor: 0.95,  // gamma
  explorationRate: 0.3,  // epsilon
  stepReward: -1,        // reward per non-goal step or obstacle hit
  goalReward: 10,        // reward for reaching delivery goal
};

// Default warehouse coordinates
// All coordinates in this file are [x, y] arrays with 0-based indices,
// e.g. [14, 8] is column O, row 9 in the on-screen labels.
// DEFAULT_GOAL is the delivery/shipping cell that the Q-learner tries to reach
// and that robots carry finished orders to.
export const DEFAULT_GOAL = [14, 8];

// Charging docks sit on the left wall (x = 0), far from the goal on the right,
// so low-battery robots create real cross-warehouse traffic to manage.

export const DEFAULT_CHARGING_DOCKS = [
  [0, 2],
  [0, 7],
];

// Picking zones: where robots collect the item for an order. fastTrain also
// uses them as common starting points for training episodes.
export const DEFAULT_PICKING_ZONES = [
  [2, 1],
  [2, 8],
  [13, 1],
];

// Packing stations: where an order is boxed before delivery. They are stored
// on each order and drawn on the grid (see SimulationEngine.orders below).
export const DEFAULT_PACKING_STATIONS = [
  [14, 2],
  [14, 5],
];

// Default storage rack bays (Raised Sandstone racks)
// Arranged with aisles at x=0..3, 6, 9, 12..15 and cross-aisles at y=0, 4, 8, 9
// Each bay is two columns wide and split into an upper block (y = 1..3) and a
// lower block (y = 5..7), leaving row 4 as a middle cross-aisle. That gives
// robots several alternative routes, which matters for collision avoidance.
export const DEFAULT_RACKS = [
  // Bay 1: x = 4, 5
  [4, 1], [4, 2], [4, 3],
  [5, 1], [5, 2], [5, 3],
  [4, 5], [4, 6], [4, 7],
  [5, 5], [5, 6], [5, 7],

  // Bay 2: x = 7, 8
  [7, 1], [7, 2], [7, 3],
  [8, 1], [8, 2], [8, 3],
  [7, 5], [7, 6], [7, 7],
  [8, 5], [8, 6], [8, 7],

  // Bay 3: x = 10, 11
  [10, 1], [10, 2], [10, 3],
  [11, 1], [11, 2], [11, 3],
  [10, 5], [10, 6], [10, 7],
  [11, 5], [11, 6], [11, 7],
];

// ============================================================================
// STATE & COORDINATE UTILITIES
// ============================================================================

/**
 * Maps a 2D coordinate [x, y] or {x, y} to a 1D state index (0..159).
 * Formula: stateIndex = y * width + x
 *
 * Why: the Q-table is a plain list of rows, one row per state, so every cell
 * needs a single number. Reading the grid row by row (like reading a page),
 * each full row before y contributes `width` cells, then x counts along the
 * current row. Example: [14, 8] -> 8 * 16 + 14 = 142.
 * If `pos` is already a number it is assumed to be a state index and is
 * returned as-is; anything unrecognised safely maps to state 0.
 */
export function posToState(pos, width = GRID_WIDTH) {
  if (typeof pos === 'number') return pos;
  if (Array.isArray(pos)) return pos[1] * width + pos[0];
  if (pos && typeof pos === 'object') return pos.y * width + pos.x;
  return 0;
}

/**
 * Maps a 1D state index (0..159) to a 2D coordinate [x, y].
 * This is the exact inverse of posToState: the remainder after dividing by
 * the width is the column (x), and the whole number of full rows is y.
 * Example: 142 -> [142 % 16, floor(142 / 16)] = [14, 8].
 */
export function stateToPos(stateIndex, width = GRID_WIDTH) {
  return [stateIndex % width, Math.floor(stateIndex / width)];
}

/**
 * Checks if a coordinate matches any rack in the racks collection.
 *
 * Racks can arrive in several shapes depending on who calls this, so it is
 * deliberately forgiving: a Set of "x,y" strings (fast O(1) lookup), or an
 * array whose items are [x, y] pairs, {x, y} objects or "x,y" strings.
 * Returns true if (x, y) is a rack, false otherwise (including no racks).
 */
export function isRack(x, y, racks = DEFAULT_RACKS) {
  if (!racks) return false;
  if (racks instanceof Set) {
    return racks.has(`${x},${y}`);
  }
  if (Array.isArray(racks)) {
    for (let i = 0; i < racks.length; i++) {
      const r = racks[i];
      if (Array.isArray(r) && r[0] === x && r[1] === y) return true;
      if (r && typeof r === 'object' && r.x === x && r.y === y) return true;
      if (typeof r === 'string' && r === `${x},${y}`) return true;
    }
  }
  return false;
}

/**
 * Creates an empty Q-table (160 states x 4 actions) initialized to 0.0.
 *
 * The Q-table is the agent's "memory": qTable[state][action] is its current
 * estimate of the total future reward for taking `action` in `state`.
 * Starting at 0 means "no opinion yet" about any move. Each row gets its own
 * new array (rather than sharing one) so updating one state never changes
 * another by accident.
 */
export function createQTable(numStates = TOTAL_STATES, numActions = 4, initialValue = 0.0) {
  const table = new Array(numStates);
  for (let s = 0; s < numStates; s++) {
    table[s] = new Array(numActions).fill(initialValue);
  }
  return table;
}

/**
 * Clones a Q-table deeply.
 * Copies every row, so the clone can be trained without changing the
 * original (used when the engine is constructed from a supplied table).
 */
export function cloneQTable(qTable) {
  return qTable.map(row => [...row]);
}

// ============================================================================
// 1. 2D Q-LEARNING CORE ENGINE
// ============================================================================
// Q-learning in one paragraph: the agent stands in a cell (the "state"),
// picks one of 4 moves (the "action"), and the environment answers with the
// new cell and a reward. After every move the agent nudges its stored score
// for that (state, action) pair toward "reward now + best score from where I
// landed". Repeat over many episodes and good moves near the goal get high
// scores, which then leak backwards to cells further away, until following
// the highest score from any cell leads to the goal.
//
// The three building blocks below map directly to that loop:
//   takeAction   = the environment (rules of the world)
//   chooseAction = the agent deciding what to try
//   learn        = the agent updating its memory (the Q-table)
// fastTrain just runs them together many times.

/**
 * Computes next position, reward, and finished status given an action.
 * Contract from base_reference_model.ipynb:
 * - If moving into bounds and not hitting storage racks, updates position.
 * - If hitting rack or border, position stays unchanged and receives step reward (-1).
 * - If new position equals goal: reward = 10, finished = true.
 * - Else: reward = -1, finished = false.
 *
 * This function is the "environment": it only applies the rules of the world
 * and never changes the Q-table. It is pure, so the same inputs always give
 * the same answer.
 *
 * Why a bump keeps the robot in place: a real robot can't drive through a
 * rack or off the floor, so the move simply fails. It still costs -1 like any
 * other step, which teaches the agent that walking into walls wastes time
 * without needing a separate "crash" penalty. The episode is NOT ended on a
 * bump, so the agent gets to try again from the same cell.
 *
 * @param {Array|Object} pos - Current position [x, y]
 * @param {number|string} action - Action index (0..3) or action name ('up', 'down', etc.)
 * @param {Array|Set} racks - Storage rack obstacles
 * @param {Array} goal - Target delivery goal [gx, gy]
 * @param {number} width - Grid width (default 16)
 * @param {number} height - Grid height (default 10)
 * @param {number} stepReward - Reward per non-goal move (-1)
 * @param {number} goalReward - Reward for reaching goal (10)
 * @returns {{ nextPos: [number, number], reward: number, finished: boolean }}
 */
export function takeAction(
  pos,
  action,
  racks = DEFAULT_RACKS,
  goal = DEFAULT_GOAL,
  width = GRID_WIDTH,
  height = GRID_HEIGHT,
  stepReward = DEFAULT_HYPERPARAMS.stepReward,
  goalReward = DEFAULT_HYPERPARAMS.goalReward
) {
  const currentPos = Array.isArray(pos) ? pos : [pos.x, pos.y];
  const currentX = currentPos[0];
  const currentY = currentPos[1];

  // Accept 'up' or 0 alike. An unknown action becomes a "stay still" move
  // (dx = dy = 0) instead of throwing, so a bad input can't crash the UI.
  const actionIdx = typeof action === 'string' ? ACTION_MAP[action] : action;
  const delta = ACTION_DELTAS[actionIdx] || { dx: 0, dy: 0 };

  const newX = currentX + delta.dx;
  const newY = currentY + delta.dy;

  // Boundary check
  const inBounds = newX >= 0 && newX < width && newY >= 0 && newY < height;
  // Storage rack obstacle check (only worth doing if the cell is on the grid)
  const hitObstacle = inBounds && isRack(newX, newY, racks);

  if (!inBounds || hitObstacle) {
    // Position unchanged, receives step reward (-1), finished = false
    return {
      nextPos: [currentX, currentY],
      reward: stepReward,
      finished: false,
    };
  }

  // Legal move: the robot really moves. Reaching the goal is the only way an
  // episode ends with a positive reward.
  const nextPos = [newX, newY];
  const isGoal = nextPos[0] === goal[0] && nextPos[1] === goal[1];

  return {
    nextPos,
    reward: isGoal ? goalReward : stepReward,
    finished: isGoal,
  };
}

/**
 * Exact Bellman update matching base_reference_model.ipynb:
 * target = finished ? reward : reward + gamma * max(qTable[nextState]);
 * oldScore = qTable[currentState][action];
 * qTable[currentState][action] = oldScore + alpha * (target - oldScore);
 *
 * In plain English:
 * - `target` is a fresh guess at how good this move was: the reward we just
 *   got, plus (discounted by gamma) the best score we believe is available
 *   from the cell we landed in. That second part is how the goal's +10
 *   gradually spreads backwards through the grid, one cell per update.
 * - If the move reached the goal (`finished`), there is no future after it,
 *   so the target is just the reward. Adding future value here would make
 *   the goal look better than it really is.
 * - `target - oldScore` is the "surprise" (temporal-difference error). We
 *   move only a fraction alpha of the way toward the target, so one lucky or
 *   unlucky step can't overwrite everything learned before.
 * The table is changed in place (mutated), which is why the UI heatmap
 * updates as training runs.
 *
 * @param {Array|number} currentPos - Current position [x, y] or state index
 * @param {number|string} action - Action taken
 * @param {Array|number} nextPos - Next position [x, y] or next state index
 * @param {number} reward - Immediate reward received
 * @param {boolean} finished - Whether the episode terminated at goal
 * @param {Array<Array<number>>} qTable - In-place Q-table (160 x 4)
 * @param {number} alpha - Learning rate (default 0.1)
 * @param {number} gamma - Discount factor (default 0.95)
 * @returns {number} Updated Q-score
 */
export function learn(
  currentPos,
  action,
  nextPos,
  reward,
  finished,
  qTable,
  alpha = DEFAULT_HYPERPARAMS.learningRate,
  gamma = DEFAULT_HYPERPARAMS.discountFactor
) {
  const currentIdx = posToState(currentPos);
  const nextIdx = posToState(nextPos);
  const actionIdx = typeof action === 'string' ? ACTION_MAP[action] : action;

  // max over the 4 actions in the next state: we assume the agent will act
  // greedily from there on. Using the best next action (not the one actually
  // taken later) is what makes this Q-learning rather than SARSA.
  const nextScores = qTable[nextIdx];
  const bestFutureScore = Math.max(...nextScores);

  const target = finished ? reward : reward + gamma * bestFutureScore;
  const oldScore = qTable[currentIdx][actionIdx];
  const newScore = oldScore + alpha * (target - oldScore);

  qTable[currentIdx][actionIdx] = newScore;
  return newScore;
}

/**
 * Epsilon-greedy action selection with random tie-breaking.
 * With probability explorationRate: pick uniform random action from [0, 1, 2, 3].
 * Otherwise: argmax over qTable[stateIndex] with random tie-breaking.
 *
 * Why explore at all: if the agent always picked its current best move it
 * would get stuck repeating the first route it stumbled on and never find a
 * shorter one. A 30% chance of a random move keeps it discovering.
 *
 * Why random tie-breaking: at the start every score is 0, so all 4 actions
 * tie. A plain "pick the first maximum" would always return 0 ('up'), and the
 * agent would just ram the top wall over and over. Choosing randomly among
 * the tied best actions removes that bias and spreads exploration evenly.
 *
 * Note: the random branch can return any of the 4 actions, including one that
 * hits a rack; takeAction handles that by keeping the agent in place.
 *
 * @param {Array|number} pos - Position or state index
 * @param {Array<Array<number>>} qTable - Q-table
 * @param {number} explorationRate - Epsilon (default 0.3)
 * @returns {number} Action index (0..3)
 */
export function chooseAction(
  pos,
  qTable,
  explorationRate = DEFAULT_HYPERPARAMS.explorationRate
) {
  // Explore: with probability epsilon, ignore the Q-table entirely.
  if (Math.random() < explorationRate) {
    return Math.floor(Math.random() * 4);
  }

  // Exploit: find the highest score for this cell.
  const stateIdx = posToState(pos);
  const scores = qTable[stateIdx];

  let maxScore = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > maxScore) {
      maxScore = scores[i];
    }
  }

  // Collect all actions sharing the maximum score for tie-breaking.
  // A tiny tolerance (1e-9) is used instead of === because floating-point
  // updates can leave values that are equal in theory but differ in the last
  // decimal places.
  const bestActions = [];
  for (let i = 0; i < scores.length; i++) {
    if (Math.abs(scores[i] - maxScore) < 1e-9) {
      bestActions.push(i);
    }
  }

  if (bestActions.length === 1) {
    return bestActions[0];
  }

  return bestActions[Math.floor(Math.random() * bestActions.length)];
}

/**
 * Fast background Q-learning training loop.
 * Runs `episodes` (default 100) from picking stations / aisle states to goal (14, 8)
 * with maximum 100 steps per episode.
 * Updates the Q-table in place so Q-values visibly converge to the goal.
 *
 * One episode = drop the agent on a starting cell, then repeat
 * choose -> act -> learn until it reaches the goal or runs out of steps.
 * The step cap (100) stops a confused early agent from wandering forever.
 * Because the table is shared between calls (pass `options.qTable`), calling
 * this several times keeps improving the same table rather than starting over.
 *
 * Option names actually read from `options`: racks, goal, qTable,
 * learningRate (alpha), discountFactor (gamma), explorationRate (epsilon) and
 * maxSteps. Picking zones are always the DEFAULT_PICKING_ZONES, and the grid
 * size is always the default 16 x 10.
 *
 * @param {number} episodes - Number of training episodes (default 100)
 * @param {Function} [onProgress] - Optional callback ({ episode, totalEpisodes, successRate, qTable })
 * @param {Object} [options] - Additional parameters (racks, goal, qTable, alpha, gamma, epsilon)
 * @returns {{ qTable: Array<Array<number>>, episodes: number, successfulAttempts: number }}
 */
export function fastTrain(episodes = 100, onProgress = null, options = {}) {
  const racks = options.racks || DEFAULT_RACKS;
  const goal = options.goal || DEFAULT_GOAL;
  const alpha = options.learningRate ?? DEFAULT_HYPERPARAMS.learningRate;
  const gamma = options.discountFactor ?? DEFAULT_HYPERPARAMS.discountFactor;
  const epsilon = options.explorationRate ?? DEFAULT_HYPERPARAMS.explorationRate;
  const maxSteps = options.maxSteps || 100;

  const qTable = options.qTable || createQTable(TOTAL_STATES, 4, 0.0);

  // Pre-calculate all accessible non-rack aisle coordinates
  const rackSet = racks instanceof Set ? racks : new Set(
    (Array.isArray(racks) ? racks : []).map(r => Array.isArray(r) ? `${r[0]},${r[1]}` : `${r.x},${r.y}`)
  );

  const validAisleStates = [];
  for (let x = 0; x < GRID_WIDTH; x++) {
    for (let y = 0; y < GRID_HEIGHT; y++) {
      if (!rackSet.has(`${x},${y}`) && !(x === goal[0] && y === goal[1])) {
        validAisleStates.push([x, y]);
      }
    }
  }

  // Picking stations list for focused starting state distribution
  const pickingStates = DEFAULT_PICKING_ZONES.filter(
    pz => !rackSet.has(`${pz[0]},${pz[1]}`)
  );

  let successfulAttempts = 0;

  for (let ep = 0; ep < episodes; ep++) {
    // 50% start from dedicated picking stations, 50% from random aisle states
    let startPos;
    if (pickingStates.length > 0 && Math.random() < 0.5) {
      startPos = pickingStates[Math.floor(Math.random() * pickingStates.length)];
    } else {
      startPos = validAisleStates[Math.floor(Math.random() * validAisleStates.length)];
    }

    let pos = [startPos[0], startPos[1]];
    let finished = false;

    for (let step = 0; step < maxSteps; step++) {
      const action = chooseAction(pos, qTable, epsilon);
      const stepResult = takeAction(pos, action, racks, goal);

      learn(pos, action, stepResult.nextPos, stepResult.reward, stepResult.finished, qTable, alpha, gamma);

      pos = stepResult.nextPos;

      if (stepResult.finished) {
        successfulAttempts++;
        finished = true;
        break;
      }
    }

    if (onProgress && (ep % 10 === 0 || ep === episodes - 1)) {
      onProgress({
        episode: ep + 1,
        totalEpisodes: episodes,
        successRate: successfulAttempts / (ep + 1),
        qTable,
      });
    }
  }

  return {
    qTable,
    episodes,
    successfulAttempts,
  };
}

// ============================================================================
// 2. 2D MANHATTAN A* PATHFINDING
// ============================================================================

/**
 * Finds the shortest obstacle-free path avoiding warehouse racks using A* search
 * and the Manhattan distance heuristic (|x1 - x2| + |y1 - y2|).
 *
 * @param {Array} start - Starting coordinate [sx, sy]
 * @param {Array} goal - Goal coordinate [gx, gy]
 * @param {Array|Set} racks - Rack coordinates to avoid
 * @param {number} width - Grid width (default 16)
 * @param {number} height - Grid height (default 10)
 * @returns {Array<[number, number]>} Array of coordinates from start to goal, or [] if no path.
 */
export function findPathAStar(
  start,
  goal,
  racks = DEFAULT_RACKS,
  width = GRID_WIDTH,
  height = GRID_HEIGHT
) {
  const sx = start[0], sy = start[1];
  const gx = goal[0], gy = goal[1];

  if (sx === gx && sy === gy) {
    return [[sx, sy]];
  }

  // Pre-index racks into a Set for O(1) lookup
  const rackSet = racks instanceof Set ? racks : new Set(
    (Array.isArray(racks) ? racks : []).map(r =>
      Array.isArray(r) ? `${r[0]},${r[1]}` : (r && r.x !== undefined ? `${r.x},${r.y}` : `${r}`)
    )
  );

  const key = (x, y) => `${x},${y}`;
  const manhattan = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

  const startKey = key(sx, sy);
  const openSet = new Map();
  openSet.set(startKey, { x: sx, y: sy, f: manhattan(sx, sy), g: 0 });

  const cameFrom = new Map();
  const gScore = new Map();
  gScore.set(startKey, 0);

  const closedSet = new Set();

  const orthogonalMoves = [
    { dx: 0, dy: -1 }, // up
    { dx: 0, dy: 1 },  // down
    { dx: -1, dy: 0 }, // left
    { dx: 1, dy: 0 },  // right
  ];

  while (openSet.size > 0) {
    // Find node with minimum fScore
    let currentKey = null;
    let lowestF = Infinity;
    let current = null;

    for (const [k, node] of openSet.entries()) {
      if (node.f < lowestF) {
        lowestF = node.f;
        currentKey = k;
        current = node;
      }
    }

    if (!current) break;

    // Check if goal reached
    if (current.x === gx && current.y === gy) {
      const makePt = (x, y) => {
        const p = [x, y];
        p.x = x;
        p.y = y;
        return p;
      };
      const path = [makePt(current.x, current.y)];
      let curr = currentKey;
      while (cameFrom.has(curr)) {
        curr = cameFrom.get(curr);
        const [px, py] = curr.split(',').map(Number);
        path.unshift(makePt(px, py));
      }
      return path;
    }

    openSet.delete(currentKey);
    closedSet.add(currentKey);

    const currentG = gScore.get(currentKey);

    for (const move of orthogonalMoves) {
      const nx = current.x + move.dx;
      const ny = current.y + move.dy;
      const nKey = key(nx, ny);

      // Boundary check
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      // Rack check
      if (rackSet.has(nKey) && !(nx === gx && ny === gy)) continue;
      // Closed set check
      if (closedSet.has(nKey)) continue;

      const tentativeG = currentG + 1;
      const existingG = gScore.has(nKey) ? gScore.get(nKey) : Infinity;

      if (tentativeG < existingG) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        const f = tentativeG + manhattan(nx, ny);
        openSet.set(nKey, { x: nx, y: ny, f, g: tentativeG });
      }
    }
  }

  // Goal is unreachable
  return [];
}

// ============================================================================
// 3. MULTI-ROBOT FLEET & COLLISION AVOIDANCE
// ============================================================================

/**
 * Creates the standard 4-robot fleet (R1, R2, R3, R4) with tactile initial positions.
 */
export function createRobotFleet() {
  const colors = ['#FF5A26', '#2563EB', '#10B981', '#8B5CF6'];
  const baseFleet = [
    {
      id: 'R1',
      name: 'Robot 1 (Alpha)',
      pos: [1, 1],
      targetPos: [14, 8],
    },
    {
      id: 'R2',
      name: 'Robot 2 (Beta)',
      pos: [1, 4],
      targetPos: [14, 8],
    },
    {
      id: 'R3',
      name: 'Robot 3 (Gamma)',
      pos: [1, 6],
      targetPos: [14, 8],
    },
    {
      id: 'R4',
      name: 'Robot 4 (Delta)',
      pos: [1, 8],
      targetPos: [14, 8],
    },
  ];

  return baseFleet.map((r, i) => ({
    id: r.id,
    name: r.name,
    pos: [r.pos[0], r.pos[1]],
    x: r.pos[0],
    y: r.pos[1],
    targetPos: [r.targetPos[0], r.targetPos[1]],
    targetX: r.targetPos[0],
    targetY: r.targetPos[1],
    color: colors[i],
    path: [],
    battery: 100,
    status: 'idle', // 'idle' | 'picking' | 'packing' | 'delivering' | 'charging' | 'yielding'
    isYielding: false,
    yieldTicks: 0,
    orderId: null,
    chargingDock: null,
    previousStatus: null,
    previousTargetPos: null,
    qScores: { up: 0, right: 0, down: 0, left: 0 },
  }));
}

/**
 * Finds the least-congested charging dock at x = 0.
 * Counts how many robots are already charging or routed to each dock.
 * Ties are broken by shortest Manhattan distance to the requesting robot.
 */
export function findLeastCongestedDock(robotPos, robots, chargingDocks = DEFAULT_CHARGING_DOCKS) {
  let bestDock = chargingDocks[0];
  let minCongestion = Infinity;
  let minDistance = Infinity;

  for (const dock of chargingDocks) {
    let congestion = 0;
    for (const r of robots) {
      if (
        (r.status === 'charging' && r.chargingDock && r.chargingDock[0] === dock[0] && r.chargingDock[1] === dock[1]) ||
        (r.pos[0] === dock[0] && r.pos[1] === dock[1] && r.status === 'charging')
      ) {
        congestion++;
      }
    }

    const dist = Math.abs(robotPos[0] - dock[0]) + Math.abs(robotPos[1] - dock[1]);

    if (congestion < minCongestion || (congestion === minCongestion && dist < minDistance)) {
      minCongestion = congestion;
      minDistance = dist;
      bestDock = dock;
    }
  }

  return bestDock;
}

/**
 * Evaluates priority for collision resolution between robots.
 * Right-of-way rule:
 * 1. Robot carrying active delivery (status === 'delivering') has priority.
 * 2. Lower robot index (R1 > R2 > R3 > R4) has right-of-way.
 */
function getRobotPriority(robot, index) {
  const isDelivering = robot.status === 'delivering';
  return (isDelivering ? 1000 : 0) - index;
}

/**
 * Advances the simulation by 1 tick:
 * - Updates yielding states
 * - Recharges docked robots (+10% per tick)
 * - Auto-routes robots with battery < 20% to least-congested dock at x=0
 * - Proposes next step for moving robots
 * - Resolves multi-robot cell conflicts & head-on swaps (yielding halo, collisionsAvoided KPI)
 * - Drains battery by 0.8% per movement step
 * - Updates charger utilization KPI
 */
export function stepSimulationTick(robots, racks = DEFAULT_RACKS, chargingDocks = DEFAULT_CHARGING_DOCKS, stats = null) {
  const simulationStats = stats || {
    tickCount: 0,
    collisionsAvoided: 0,
    chargerUtilization: 0,
    ordersCompleted: 0,
    totalChargingTicks: 0,
  };

  simulationStats.tickCount++;

  // --------------------------------------------------------------------------
  // Phase 1: Recharging & Yield Expiration
  // --------------------------------------------------------------------------
  for (let i = 0; i < robots.length; i++) {
    const robot = robots[i];

    // If robot was yielding in the previous tick, expire the 1-tick yield
    if (robot.isYielding) {
      robot.yieldTicks = (robot.yieldTicks || 0) + 1;
      if (robot.yieldTicks >= 1) {
        robot.isYielding = false;
        robot.yieldTicks = 0;
        if (robot.status === 'yielding') {
          robot.status = robot.previousStatus || 'idle';
        }
      }
    }

    // Recharging at dock
    const isAtDock = chargingDocks.some(d => d[0] === robot.pos[0] && d[1] === robot.pos[1]);
    if (robot.status === 'charging' && isAtDock) {
      robot.battery = Math.min(100, Number((robot.battery + 10).toFixed(1)));

      if (robot.battery >= 100) {
        robot.battery = 100;
        // Resume previous order/queue
        if (robot.orderId) {
          robot.status = robot.previousStatus || 'picking';
          robot.targetPos = robot.previousTargetPos || DEFAULT_GOAL;
          robot.path = findPathAStar(robot.pos, robot.targetPos, racks);
          if (robot.path.length > 0 && robot.path[0][0] === robot.pos[0] && robot.path[0][1] === robot.pos[1]) {
            robot.path.shift();
          }
        } else {
          robot.status = 'idle';
          robot.path = [];
        }
        robot.chargingDock = null;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Phase 2: Charging Traffic Management (< 20% Battery Drain)
  // --------------------------------------------------------------------------
  for (let i = 0; i < robots.length; i++) {
    const robot = robots[i];
    if (robot.battery < 20 && robot.status !== 'charging') {
      const targetDock = findLeastCongestedDock(robot.pos, robots, chargingDocks);
      robot.previousStatus = robot.status;
      robot.previousTargetPos = robot.targetPos;
      robot.chargingDock = targetDock;
      robot.status = 'charging';
      robot.targetPos = targetDock;
      robot.path = findPathAStar(robot.pos, targetDock, racks);
      if (robot.path.length > 0 && robot.path[0][0] === robot.pos[0] && robot.path[0][1] === robot.pos[1]) {
        robot.path.shift();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Phase 3: Planned Next Steps
  // --------------------------------------------------------------------------
  const proposedPos = new Array(robots.length);
  const isMoving = new Array(robots.length).fill(false);

  for (let i = 0; i < robots.length; i++) {
    const robot = robots[i];
    const isAtDock = chargingDocks.some(d => d[0] === robot.pos[0] && d[1] === robot.pos[1]);

    if (robot.isYielding || (robot.status === 'charging' && isAtDock)) {
      proposedPos[i] = [robot.pos[0], robot.pos[1]];
      isMoving[i] = false;
      continue;
    }

    // Ensure path exists if robot has an active target
    if ((!robot.path || robot.path.length === 0) && robot.targetPos) {
      if (robot.pos[0] !== robot.targetPos[0] || robot.pos[1] !== robot.targetPos[1]) {
        robot.path = findPathAStar(robot.pos, robot.targetPos, racks);
        if (robot.path.length > 0 && robot.path[0][0] === robot.pos[0] && robot.path[0][1] === robot.pos[1]) {
          robot.path.shift();
        }
      }
    }

    if (robot.path && robot.path.length > 0) {
      proposedPos[i] = [robot.path[0][0], robot.path[0][1]];
      isMoving[i] = true;
    } else {
      proposedPos[i] = [robot.pos[0], robot.pos[1]];
      isMoving[i] = false;
    }
  }

  // --------------------------------------------------------------------------
  // Phase 4: Multi-Robot Collision Avoidance
  // --------------------------------------------------------------------------
  // 1. Target Cell Conflict (Multiple robots planning to step into the exact same cell)
  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      if (proposedPos[i][0] === proposedPos[j][0] && proposedPos[i][1] === proposedPos[j][1]) {
        // If both want the same cell, at least one is attempting to move into it
        if (isMoving[i] || isMoving[j]) {
          const prioI = getRobotPriority(robots[i], i);
          const prioJ = getRobotPriority(robots[j], j);

          const loserIdx = prioI >= prioJ ? j : i;
          const loserRobot = robots[loserIdx];

          loserRobot.isYielding = true;
          loserRobot.yieldTicks = 0;
          loserRobot.previousStatus = loserRobot.status !== 'yielding' ? loserRobot.status : loserRobot.previousStatus;
          loserRobot.status = 'yielding';
          proposedPos[loserIdx] = [loserRobot.pos[0], loserRobot.pos[1]];
          isMoving[loserIdx] = false;
          simulationStats.collisionsAvoided++;
        }
      }
    }
  }

  // 2. Head-On Swap Conflict (Robot A -> Pos B and Robot B -> Pos A)
  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      const aCurrent = robots[i].pos;
      const bCurrent = robots[j].pos;
      const aTarget = proposedPos[i];
      const bTarget = proposedPos[j];

      const isSwap =
        aTarget[0] === bCurrent[0] && aTarget[1] === bCurrent[1] &&
        bTarget[0] === aCurrent[0] && bTarget[1] === aCurrent[1];

      if (isSwap) {
        const prioI = getRobotPriority(robots[i], i);
        const prioJ = getRobotPriority(robots[j], j);

        const loserIdx = prioI >= prioJ ? j : i;
        const winnerIdx = prioI >= prioJ ? i : j;

        const loserRobot = robots[loserIdx];
        loserRobot.isYielding = true;
        loserRobot.yieldTicks = 0;
        loserRobot.previousStatus = loserRobot.status !== 'yielding' ? loserRobot.status : loserRobot.previousStatus;
        loserRobot.status = 'yielding';
        proposedPos[loserIdx] = [loserRobot.pos[0], loserRobot.pos[1]];
        isMoving[loserIdx] = false;

        // Since the loser stays at its current cell, the winner must also pause for 1 tick to avoid physical overlap
        proposedPos[winnerIdx] = [robots[winnerIdx].pos[0], robots[winnerIdx].pos[1]];
        isMoving[winnerIdx] = false;

        simulationStats.collisionsAvoided++;
      }
    }
  }

  // 3. Stationary Occupancy Conflict (Robot moving into an already occupied stationary cell)
  for (let i = 0; i < robots.length; i++) {
    if (!isMoving[i]) continue;
    for (let j = 0; j < robots.length; j++) {
      if (i === j) continue;
      if (!isMoving[j] && proposedPos[i][0] === proposedPos[j][0] && proposedPos[i][1] === proposedPos[j][1]) {
        // Robot i cannot enter stationary cell occupied by j
        robots[i].isYielding = true;
        robots[i].yieldTicks = 0;
        robots[i].previousStatus = robots[i].status !== 'yielding' ? robots[i].status : robots[i].previousStatus;
        robots[i].status = 'yielding';
        proposedPos[i] = [robots[i].pos[0], robots[i].pos[1]];
        isMoving[i] = false;
        simulationStats.collisionsAvoided++;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Phase 5: Execute Movements & Battery Drain (0.8% per move step)
  // --------------------------------------------------------------------------
  for (let i = 0; i < robots.length; i++) {
    const robot = robots[i];
    const newPos = proposedPos[i];

    if (newPos[0] !== robot.pos[0] || newPos[1] !== robot.pos[1]) {
      robot.pos = [newPos[0], newPos[1]];
      if (robot.path && robot.path.length > 0) {
        robot.path.shift();
      }
      // Movement battery drain: 0.8% per step
      robot.battery = Math.max(0, Number((robot.battery - 0.8).toFixed(1)));

      // Check arrival at targetPos
      if (robot.targetPos && robot.pos[0] === robot.targetPos[0] && robot.pos[1] === robot.targetPos[1]) {
        if (robot.status === 'picking') {
          robot.status = 'delivering';
          robot.targetPos = DEFAULT_GOAL;
          robot.path = findPathAStar(robot.pos, DEFAULT_GOAL, racks);
          if (robot.path.length > 0 && robot.path[0][0] === robot.pos[0] && robot.path[0][1] === robot.pos[1]) {
            robot.path.shift();
          }
        } else if (robot.status === 'delivering') {
          simulationStats.ordersCompleted++;
          robot.status = 'idle';
          robot.orderId = null;
          robot.path = [];
        }
      }
    }

    robot.x = robot.pos[0];
    robot.y = robot.pos[1];
    robot.targetX = robot.targetPos ? robot.targetPos[0] : null;
    robot.targetY = robot.targetPos ? robot.targetPos[1] : null;
  }

  // --------------------------------------------------------------------------
  // Phase 6: Charger Utilization % KPI Tracking
  // --------------------------------------------------------------------------
  let occupiedDocks = 0;
  for (const dock of chargingDocks) {
    if (robots.some(r => r.pos[0] === dock[0] && r.pos[1] === dock[1] && r.status === 'charging')) {
      occupiedDocks++;
    }
  }
  simulationStats.totalChargingTicks += occupiedDocks;
  simulationStats.chargerUtilization = Number(((occupiedDocks / chargingDocks.length) * 100).toFixed(1));
  simulationStats.cumulativeChargerUtilization = Number(
    ((simulationStats.totalChargingTicks / (simulationStats.tickCount * chargingDocks.length)) * 100).toFixed(1)
  );

  return {
    robots,
    stats: simulationStats,
  };
}

// ============================================================================
// 4. MODEL JSON I/O (MATCHING base_reference_model.ipynb EXACT SCHEMA)
// ============================================================================

/**
 * Exports learned Q-table and world configuration matching notebook schema:
 * {
 *   "q_table": [...],
 *   "actions": ["up", "down", "left", "right"],
 *   "goal": [14, 8],
 *   "step_reward": -1,
 *   "goal_reward": 10,
 *   "discount_factor": 0.95
 * }
 *
 * @param {Array<Array<number>>} qTable - The 160 x 4 Q-table
 * @param {Object} [options] - Additional metadata overrides
 * @returns {string} Formatted JSON string
 */
export function exportModelJSON(qTable, options = {}) {
  const model = {
    q_table: qTable,
    actions: options.actions || [...ACTIONS],
    goal: options.goal || [...DEFAULT_GOAL],
    step_reward: options.stepReward ?? DEFAULT_HYPERPARAMS.stepReward,
    goal_reward: options.goalReward ?? DEFAULT_HYPERPARAMS.goalReward,
    discount_factor: options.discountFactor ?? DEFAULT_HYPERPARAMS.discountFactor,
  };

  return JSON.stringify(model, null, 2);
}

/**
 * Imports and validates a model JSON string matching notebook schema.
 *
 * @param {string|Object} jsonInput - Serialized JSON string or parsed object
 * @returns {{ qTable: Array<Array<number>>, actions: string[], goal: number[], stepReward: number, goalReward: number, discountFactor: number }}
 */
export function importModelJSON(jsonInput) {
  const parsed = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;

  if (!parsed || !Array.isArray(parsed.q_table)) {
    throw new Error('Invalid model format: missing or malformed "q_table" array.');
  }

  if (parsed.q_table.length !== TOTAL_STATES) {
    throw new Error(`Invalid model dimensions: expected ${TOTAL_STATES} states, got ${parsed.q_table.length}.`);
  }

  for (let s = 0; s < parsed.q_table.length; s++) {
    if (!Array.isArray(parsed.q_table[s]) || parsed.q_table[s].length !== 4) {
      throw new Error(`Invalid Q-table row at state ${s}: expected 4 action scores.`);
    }
  }

  return {
    qTable: parsed.q_table,
    actions: parsed.actions || [...ACTIONS],
    goal: parsed.goal || [...DEFAULT_GOAL],
    stepReward: parsed.step_reward ?? DEFAULT_HYPERPARAMS.stepReward,
    goalReward: parsed.goal_reward ?? DEFAULT_HYPERPARAMS.goalReward,
    discountFactor: parsed.discount_factor ?? DEFAULT_HYPERPARAMS.discountFactor,
  };
}

// ============================================================================
// 5. SIMULATION ENGINE SERVICE CLASS
// ============================================================================

/**
 * Integrated simulation engine service for Module 1 of RoboWare.
 * Handles state persistence, simulation stepping, fast training, and UI event subscriptions.
 */
export class SimulationEngine {
  constructor(config = {}) {
    this.width = config.width || GRID_WIDTH;
    this.height = config.height || GRID_HEIGHT;
    this.goal = config.goal ? [...config.goal] : [...DEFAULT_GOAL];
    this.racks = config.racks ? [...config.racks] : [...DEFAULT_RACKS];
    this.chargingDocks = config.chargingDocks ? [...config.chargingDocks] : [...DEFAULT_CHARGING_DOCKS];
    this.pickingZones = config.pickingZones ? [...config.pickingZones] : [...DEFAULT_PICKING_ZONES];
    this.packingStations = config.packingStations ? [...config.packingStations] : [...DEFAULT_PACKING_STATIONS];

    this.qTable = config.qTable ? cloneQTable(config.qTable) : createQTable(this.width * this.height, 4, 0.0);
    this.robots = config.robots ? config.robots.map((r) => ({ ...r })) : createRobotFleet();

    this.episode = 0;
    this.routingMode = 'HYBRID';
    this.autoDemandWave = true;
    this.hyperparameters = { ...DEFAULT_HYPERPARAMS };

    this.orders = [
      {
        id: 'ORD-101',
        item: 'SKU-7729 (Ceramic Bearings)',
        stage: 'PICKING',
        assignedRobotId: 'R1',
        pickLocation: { x: 2, y: 1 },
        packLocation: { x: 14, y: 2 },
        deliveryLocation: { x: 14, y: 8 },
      },
      {
        id: 'ORD-102',
        item: 'SKU-5541 (Stepper Driver Module)',
        stage: 'PACKING',
        assignedRobotId: 'R2',
        pickLocation: { x: 2, y: 8 },
        packLocation: { x: 14, y: 5 },
        deliveryLocation: { x: 14, y: 8 },
      },
      {
        id: 'ORD-103',
        item: 'SKU-3382 (High-Torque Planetary Gear)',
        stage: 'DELIVERING',
        assignedRobotId: 'R3',
        pickLocation: { x: 13, y: 1 },
        packLocation: { x: 14, y: 2 },
        deliveryLocation: { x: 14, y: 8 },
      },
      {
        id: 'ORD-104',
        item: 'SKU-9901 (Lithium Cell Pack 48V)',
        stage: 'QUEUED',
        assignedRobotId: null,
        pickLocation: { x: 2, y: 1 },
        packLocation: { x: 14, y: 5 },
        deliveryLocation: { x: 14, y: 8 },
      },
    ];

    this.stats = {
      tickCount: 0,
      collisionsAvoided: 0,
      chargerUtilization: 0,
      ordersCompleted: 0,
      successfulDeliveries: 0,
      totalChargingTicks: 0,
      cumulativeChargerUtilization: 0,
    };

    this.grid = this.buildGrid();
    this.subscribers = new Set();
    this.updateRobotQScores();
  }

  get tick() {
    return this.stats.tickCount;
  }

  set tick(val) {
    this.stats.tickCount = val;
  }

  buildGrid() {
    const rackSet = new Set(this.racks.map(([x, y]) => `${x},${y}`));
    const dockSet = new Set(this.chargingDocks.map(([x, y]) => `${x},${y}`));
    const pickSet = new Set(this.pickingZones.map(([x, y]) => `${x},${y}`));
    const packSet = new Set(this.packingStations.map(([x, y]) => `${x},${y}`));
    const goalKey = `${this.goal[0]},${this.goal[1]}`;

    const grid = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        const k = `${x},${y}`;
        let type = 'aisle';
        if (k === goalKey) type = 'delivery';
        else if (rackSet.has(k)) type = 'rack';
        else if (dockSet.has(k)) type = 'charging';
        else if (pickSet.has(k)) type = 'picking';
        else if (packSet.has(k)) type = 'packing';
        row.push({ x, y, type });
      }
      grid.push(row);
    }
    return grid;
  }

  paintCell(x, y, brushType) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const filterOut = (arr) => arr.filter(([cx, cy]) => !(cx === x && cy === y));
    this.racks = filterOut(this.racks);
    this.chargingDocks = filterOut(this.chargingDocks);
    this.pickingZones = filterOut(this.pickingZones);
    this.packingStations = filterOut(this.packingStations);

    if (brushType === 'rack') this.racks.push([x, y]);
    else if (brushType === 'charging') this.chargingDocks.push([x, y]);
    else if (brushType === 'picking') this.pickingZones.push([x, y]);
    else if (brushType === 'packing') this.packingStations.push([x, y]);
    else if (brushType === 'delivery') this.goal = [x, y];

    this.grid = this.buildGrid();
    this.notify();
  }

  resetWorld() {
    this.racks = [...DEFAULT_RACKS];
    this.chargingDocks = [...DEFAULT_CHARGING_DOCKS];
    this.pickingZones = [...DEFAULT_PICKING_ZONES];
    this.packingStations = [...DEFAULT_PACKING_STATIONS];
    this.goal = [...DEFAULT_GOAL];
    this.grid = this.buildGrid();
    this.reset();
  }

  injectLiveOrder() {
    const idNum = 100 + this.orders.length + 1;
    const items = [
      'SKU-9901 (Lithium Cell Pack 48V)',
      'SKU-4412 (Silicon Thermal Pad)',
      'SKU-2310 (High-Torque Actuator)',
      'SKU-8824 (Brushless DC Motor)',
      'SKU-1120 (Optical Sensor Array)',
    ];
    const item = items[Math.floor(Math.random() * items.length)];
    const picks = this.pickingZones.length > 0 ? this.pickingZones : DEFAULT_PICKING_ZONES;
    const packs = this.packingStations.length > 0 ? this.packingStations : DEFAULT_PACKING_STATIONS;
    const pick = picks[Math.floor(Math.random() * picks.length)];
    const pack = packs[Math.floor(Math.random() * packs.length)];

    this.orders.push({
      id: `ORD-${idNum}`,
      item,
      stage: 'QUEUED',
      assignedRobotId: null,
      pickLocation: { x: pick[0], y: pick[1] },
      packLocation: { x: pack[0], y: pack[1] },
      deliveryLocation: { x: this.goal[0], y: this.goal[1] },
    });
    this.notify();
  }

  getMaxQForCell(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    const state = posToState([x, y]);
    const row = this.qTable[state];
    if (!row) return 0;
    return Math.max(...row);
  }

  getBestPolicyForCell(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    const state = posToState([x, y]);
    const row = this.qTable[state];
    if (!row) return null;
    const maxVal = Math.max(...row);
    if (maxVal <= 0) return null;

    const actionIndex = row.indexOf(maxVal);
    const actionNames = ['up', 'down', 'left', 'right'];
    const arrowChars = { up: '↑', down: '↓', left: '←', right: '→' };
    const action = actionNames[actionIndex] || 'right';
    return {
      action,
      arrow: arrowChars[action],
      qValue: maxVal,
    };
  }

  updateRobotQScores() {
    for (const robot of this.robots) {
      robot.x = robot.pos[0];
      robot.y = robot.pos[1];
      robot.targetX = robot.targetPos ? robot.targetPos[0] : null;
      robot.targetY = robot.targetPos ? robot.targetPos[1] : null;
      const state = posToState(robot.pos);
      const row = this.qTable[state] || [0, 0, 0, 0];
      robot.qScores = {
        up: Number(row[0].toFixed(2)),
        down: Number(row[1].toFixed(2)),
        left: Number(row[2].toFixed(2)),
        right: Number(row[3].toFixed(2)),
      };
    }
  }

  /**
   * Resets fleet and KPIs to pristine initial state.
   */
  reset() {
    this.robots = createRobotFleet();
    this.stats = {
      tickCount: 0,
      collisionsAvoided: 0,
      chargerUtilization: 0,
      ordersCompleted: 0,
      successfulDeliveries: 0,
      totalChargingTicks: 0,
      cumulativeChargerUtilization: 0,
    };
    this.updateRobotQScores();
    this.notify();
  }

  /**
   * Advances the warehouse simulation by 1 tick.
   */
  step() {
    stepSimulationTick(this.robots, this.racks, this.chargingDocks, this.stats);
    this.stats.successfulDeliveries = this.stats.ordersCompleted;
    this.updateRobotQScores();

    if (this.autoDemandWave && this.stats.tickCount % 20 === 0) {
      this.injectLiveOrder();
    }

    this.notify();
    return { robots: this.robots, stats: this.stats };
  }

  /**
   * Runs fast background Q-learning training for `episodes` (default 100).
   */
  fastTrain(episodes = 100, onProgress = null) {
    const result = fastTrain(episodes, onProgress, {
      qTable: this.qTable,
      racks: this.racks,
      goal: this.goal,
    });
    this.episode += episodes;
    this.updateRobotQScores();
    this.notify();
    return result;
  }

  fastTrain100() {
    return this.fastTrain(100);
  }

  /**
   * Single RL action step helper for interactive UI canvas.
   */
  takeAction(pos, action) {
    return takeAction(pos, action, this.racks, this.goal, this.width, this.height);
  }

  /**
   * Single Bellman learning update helper.
   */
  learn(currentPos, action, nextPos, reward, finished) {
    return learn(currentPos, action, nextPos, reward, finished, this.qTable);
  }

  /**
   * Epsilon-greedy action choice for a given position.
   */
  chooseAction(pos, explorationRate = DEFAULT_HYPERPARAMS.explorationRate) {
    return chooseAction(pos, this.qTable, explorationRate);
  }

  /**
   * Calculates optimal A* path between two points.
   */
  findPath(start, goal) {
    return findPathAStar(start, goal, this.racks, this.width, this.height);
  }

  /**
   * Exports model JSON matching notebook schema.
   */
  exportModel() {
    return exportModelJSON(this.qTable, { goal: this.goal });
  }

  exportModelJSON() {
    return exportModelJSON(this.qTable, {
      goal: this.goal,
      stepReward: this.hyperparameters.stepReward,
      goalReward: this.hyperparameters.goalReward,
      discountFactor: this.hyperparameters.discountFactor,
    });
  }

  /**
   * Imports model JSON string matching notebook schema.
   */
  importModel(jsonString) {
    const imported = importModelJSON(jsonString);
    this.qTable = imported.qTable;
    this.goal = imported.goal;
    this.updateRobotQScores();
    this.notify();
    return imported;
  }

  importModelJSON(jsonString) {
    try {
      const imported = this.importModel(jsonString);
      return { success: true, imported };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Updates warehouse goal coordinate.
   */
  setGoal(newGoal) {
    this.goal = [...newGoal];
    this.grid = this.buildGrid();
    this.notify();
  }

  /**
   * Updates warehouse racks.
   */
  setRacks(newRacks) {
    this.racks = [...newRacks];
    this.grid = this.buildGrid();
    this.notify();
  }

  /**
   * Subscribes a listener to simulation updates.
   */
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * Notifies all registered subscribers of state change.
   */
  notify() {
    const snapshot = {
      robots: this.robots,
      stats: this.stats,
      qTable: this.qTable,
      goal: this.goal,
      racks: this.racks,
      grid: this.grid,
      orders: this.orders,
      tick: this.tick,
      episode: this.episode,
    };
    for (const listener of this.subscribers) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('SimulationEngine subscriber error:', err);
      }
    }
  }
}

// Singleton instance for global app usage
export const simulationEngine = new SimulationEngine();
export default simulationEngine;
