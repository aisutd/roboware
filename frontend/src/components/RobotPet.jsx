import { useEffect, useRef, useState } from 'react';
import { PET_BODY, PET_LEGS_A, PET_LEGS_B, eyeRects, headingGlance, isWalking, petMood, zPath } from '../lib/pet';
import { pixelPath } from '../lib/pixelArt';

const EYE = '#14181d';
const FLOURISHES = ['look-left', 'look-right', 'smile', 'hop'];
const EYES_CLOSED = new Set(['snooze', 'charge']);
// "zzZ": three pixel z's growing as they drift up and away from the head.
const ZZZ = [zPath(10, -1.3, 0.32), zPath(11.3, -3.5, 0.46), zPath(12.8, -6.4, 0.66)];
const BOLT = pixelPath(['..BB', '.BB.', 'BBBB', '.BB.', 'BB..', 'B...']);

// A robot drawn as a pixel pet in its own colour. It walks while travelling, shows a face for what
// it is doing, dozes off with a "zzZ" when it has nothing to do, and now and then blinks, looks
// around, smiles or hops on its own.
export function RobotPet({ robot, cheer, tick, nodding = false }) {
  const [flourish, setFlourish] = useState(null);
  const mood = petMood(robot, cheer, tick);
  const moodRef = useRef(mood);
  useEffect(() => { moodRef.current = mood; }, [mood]);

  useEffect(() => {
    let alive = true;
    let timer;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        // Busy or sleepy robots only blink; idle and travelling ones sometimes do something more.
        const calm = moodRef.current === 'idle' || moodRef.current === 'walk';
        const next = calm && Math.random() < 0.3 ? FLOURISHES[Math.floor(Math.random() * FLOURISHES.length)] : 'blink';
        setFlourish(next);
        timer = setTimeout(() => {
          if (!alive) return;
          setFlourish(null);
          schedule();
        }, next === 'blink' ? 140 : 900);
      }, 2200 + Math.random() * 4200);
    };
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  let face = mood;
  let glance = mood === 'walk' ? headingGlance(robot.heading) : [0, 0];
  const asleep = EYES_CLOSED.has(mood);
  if (flourish === 'smile' && !asleep) face = 'happy';
  if (flourish === 'blink' && mood !== 'happy' && !asleep) face = 'blink';
  if ((flourish === 'look-left' || flourish === 'look-right') && !asleep) glance = [flourish === 'look-left' ? -1 : 1, 0];

  const walking = isWalking(robot);
  const snoozing = face === 'snooze';
  // A dozing robot fades towards grey so busy robots stand out.
  const body = { fill: snoozing ? `color-mix(in srgb, ${robot.color} 40%, #46515c)` : robot.color };
  const classes = ['robot-art', 'robot-pet', walking && 'pet-walking', snoozing && 'pet-snooze', nodding && 'pet-nod',
    flourish === 'hop' && !walking && !asleep && 'pet-hop'].filter(Boolean).join(' ');
  return (
    <svg className={classes} viewBox="-1 -3 14 14" shapeRendering="crispEdges" aria-hidden="true" data-face={face}>
      <g className="pet-breath">
        <path d={PET_BODY} style={body} />
        {eyeRects(face, glance).map(([x, y, w, h]) => <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} fill={EYE} />)}
      </g>
      <path className="pet-legs-a" d={PET_LEGS_A} style={body} />
      <path className="pet-legs-b" d={PET_LEGS_B} style={body} />
      {snoozing && (
        <g className="pet-zzz" fill="#d6e4f5">
          {ZZZ.map((d, i) => <path key={d} className={`pet-z z${i + 1}`} d={d} />)}
        </g>
      )}
      {face === 'charge' && <path className="pet-bolt" d={BOLT} transform="translate(10.3 -3) scale(0.42)" fill="#f2c14e" />}
      {face === 'surprised' && (
        <g fill="var(--amber)"><rect x="10.5" y="-2.8" width="0.5" height="1.3" /><rect x="10.5" y="-1.2" width="0.5" height="0.45" /></g>
      )}
      {face === 'tired' && (
        <g fill="#8ec5ff"><rect x="1.05" y="-0.6" width="0.4" height="0.4" /><rect x="0.85" y="-0.2" width="0.8" height="0.8" /></g>
      )}
    </svg>
  );
}
