// Bubbles over robots on the map.
// SpeechBubble: a short line for a real moment (pick, delivery, yield…); pops in and fades out by itself.
// ThoughtBubble: only on the selected robot; one bold arrow for the move it is about to make, tagged Q
// (learned policy) or A* (pathfinding). A selected robot never shows speech bubbles, so the two are
// never confused.
import { nextMove } from '../lib/chatter';

// 7x7 pixel arrows pointing in each direction.
const ARROWS = {
  up: 'M3 0h1v1h-1zM2 1h3v1h-3zM1 2h5v1h-5zM0 3h7v1h-7zM2 4h3v3h-3z',
  down: 'M2 0h3v3h-3zM0 3h7v1h-7zM1 4h5v1h-5zM2 5h3v1h-3zM3 6h1v1h-1z',
  left: 'M0 3h1v1h-1zM1 2h1v3h-1zM2 1h1v5h-1zM3 0h1v7h-1zM4 2h3v3h-3z',
  right: 'M6 3h1v1h-1zM5 2h1v3h-1zM4 1h1v5h-1zM3 0h1v7h-1zM0 2h3v3h-3z',
};

export function SpeechBubble({ chatter }) {
  return <span key={chatter.tick} className={`speech-bubble kind-${chatter.kind}`} aria-hidden="true">{chatter.text}</span>;
}

export function ThoughtBubble({ robot, routingMode }) {
  const move = nextMove(robot);
  if (!move) return null;
  const learned = routingMode !== 'astar' && !robot.fallback_leg && Boolean(robot.q_scores);
  return (
    <span className="thought-bubble" aria-hidden="true">
      <span className="thought-cloud">
        <svg className="thought-arrow" viewBox="0 0 7 7" shapeRendering="crispEdges"><path d={ARROWS[move]} /></svg>
        <span className={`thought-source ${learned ? 'is-q' : 'is-astar'}`}>{learned ? 'Q' : 'A*'}</span>
      </span>
      <span className="thought-dot thought-dot-1" />
      <span className="thought-dot thought-dot-2" />
    </span>
  );
}
