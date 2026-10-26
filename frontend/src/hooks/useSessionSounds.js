import { useCallback, useEffect, useRef, useState } from 'react';
import { robotVoice } from '../lib/robotNames';
import { sound } from '../lib/sound';

const EVENT_SOUNDS = { delivered: 'delivered', picked: 'picked', packed: 'packed', charged: 'charged' };
const PREFS_KEY = 'roboware.audio';
const DEFAULT_PREFS = { music: true, sfx: true };

function readPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

// Music and sound-effect switches, remembered in this browser.
export function useAudioPrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  const toggle = useCallback((key) => setPrefs((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable (private mode); the switch still works for this visit
    }
    return next;
  }), []);
  return [prefs, toggle];
}

// Plays effects for the warehouse events in each frame and runs the music while the simulation runs.
// Robot events and speech use that robot's own voice pitch. Events that arrive with the first snapshot
// (already in the past) stay silent; the selected robot shows a thought bubble instead of talking.
export function useSessionSounds({ events, status, ready, prefs, chatter, tick, quietRobotId }) {
  const wasReady = useRef(false);

  useEffect(() => { sound.setMusicEnabled(prefs.music); }, [prefs.music]);
  useEffect(() => { sound.setSfxEnabled(prefs.sfx); }, [prefs.sfx]);
  useEffect(() => { sound.setRunning(status === 'running'); }, [status]);
  useEffect(() => () => sound.setRunning(false), []);

  useEffect(() => {
    if (!ready) {
      wasReady.current = false;
      return;
    }
    if (!wasReady.current) {
      wasReady.current = true;
      return;
    }
    for (const event of events) {
      if (event.type === 'order_created') sound.play(event.priority === 'rush' ? 'rush' : 'order');
      else if (EVENT_SOUNDS[event.type]) sound.play(EVENT_SOUNDS[event.type], event.robot ? robotVoice(event.robot) : 0);
    }
  }, [events, ready]);

  // A robot that just started a speech bubble babbles in its own voice.
  useEffect(() => {
    if (!ready || !chatter) return;
    for (const [robotId, line] of Object.entries(chatter)) {
      if (line.tick === tick && robotId !== quietRobotId) sound.play('chatter', robotVoice(robotId));
    }
  }, [chatter, tick, ready, quietRobotId]);
}
