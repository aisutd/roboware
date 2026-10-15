/**
 * Automated Verification Test Script for RoboWare simulationEngine.js
 */

import {
  GRID_WIDTH,
  GRID_HEIGHT,
  TOTAL_STATES,
  ACTIONS,
  ACTION_MAP,
  ACTION_DELTAS,
  DEFAULT_HYPERPARAMS,
  DEFAULT_GOAL,
  DEFAULT_CHARGING_DOCKS,
  DEFAULT_RACKS,
  posToState,
  stateToPos,
  isRack,
  createQTable,
  takeAction,
  learn,
  chooseAction,
  fastTrain,
  findPathAStar,
  createRobotFleet,
  findLeastCongestedDock,
  stepSimulationTick,
  exportModelJSON,
  importModelJSON,
  SimulationEngine,
} from './frontend/src/services/simulationEngine.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failedTests++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual, expected, tolerance = 1e-4, message = '') {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`  [PASS] ${message} (actual: ${actual}, expected: ${expected})`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message} (actual: ${actual}, expected: ${expected}, diff: ${diff})`);
    failedTests++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('============================================================');
console.log('ROBOWARE SIMULATION & RL SERVICE VERIFICATION SUITE');
console.log('============================================================\n');

// ----------------------------------------------------------------------------
// TEST 1: Grid Dimensions & Bijective State Mapping (160 States)
// ----------------------------------------------------------------------------
console.log('TEST 1: Grid Dimensions & Bijective State Space');
{
  const qTable = createQTable();
  assert(qTable.length === 160, 'Q-table has exactly 160 states (16 x 10 grid)');
  assert(qTable[0].length === 4, 'Each state has exactly 4 action scores');
  assert(qTable[159].length === 4, 'Last state (159) has exactly 4 action scores');

  // Verify bijection: posToState <-> stateToPos
  let bijectionOk = true;
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const state = posToState([x, y]);
      const [revX, revY] = stateToPos(state);
      if (revX !== x || revY !== y) {
        bijectionOk = false;
        break;
      }
    }
  }
  assert(bijectionOk, 'posToState <-> stateToPos bijection verified for all 160 states');

  // Specific state checks
  assert(posToState([0, 0]) === 0, 'Origin [0, 0] is state 0');
  assert(posToState([15, 0]) === 15, '[15, 0] is state 15');
  assert(posToState([0, 1]) === 16, '[0, 1] is state 16');
  assert(posToState([14, 8]) === 8 * 16 + 14, 'Goal [14, 8] is state 142');
  assert(posToState([15, 9]) === 159, 'Bottom-right [15, 9] is state 159');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 2: Environment Dynamics & Obstacle Collision (takeAction)
// ----------------------------------------------------------------------------
console.log('TEST 2: Environment Dynamics & Boundary/Rack Obstacles');
{
  // 1. Boundary hit: moving UP from [0, 0]
  const upFromOrigin = takeAction([0, 0], 'up');
  assert(upFromOrigin.nextPos[0] === 0 && upFromOrigin.nextPos[1] === 0, 'Cannot move UP past top boundary; stays at [0, 0]');
  assert(upFromOrigin.reward === -1, 'Wall bounce yields step reward -1');
  assert(upFromOrigin.finished === false, 'Wall bounce finished is false');

  // 2. Boundary hit: moving LEFT from [0, 5]
  const leftFromWest = takeAction([0, 5], 'left');
  assert(leftFromWest.nextPos[0] === 0 && leftFromWest.nextPos[1] === 5, 'Cannot move LEFT past west boundary');
  assert(leftFromWest.reward === -1, 'Boundary bounce gives -1');

  // 3. Storage Rack obstacle collision: Bay 1 rack at [4, 1]
  // Moving RIGHT from [3, 1] into [4, 1]
  assert(isRack(4, 1, DEFAULT_RACKS), 'Verify [4, 1] is a storage rack');
  const rackHit = takeAction([3, 1], 'right');
  assert(rackHit.nextPos[0] === 3 && rackHit.nextPos[1] === 1, 'Cannot enter rack [4, 1]; position remains [3, 1]');
  assert(rackHit.reward === -1, 'Rack collision receives step reward -1');
  assert(rackHit.finished === false, 'Rack collision finished is false');

  // 4. Valid normal movement along aisle
  const normalMove = takeAction([1, 1], 'down');
  assert(normalMove.nextPos[0] === 1 && normalMove.nextPos[1] === 2, 'Valid aisle move from [1, 1] down to [1, 2]');
  assert(normalMove.reward === -1, 'Valid non-goal step receives -1');
  assert(normalMove.finished === false, 'Valid non-goal step finished is false');

  // 5. Goal transition: moving RIGHT from [13, 8] into [14, 8]
  const goalMove = takeAction([13, 8], 'right');
  assert(goalMove.nextPos[0] === 14 && goalMove.nextPos[1] === 8, 'Moves into delivery goal [14, 8]');
  assert(goalMove.reward === 10, 'Reaching goal receives goal_reward = 10');
  assert(goalMove.finished === true, 'Reaching goal sets finished = true');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 3: Exact Bellman Update Equation (Matching base_reference_model.ipynb)
// ----------------------------------------------------------------------------
console.log('TEST 3: Exact Bellman Update Equation (learn)');
{
  const qTable = createQTable();
  const stateBesideGoal = [13, 8]; // State adjacent to goal
  const goalState = [14, 8];

  // In base_reference_model.ipynb:
  // Step 1: Terminal move to goal
  // target = finished ? reward : reward + gamma * max(next)
  // target = 10
  // oldScore = 0.0
  // newScore = oldScore + learning_rate * (target - oldScore) = 0.0 + 0.1 * (10 - 0) = 1.0
  const actionRight = 3; // 'right'
  const newScore = learn(stateBesideGoal, actionRight, goalState, 10, true, qTable, 0.1, 0.95);
  assertClose(newScore, 1.0, 1e-6, 'Terminal move update matches notebook: 0.0 -> 1.0');

  // Step 2: Practice another move from state beside goal to goal:
  // target = 10
  // oldScore = 1.0
  // newScore = 1.0 + 0.1 * (10 - 1.0) = 1.9
  const score2 = learn(stateBesideGoal, actionRight, goalState, 10, true, qTable, 0.1, 0.95);
  assertClose(score2, 1.9, 1e-6, 'Second terminal move update matches notebook: 1.0 -> 1.9');

  // Step 3: Non-terminal move from [12, 8] moving right into [13, 8]
  // maxNextQ = max(qTable[posToState([13, 8])]) = 1.9
  // target = reward + gamma * maxNextQ = -1 + 0.95 * 1.9 = -1 + 1.805 = 0.805
  // oldScore = 0.0
  // newScore = 0.0 + 0.1 * (0.805 - 0.0) = 0.0805
  const stateTwoAway = [12, 8];
  const score3 = learn(stateTwoAway, actionRight, stateBesideGoal, -1, false, qTable, 0.1, 0.95);
  assertClose(score3, 0.0805, 1e-6, 'Non-terminal Bellman discount update: 0.0 -> 0.0805');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 4: Epsilon-Greedy Action Selection & Tie-Breaking
// ----------------------------------------------------------------------------
console.log('TEST 4: Action Selection (chooseAction)');
{
  const qTable = createQTable();
  const testPos = [5, 0];
  const testState = posToState(testPos);

  // 1. Pure exploitation (epsilon = 0.0)
  qTable[testState] = [0.2, 0.8, -0.1, 0.5]; // Action 1 ('down') is strictly best
  for (let i = 0; i < 20; i++) {
    const act = chooseAction(testPos, qTable, 0.0);
    assert(act === 1, 'Exploitation consistently chooses highest Q-score action (action 1: down)');
  }

  // 2. Tie-breaking between multiple max scores
  qTable[testState] = [1.5, 0.0, 1.5, 0.0]; // Action 0 ('up') and Action 2 ('left') tie
  const choices = new Set();
  for (let i = 0; i < 100; i++) {
    const act = chooseAction(testPos, qTable, 0.0);
    assert(act === 0 || act === 2, 'Tie-breaking picks only among tied maximal actions (0 or 2)');
    choices.add(act);
  }
  assert(choices.has(0) && choices.has(2), 'Tie-breaking randomly selects both candidates across 100 trials');

  // 3. Pure exploration (epsilon = 1.0)
  const exploredActions = new Set();
  for (let i = 0; i < 200; i++) {
    exploredActions.add(chooseAction(testPos, qTable, 1.0));
  }
  assert(exploredActions.size === 4, 'Pure exploration (epsilon=1.0) explores all 4 discrete actions');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 5: 2D Manhattan A* Pathfinding Around Storage Racks
// ----------------------------------------------------------------------------
console.log('TEST 5: 2D Manhattan A* Pathfinding Around Storage Racks');
{
  // Path from [3, 2] to [6, 2].
  // Rack Bay 1 blocks straight line at [4, 2] and [5, 2]!
  const start = [3, 2];
  const goal = [6, 2];
  const path = findPathAStar(start, goal, DEFAULT_RACKS, GRID_WIDTH, GRID_HEIGHT);

  assert(path.length > 0, 'A* successfully finds path around storage rack bay');
  assert(path[0][0] === start[0] && path[0][1] === start[1], 'Path starts at exact start position');
  assert(path[path.length - 1][0] === goal[0] && path[path.length - 1][1] === goal[1], 'Path terminates at exact goal');

  // Verify no step traverses a rack
  let hitRackOnPath = false;
  for (const pt of path) {
    if (isRack(pt[0], pt[1], DEFAULT_RACKS)) {
      hitRackOnPath = true;
      break;
    }
  }
  assert(!hitRackOnPath, 'Every waypoint in A* path is completely obstacle-free');

  // Check start == goal edge case
  const selfPath = findPathAStar([2, 2], [2, 2], DEFAULT_RACKS);
  assert(selfPath.length === 1 && selfPath[0][0] === 2 && selfPath[0][1] === 2, 'A* handles start == goal gracefully');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 6: Multi-Robot Fleet Collision Avoidance & Right-Of-Way
// ----------------------------------------------------------------------------
console.log('TEST 6: Multi-Robot Collision Avoidance & Priority Yielding');
{
  const fleet = createRobotFleet();
  assert(fleet.length === 4, 'Fleet contains exactly 4 robots: R1, R2, R3, R4');

  // Test Case A: Target cell conflict between R1 (index 0) and R2 (index 1)
  // Both R1 at [1, 1] and R2 at [1, 3] plan to move to [1, 2]
  fleet[0].pos = [1, 1];
  fleet[0].targetPos = [1, 2];
  fleet[0].path = [[1, 2]];
  fleet[0].status = 'idle';

  fleet[1].pos = [1, 3];
  fleet[1].targetPos = [1, 2];
  fleet[1].path = [[1, 2]];
  fleet[1].status = 'idle';

  // R3 and R4 stay stationary
  fleet[2].pos = [15, 0]; fleet[2].path = []; fleet[2].targetPos = null;
  fleet[3].pos = [15, 1]; fleet[3].path = []; fleet[3].targetPos = null;

  const statsA = { tickCount: 0, collisionsAvoided: 0, chargerUtilization: 0, totalChargingTicks: 0 };
  stepSimulationTick(fleet, DEFAULT_RACKS, DEFAULT_CHARGING_DOCKS, statsA);

  assert(fleet[0].pos[0] === 1 && fleet[0].pos[1] === 2, 'R1 (lower index) wins right-of-way and moves to [1, 2]');
  assert(fleet[1].pos[0] === 1 && fleet[1].pos[1] === 3, 'R2 (competing robot) yields and remains at [1, 3]');
  assert(fleet[1].isYielding === true, 'R2 yield halo is activated (isYielding = true)');
  assert(fleet[1].status === 'yielding', 'R2 status is set to yielding');
  assert(statsA.collisionsAvoided === 1, 'collisionsAvoided KPI counter increments by 1');

  // Test Case B: Delivery priority right-of-way
  // R2 has status = 'delivering', R1 has status = 'idle'.
  // Both attempt to step into [2, 5].
  fleet[0].pos = [2, 4];
  fleet[0].path = [[2, 5]];
  fleet[0].status = 'idle';
  fleet[0].isYielding = false;

  fleet[1].pos = [2, 6];
  fleet[1].path = [[2, 5]];
  fleet[1].status = 'delivering';
  fleet[1].isYielding = false;

  const statsB = { tickCount: 0, collisionsAvoided: 0, chargerUtilization: 0, totalChargingTicks: 0 };
  stepSimulationTick(fleet, DEFAULT_RACKS, DEFAULT_CHARGING_DOCKS, statsB);

  assert(fleet[1].pos[0] === 2 && fleet[1].pos[1] === 5, 'R2 with active delivery wins right-of-way over R1');
  assert(fleet[0].pos[0] === 2 && fleet[0].pos[1] === 4, 'R1 yields to delivering robot');
  assert(fleet[0].isYielding === true, 'R1 yield halo activated');
  assert(statsB.collisionsAvoided === 1, 'collisionsAvoided counter incremented on delivery priority conflict');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 7: Dynamic Battery Drain & Charging Traffic Management
// ----------------------------------------------------------------------------
console.log('TEST 7: Battery Drain & Charging Traffic Management');
{
  const fleet = createRobotFleet();
  const robot = fleet[0];
  robot.pos = [1, 1];
  robot.path = [[1, 2]];
  robot.targetPos = [1, 2];
  robot.battery = 100;

  const stats = { tickCount: 0, collisionsAvoided: 0, chargerUtilization: 0, totalChargingTicks: 0 };
  stepSimulationTick(fleet, DEFAULT_RACKS, DEFAULT_CHARGING_DOCKS, stats);

  // 0.8% drain per movement step
  assertClose(robot.battery, 99.2, 0.05, 'Battery drains by exactly 0.8% on movement step (100 -> 99.2%)');

  // Low battery threshold (< 20%): auto-route to least congested dock at x = 0
  robot.pos = [8, 8];
  robot.battery = 18.0; // below 20%
  robot.status = 'idle';
  robot.path = [];
  robot.targetPos = [14, 8];

  stepSimulationTick(fleet, DEFAULT_RACKS, DEFAULT_CHARGING_DOCKS, stats);
  assert(robot.status === 'charging', 'Robot with battery < 20% transitions to "charging" status');
  assert(robot.targetPos[0] === 0, 'Robot routes to charging dock at x = 0');
  assert(robot.path.length > 0, 'A* path generated leading towards charging dock');

  // Dock arrival & recharging (+10% per tick)
  robot.pos = [DEFAULT_CHARGING_DOCKS[0][0], DEFAULT_CHARGING_DOCKS[0][1]];
  robot.targetPos = [DEFAULT_CHARGING_DOCKS[0][0], DEFAULT_CHARGING_DOCKS[0][1]];
  robot.path = [];
  robot.battery = 50.0;

  stepSimulationTick(fleet, DEFAULT_RACKS, DEFAULT_CHARGING_DOCKS, stats);
  assertClose(robot.battery, 60.0, 0.05, 'Docked robot recharges by +10% per tick (50 -> 60%)');
  assert(stats.chargerUtilization > 0, 'Charger utilization % KPI is tracked when dock is occupied');

  // Fully recharged to 100% resumes queue
  robot.battery = 95.0;
  robot.orderId = 'ORD-101';
  robot.previousStatus = 'picking';
  stepSimulationTick(fleet, DEFAULT_RACKS, DEFAULT_CHARGING_DOCKS, stats);
  assert(robot.battery === 100 || robot.battery === 99.2, 'Recharging caps cleanly at 100% (or 99.2% after initial departure step)');
  assert(robot.status === 'picking', 'Recharged robot resumes previous task ("picking")');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 8: Fast Background Training (100 Episodes Convergence)
// ----------------------------------------------------------------------------
console.log('TEST 8: Fast Background Q-Learning Training (100 Episodes)');
{
  const qTable = createQTable();
  const trainResult = fastTrain(100, null, {
    qTable,
    racks: DEFAULT_RACKS,
    goal: DEFAULT_GOAL,
  });

  assert(trainResult.episodes === 100, 'Completed all 100 fast training episodes');
  assert(trainResult.successfulAttempts > 0, 'Achieved successful goal-reaching attempts during training');

  // Verify that state directly left of goal [13, 8] has high score for moving RIGHT (action 3)
  const besideGoalIdx = posToState([13, 8]);
  const actionRightScore = qTable[besideGoalIdx][3];
  console.log(`  Q-score at [13, 8] for moving RIGHT: ${actionRightScore.toFixed(3)}`);
  assert(actionRightScore > 0, 'Q-value for moving RIGHT from adjacent state [13, 8] visibly converged to positive reward');

  // Verify greedy policy at [13, 8] picks action 3 (RIGHT)
  const bestAction = chooseAction([13, 8], qTable, 0.0);
  assert(bestAction === 3, 'Greedy policy at [13, 8] chooses action 3 ("right") directly into goal');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 9: Model JSON I/O (Exact base_reference_model.ipynb Contract)
// ----------------------------------------------------------------------------
console.log('TEST 9: Model JSON Export & Import (Notebook Contract)');
{
  const originalQ = createQTable();
  originalQ[posToState([13, 8])][3] = 8.55;

  const exportedString = exportModelJSON(originalQ, {
    goal: DEFAULT_GOAL,
    stepReward: -1,
    goalReward: 10,
    discountFactor: 0.95,
  });

  assert(typeof exportedString === 'string', 'exportModelJSON returns valid string');
  const parsed = JSON.parse(exportedString);

  // Check exact schema from base_reference_model.ipynb
  assert(Array.isArray(parsed.q_table), 'JSON contains "q_table" array');
  assert(parsed.q_table.length === 160, 'JSON "q_table" has 160 states');
  assert(Array.isArray(parsed.actions), 'JSON contains "actions" array');
  assert(parsed.actions.length === 4, 'JSON "actions" has 4 action names');
  assert(parsed.goal[0] === 14 && parsed.goal[1] === 8, 'JSON contains exact goal [14, 8]');
  assert(parsed.step_reward === -1, 'JSON contains step_reward = -1');
  assert(parsed.goal_reward === 10, 'JSON contains goal_reward = 10');
  assert(parsed.discount_factor === 0.95, 'JSON contains discount_factor = 0.95');

  // Import model back
  const imported = importModelJSON(exportedString);
  assert(imported.qTable.length === 160, 'importModelJSON properly parses 160 states');
  assertClose(
    imported.qTable[posToState([13, 8])][3],
    8.55,
    1e-6,
    'Imported model preserves exact Q-table floating point values'
  );
  assert(imported.goal[0] === 14 && imported.goal[1] === 8, 'Imported model preserves goal');
  assert(imported.discountFactor === 0.95, 'Imported model preserves discount factor');
}
console.log('');

// ----------------------------------------------------------------------------
// TEST 10: SimulationEngine Class Orchestration & Reactive Subscriptions
// ----------------------------------------------------------------------------
console.log('TEST 10: SimulationEngine Service Class');
{
  const engine = new SimulationEngine();
  assert(engine.robots.length === 4, 'SimulationEngine initializes 4 robots');

  let notificationsReceived = 0;
  const unsubscribe = engine.subscribe((state) => {
    notificationsReceived++;
    assert(state.robots.length === 4, 'Subscriber receives full robot fleet state');
  });

  engine.step();
  assert(notificationsReceived === 1, 'Subscriber notified on engine.step()');

  engine.fastTrain(10);
  assert(notificationsReceived === 2, 'Subscriber notified on engine.fastTrain()');

  unsubscribe();
  engine.step();
  assert(notificationsReceived === 2, 'Unsubscribe stops receiving notifications');
}
console.log('');

// ----------------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------------
console.log('============================================================');
console.log(`TOTAL TESTS PASSED: ${passedTests}`);
console.log(`TOTAL TESTS FAILED: ${failedTests}`);
console.log('============================================================');

if (failedTests === 0) {
  console.log('\nALL VERIFICATION TESTS COMPLETED SUCCESSFULLY! ZERO REGRESSIONS.');
} else {
  console.error('\nSOME TESTS FAILED.');
  process.exit(1);
}
