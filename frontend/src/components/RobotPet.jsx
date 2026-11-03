import { useEffect, useId, useRef, useState } from 'react';
import { botEyes, botTask, headingGlance, isWalking, petMood, zPath } from '../lib/pet';
import { pixelPath } from '../lib/pixelArt';

const FLOURISHES = ['look-left', 'look-right', 'smile', 'hop'];
const EYES_CLOSED = new Set(['snooze', 'charge']);
// "zzZ": three pixel z's growing as they drift up and away from the head.
const ZZZ = [zPath(13, 0.5, 0.36), zPath(14.6, -1.8, 0.5), zPath(16.4, -4.6, 0.7)];
const BOLT = pixelPath(['..BB', '.BB.', 'BBBB', '.BB.', 'BB..', 'B...']);
// Pixel outlines (B = filled) placed at an offset, for the rounded head, visor and torso.
const shape = (rows, ox, oy) => rows.flatMap((row, y) => [...row].map((p, x) => (p === 'B' ? `M${ox + x} ${oy + y}h1v1h-1z` : ''))).join('');
const HEAD = shape(['.BBBBBBBB.', 'BBBBBBBBBB', 'BBBBBBBBBB', 'BBBBBBBBBB', 'BBBBBBBBBB', '.BBBBBBBB.'], 3, 2);
const VISOR = shape(['.BBBBBB.', 'BBBBBBBB', 'BBBBBBBB', '.BBBBBB.'], 4, 3);
const TORSO = shape(['.BBBBBB.', 'BBBBBBBB', 'BBBBBBBB', '.BBBBBB.'], 4, 9);
const TREADS = shape(['.BBBBBBBB.', 'BBBBBBBBBB', 'BBBBBBBBBB', '.BBBBBBBB.'], 3, 13);
// Light colour of the antenna for each mood.
const LED = { idle: '#7fd8a6', walk: '#7fd8a6', focus: '#f2c14e', charge: '#ffe066', happy: '#8ff0ff', surprised: '#ffb15c', tired: '#ff5a5a', snooze: '#56616d' };
const EYE = { tired: '#ffc46b', surprised: '#ffffff', snooze: '#5f7a8a' };

// A robot drawn as a pixel warehouse droid in its own colour: antenna light, glowing visor face, chest
// lights, jointed arms with claws and a tread base. Every action has its own smooth animation (see
// "WAREHOUSE DROID" in index.css): it drives, reaches for shelves, tapes boxes, lifts pallets, charges,
// naps, cheers, jumps when startled and sags when its battery is low. Now and then it blinks, looks around,
// smiles or hops on its own.
export function RobotPet({ robot, cheer, tick, nodding = false }) {
  const [flourish, setFlourish] = useState(null);
  const clip = useId().replace(/:/g, '');
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
  const snoozing = mood === 'snooze';
  const task = botTask(robot);
  // A dozing robot fades towards grey so busy robots stand out.
  const paint = snoozing ? `color-mix(in srgb, ${robot.color} 40%, #46515c)` : robot.color;
  const style = { '--bot': paint, '--bot-dark': `color-mix(in srgb, ${paint} 62%, #0b0f14)`, '--bot-light': `color-mix(in srgb, ${paint} 65%, #ffffff)`, '--led': LED[mood] ?? LED.idle, '--eye': EYE[face] ?? '#8ff0ff' };
  const classes = ['robot-art', 'robot-pet', 'bot', `bot-${mood}`, task && `bot-task-${task}`, walking && 'pet-walking', snoozing && 'pet-snooze',
    nodding && 'pet-nod', flourish === 'hop' && !walking && !asleep && 'pet-hop'].filter(Boolean).join(' ');
  return (
    <svg className={classes} viewBox="-1.5 -1.5 19 19" shapeRendering="crispEdges" aria-hidden="true" data-face={face} style={style}>
      <defs>
        <clipPath id={`tread-${clip}`}><path d={TREADS} /></clipPath>
      </defs>
      <ellipse className="bot-shadow" cx="8" cy="16.9" rx="5.6" ry="0.75" />
      <g className="bot-body">
        {/* Treads: a dark base with lighter cleats that roll while driving. */}
        <g className="bot-treads">
          <path d={TREADS} fill="#262b33" />
          <g clipPath={`url(#tread-${clip})`}>
            <g className="bot-cleats" fill="#4a5361">
              {[-1, 1, 3, 5, 7, 9, 11, 13, 15].map((x) => <rect key={x} x={x} y="13" width="1" height="4" />)}
            </g>
          </g>
          <rect x="4.5" y="14.2" width="1.4" height="1.4" fill="#8d97a5" />
          <rect x="10.1" y="14.2" width="1.4" height="1.4" fill="#8d97a5" />
        </g>
        {/* Torso with a chest panel of little lights. */}
        <path d={TORSO} style={{ fill: 'var(--bot)' }} />
        <rect x="4" y="12" width="8" height="1" style={{ fill: 'var(--bot-dark)' }} />
        <rect x="5.7" y="10" width="4.6" height="1.5" fill="#14181d" />
        <g className="bot-chest">
          <rect className="c1" x="6.2" y="10.4" width="0.8" height="0.7" fill="#7fd8a6" />
          <rect className="c2" x="7.6" y="10.4" width="0.8" height="0.7" fill="#f2c14e" />
          <rect className="c3" x="9" y="10.4" width="0.8" height="0.7" fill="#ff7a59" />
        </g>
        <rect x="7" y="8" width="2" height="1" fill="#2f3640" />
        {/* Head: antenna, shell, visor with the eyes. */}
        <g className="bot-head">
          <g className="bot-antenna">
            <rect x="7.6" y="0" width="0.8" height="2.2" fill="#3a414c" />
            <rect className="bot-led" x="7" y="-1.4" width="2" height="1.8" style={{ fill: 'var(--led)' }} />
          </g>
          <path d={HEAD} style={{ fill: 'var(--bot)' }} />
          <rect x="4" y="2" width="6" height="0.6" style={{ fill: 'var(--bot-light)' }} />
          <rect x="3" y="7" width="10" height="1" style={{ fill: 'var(--bot-dark)' }} />
          <rect x="2.4" y="4" width="0.7" height="2" fill="#3a414c" />
          <rect x="12.9" y="4" width="0.7" height="2" fill="#3a414c" />
          <path className="bot-visor" d={VISOR} fill="#10151b" />
          {face === 'charge' && (
            <g className="bot-battery">
              <rect x="5.3" y="3.6" width="5.4" height="0.9" fill="none" stroke="#ffe066" strokeWidth="0.25" />
              <rect className="bot-battery-fill" x="5.55" y="3.85" width="4.9" height="0.4" fill="#ffe066" />
            </g>
          )}
          <g className="bot-eyes" style={{ fill: 'var(--eye)' }}>
            {botEyes(face, glance).map(([x, y, w, h]) => <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} />)}
          </g>
          {face === 'focus' && <rect className="bot-scan" x="5" y="3.4" width="6" height="0.3" fill="#8ff0ff" opacity="0.6" />}
        </g>
        {/* Arms hang from the shoulders and pivot there; drawn last so they stay in front when raised. */}
        <g className="bot-arm bot-arm-l">
          <rect x="2" y="9.3" width="1.6" height="3" style={{ fill: 'var(--bot-dark)' }} />
          <rect x="1.5" y="12.1" width="2.6" height="0.9" fill="#3a414c" />
          <rect x="1.5" y="12.8" width="0.8" height="0.9" fill="#3a414c" />
          <rect x="3.3" y="12.8" width="0.8" height="0.9" fill="#3a414c" />
        </g>
        <g className="bot-arm bot-arm-r">
          <rect x="12.4" y="9.3" width="1.6" height="3" style={{ fill: 'var(--bot-dark)' }} />
          <rect x="11.9" y="12.1" width="2.6" height="0.9" fill="#3a414c" />
          <rect x="11.9" y="12.8" width="0.8" height="0.9" fill="#3a414c" />
          <rect x="13.7" y="12.8" width="0.8" height="0.9" fill="#3a414c" />
        </g>
      </g>
      {snoozing && (
        <g className="pet-zzz" fill="#d6e4f5">
          {ZZZ.map((d, i) => <path key={d} className={`pet-z z${i + 1}`} d={d} />)}
        </g>
      )}
      {face === 'charge' && <path className="pet-bolt" d={BOLT} transform="translate(12.4 -1.4) scale(0.55)" fill="#f2c14e" />}
      {face === 'surprised' && (
        <g className="bot-alert" fill="#ffb15c"><rect x="14" y="-1.4" width="1" height="2.4" /><rect x="14" y="1.5" width="1" height="0.9" /></g>
      )}
      {face === 'tired' && <rect className="bot-sweat" x="1.6" y="2.6" width="0.8" height="1.1" fill="#8ec5ff" />}
      {face === 'happy' && (
        <g className="bot-sparkles" fill="#fff3b0">
          <rect className="s1" x="0.4" y="0.6" width="0.8" height="0.8" />
          <rect className="s2" x="14.6" y="1.2" width="0.8" height="0.8" />
          <rect className="s3" x="15.4" y="5.8" width="0.6" height="0.6" />
        </g>
      )}
    </svg>
  );
}
