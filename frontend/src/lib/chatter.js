// Robot "life" derived from the session stream, as pure functions (no timers, no randomness):
// speech bubbles for real moments, yield reactions between robots, and faint footprint trails.
import { hashString } from './robotNames';

export const BUBBLE_TICKS = 4; // a speech bubble lasts about 2.4 s at 1x
export const REACTION_TICKS = 2;
const CHATTER_COOLDOWN = 12; // ticks before the same robot may speak again
const MAX_BUBBLES = 2; // never more than two robots talking at once
export const TRAIL_TICKS = 6;

const LINES = {
  assigned: ['on it!', 'got one!', 'heading out', "let's go!"],
  picked: ['got it!', 'nice grab', 'one down', 'gotcha'],
  packed: ['boxed!', 'taped up', 'packed!'],
  delivered: ['shipped!', 'woo!', 'delivered!', 'next!'],
  low: ['need juice…', 'low battery', 'brb, charging'],
  charged: ['all charged!', 'zap!', 'back to work'],
  reroute: ['rerouting…', 'hmm, detour', 'plan B'],
  yield: ['after you!', 'oops, sorry', 'you first'],
  thanks: ['thanks!', 'cheers!', 'ty!'],
  lifted: ['heavy!', 'hup!', 'oof, pallet', 'got the load'],
  restocked: ['restocked!', 'shelf full', 'fresh stock!', 'all topped up'],
};
// Percent chance a robot speaks for each kind of moment (yields always get a reaction).
const CHANCE = { assigned: 40, picked: 35, packed: 35, delivered: 60, low: 80, charged: 50, reroute: 70, yield: 100, thanks: 100, lifted: 50, restocked: 60 };
const EVENT_KINDS = {
  order_assigned: 'assigned', picked: 'picked', packed: 'packed', delivered: 'delivered',
  to_charger: 'low', charged: 'charged', fallback: 'reroute', pallet_loaded: 'lifted', restocked: 'restocked',
};

const roll = (robotId, tick, kind) => hashString(`${robotId}:${tick}:${kind}`) % 100;
export const lineFor = (kind, robotId, tick) => LINES[kind][hashString(`${kind}|${robotId}|${tick}`) % LINES[kind].length];

// The robot a yielding robot is waiting for: whoever stands on, or next to, its next cell.
export function blockerOf(robot, robots) {
  const next = robot.path?.[0] ?? [robot.x, robot.y];
  let best = null;
  for (const other of robots) {
    if (other.id === robot.id) continue;
    const distance = Math.abs(other.x - next[0]) + Math.abs(other.y - next[1]);
    if (distance <= 1 && (!best || distance < best.distance)) best = { id: other.id, distance };
  }
  return best?.id ?? null;
}

// New speech bubbles and reactions for one frame. `previous` maps robot id -> { kind, text, tick }.
export function chatterFrom({ previous, events, prevRobots, robots, tick }) {
  let chatter = previous;
  const reactions = [];
  const talking = () => Object.values(chatter).filter((c) => tick - c.tick < BUBBLE_TICKS).length;
  const say = (robotId, kind) => {
    const last = chatter[robotId];
    if (last && tick - last.tick < CHATTER_COOLDOWN) return false;
    if (talking() >= MAX_BUBBLES) return false;
    if (roll(robotId, tick, kind) >= CHANCE[kind]) return false;
    if (chatter === previous) chatter = { ...previous };
    chatter[robotId] = { kind, text: lineFor(kind, robotId, tick), tick };
    return true;
  };

  // Yields first: the waiting robot apologises and the one it waits for thanks it with a nod.
  const before = Object.fromEntries((prevRobots ?? []).map((r) => [r.id, r]));
  for (const robot of robots) {
    if (!robot.yielding || !before[robot.id] || before[robot.id].yielding) continue;
    const blocker = blockerOf(robot, robots);
    if (say(robot.id, 'yield') && blocker && say(blocker, 'thanks')) reactions.push(blocker);
  }
  for (const event of events) {
    const kind = EVENT_KINDS[event.type];
    if (kind && event.robot) say(event.robot, kind);
  }
  return { chatter, reactions };
}

const MOVES = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right' };

// The robot's next move ('up' | 'down' | 'left' | 'right'), or null when it has nowhere to go.
export function nextMove(robot) {
  const step = robot.path?.[0];
  if (!step) return null;
  return MOVES[`${step[0] - robot.x},${step[1] - robot.y}`] ?? null;
}

// Footprints: the cells each robot just left, kept for a few ticks so they can fade out.
export function trailsFrom(previous, prevRobots, robots, tick) {
  const before = Object.fromEntries((prevRobots ?? []).map((r) => [r.id, r]));
  const next = {};
  for (const robot of robots) {
    const steps = (previous[robot.id] ?? []).filter((p) => tick - p.tick < TRAIL_TICKS);
    const was = before[robot.id];
    if (was && (was.x !== robot.x || was.y !== robot.y)) {
      steps.push({ x: was.x, y: was.y, tick, dx: robot.x - was.x, dy: robot.y - was.y });
    }
    next[robot.id] = steps.slice(-TRAIL_TICKS);
  }
  return next;
}
