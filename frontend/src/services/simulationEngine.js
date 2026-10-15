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
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 10;
export const GRID_COLS = GRID_WIDTH;
export const GRID_ROWS = GRID_HEIGHT;
export const TOTAL_STATES = GRID_WIDTH * GRID_HEIGHT; // 160 states

export const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
export const ROW_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

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

export const ACTION_DELTAS = [
  { dx: 0, dy: -1 }, // 0: up
  { dx: 0, dy: 1 },  // 1: down
  { dx: -1, dy: 0 }, // 2: left
  { dx: 1, dy: 0 },  // 3: right
];

// Hyperparameters matching base_reference_model.ipynb contract
export const DEFAULT_HYPERPARAMS = {
  learningRate: 0.1,     // alpha
  discountFactor: 0.95,  // gamma
  explorationRate: 0.3,  // epsilon
  stepReward: -1,        // reward per non-goal step or obstacle hit
  goalReward: 10,        // reward for reaching delivery goal
};

// Default warehouse coordinates
export const DEFAULT_GOAL = [14, 8];

export const DEFAULT_CHARGING_DOCKS = [
  [0, 2],
  [0, 7],
];

export const DEFAULT_PICKING_ZONES = [
  [2, 1],
  [2, 8],
  [13, 1],
];

export const DEFAULT_PACKING_STATIONS = [
  [14, 2],
  [14, 5],
];

// Default storage rack bays (Raised Sandstone racks)
// Arranged with aisles at x=0..3, 6, 9, 12..15 and cross-aisles at y=0, 4, 8, 9
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
 */
export function posToState(pos, width = GRID_WIDTH) {
  if (typeof pos === 'number') return pos;
  if (Array.isArray(pos)) return pos[1] * width + pos[0];
  if (pos && typeof pos === 'object') return pos.y * width + pos.x;
  return 0;
}

/**
 * Maps a 1D state index (0..159) to a 2D coordinate [x, y].
 */
export function stateToPos(stateIndex, width = GRID_WIDTH) {
  return [stateIndex % width, Math.floor(stateIndex / width)];
}

/**
 * Checks if a coordinate matches any rack in the racks collection.
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
 */
export function cloneQTable(qTable) {
  return qTable.map(row => [...row]);
}

// ============================================================================
// 1. 2D Q-LEARNING CORE ENGINE
// ============================================================================

/**
 * Computes next position, reward, and finished status given an action.
 * Contract from base_reference_model.ipynb:
 * - If moving into bounds and not hitting storage racks, updates position.
 * - If hitting rack or border, position stays unchanged and receives step reward (-1).
 * - If new position equals goal: reward = 10, finished = true.
 * - Else: reward = -1, finished = false.
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

  const actionIdx = typeof action === 'string' ? ACTION_MAP[action] : action;
  const delta = ACTION_DELTAS[actionIdx] || { dx: 0, dy: 0 };

  const newX = currentX + delta.dx;
  const newY = currentY + delta.dy;

  // Boundary check
  const inBounds = newX >= 0 && newX < width && newY >= 0 && newY < height;
  // Storage rack obstacle check
  const hitObstacle = inBounds && isRack(newX, newY, racks);

  if (!inBounds || hitObstacle) {
    // Position unchanged, receives step reward (-1), finished = false
    return {
      nextPos: [currentX, currentY],
      reward: stepReward,
      finished: false,
    };
  }

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
  if (Math.random() < explorationRate) {
    return Math.floor(Math.random() * 4);
  }

  const stateIdx = posToState(pos);
  const scores = qTable[stateIdx];

  let maxScore = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > maxScore) {
      maxScore = scores[i];
    }
  }

  // Collect all actions sharing the maximum score for tie-breaking
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
