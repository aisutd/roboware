// 8-bit sound for the session, synthesised live with the Web Audio API (no audio files):
// short chiptune effects for warehouse events and a slow, generated lo-fi background loop.
import { createSfxGate } from './sfxGate';

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const MUSIC_LEVEL = 0.2;
const SFX_LEVEL = 0.55;

// Sound effects: (engine, start time) => schedules a few short tones.
const SFX = {
  order: (e, t) => { e.tone(88, t, 0.07, 0.16, 'triangle'); e.tone(93, t + 0.08, 0.1, 0.14, 'triangle'); },
  rush: (e, t) => { e.tone(81, t, 0.08, 0.08); e.tone(76, t + 0.1, 0.08, 0.08); e.tone(81, t + 0.2, 0.13, 0.08); },
  delivered: (e, t) => { [84, 88, 91].forEach((n, i) => e.tone(n, t + i * 0.065, 0.07, 0.07)); e.tone(96, t + 0.2, 0.2, 0.07); },
  picked: (e, t) => e.tone(96, t, 0.04, 0.06, 'triangle'),
  packed: (e, t) => e.tone(57, t, 0.12, 0.08, 'square', 45),
  charged: (e, t) => [72, 76, 79].forEach((n, i) => e.tone(n, t + i * 0.08, 0.1, 0.07, 'triangle')),
  click: (e, t) => e.tone(91, t, 0.02, 0.035),
  select: (e, t) => { e.tone(79, t, 0.035, 0.05); e.tone(86, t + 0.045, 0.05, 0.05); },
  // A robot "talking": three quick soft blips, sung at that robot's own pitch.
  chatter: (e, t) => [0, 3, -2].forEach((step, i) => e.tone(76 + step, t + i * 0.065, 0.045, 0.035, 'square')),
};

// Saved Music / SFX switches (see useAudioPrefs), so they apply in every view from the start.
function storedPrefs() {
  try {
    return { music: true, sfx: true, ...JSON.parse(localStorage.getItem('roboware.audio') ?? '{}') };
  } catch {
    return { music: true, sfx: true };
  }
}

// Music: four bars per loop, one seventh chord per bar, slowly descending.
const BPM = 76;
const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
const PENTATONIC = [72, 74, 76, 79, 81, 84];

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.gate = createSfxGate();
    const prefs = typeof localStorage === 'undefined' ? { music: true, sfx: true } : storedPrefs();
    this.sfxEnabled = prefs.sfx;
    this.musicEnabled = prefs.music;
    this.running = false;
    this.timer = null;
    this.shift = 0; // semitones added to effect notes while playing a robot's sound
  }

  // Lazily builds the audio graph: master <- sfx bus, master <- music bus (lowpass + echo).
  ensure() {
    if (this.ctx) return this.ctx;
    const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = SFX_LEVEL;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 1400;
    this.musicIn = ctx.createGain();
    this.musicIn.connect(warmth);
    warmth.connect(this.musicBus);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 60 / BPM * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    this.echoIn = ctx.createGain();
    this.echoIn.connect(echo);
    echo.connect(feedback);
    feedback.connect(echo);
    echo.connect(warmth);
    this.echoIn.connect(warmth);
    this.musicBus.connect(this.master);
    return ctx;
  }

  // Browsers only allow audio after a click or key press; call this from one.
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().then(() => this.syncMusic());
    else this.syncMusic();
  }

  // One enveloped oscillator note. slideTo bends the pitch (in MIDI notes) over the note.
  tone(midi, start, length, volume, type = 'square', slideTo = null, dest = this.sfxBus) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz(midi + this.shift), start);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(hz(slideTo + this.shift), start + length);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, length / 3));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  // A soft, slow note for the music (long attack and release).
  pad(midi, start, length, volume, type = 'triangle', dest = this.musicIn) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz(midi);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(volume, start + Math.min(0.5, length / 3));
    amp.gain.setValueAtTime(volume, start + length * 0.7);
    amp.gain.linearRampToValueAtTime(0.0001, start + length);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  // pitch: semitone offset, so each robot's sounds come out in its own voice.
  play(name, pitch = 0) {
    if (!this.sfxEnabled || !SFX[name]) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.gate.allow(name, ctx.currentTime * 1000)) return;
    this.shift = pitch;
    SFX[name](this, ctx.currentTime + 0.01);
    this.shift = 0;
    this.duck();
  }

  // Dips the music briefly under an effect so the two never fight.
  duck() {
    if (!this.musicBus || !this.musicPlaying()) return;
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL * 0.5, now, 0.03);
    this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL, now + 0.3, 0.35);
  }

  setSfxEnabled(on) { this.sfxEnabled = on; }
  setMusicEnabled(on) { this.musicEnabled = on; this.syncMusic(); }
  setRunning(on) { this.running = on; this.syncMusic(); }
  musicPlaying() { return this.musicEnabled && this.running; }

  // Fades the music in while the simulation runs (and music is on); fades out otherwise.
  syncMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    if (this.musicPlaying()) {
      this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL, now, 0.8);
      if (!this.timer) {
        this.nextBeat = now + 0.1;
        this.beat = 0;
        this.timer = setInterval(() => this.schedule(), 150);
      }
    } else {
      this.musicBus.gain.setTargetAtTime(0, now, 0.5);
      if (this.timer) {
        const timer = this.timer;
        this.timer = null;
        setTimeout(() => clearInterval(timer), 2500);
      }
    }
  }

  // Schedules the next half-second of music: chord pads per bar, bass on beats 1 and 3,
  // and a sparse random pentatonic melody (so the loop never repeats exactly).
  schedule() {
    const ctx = this.ctx;
    const beatLength = 60 / BPM;
    while (this.nextBeat < ctx.currentTime + 0.5) {
      const t = this.nextBeat;
      const chord = CHORDS[Math.floor(this.beat / 4) % CHORDS.length];
      const inBar = this.beat % 4;
      if (inBar === 0) chord.forEach((n) => this.pad(n, t, beatLength * 4, 0.028));
      if (inBar === 0 || inBar === 2) this.pad(chord[0] - 12, t, beatLength * 1.8, 0.07);
      for (const half of [0, 0.5]) {
        if (Math.random() < 0.26) {
          const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
          this.pad(note, t + half * beatLength, beatLength * 0.45, 0.022, 'square', this.echoIn);
        }
      }
      this.nextBeat += beatLength;
      this.beat += 1;
    }
  }
}

export const sound = new SoundEngine();
