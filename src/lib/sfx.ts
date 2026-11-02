import { getData } from './store';

// Sounds are synthesized with Web Audio: no files to download, instant playback
let ctx: AudioContext | null = null;

/** iOS only lets audio start from a user gesture, so call this on the first tap. */
export function unlockAudio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.18) {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const enabled = () => getData().settings.sound && !!ctx;

export const sfx = {
  correct(combo = 0) {
    if (!enabled()) return;
    // Pitch climbs with the combo, so a streak literally sounds higher
    const base = 660 * Math.pow(2, Math.min(combo, 8) / 12);
    tone(base, 0, 0.12, 'triangle');
    tone(base * 1.5, 0.08, 0.18, 'triangle');
  },
  almost() {
    if (!enabled()) return;
    tone(520, 0, 0.15, 'triangle');
  },
  wrong() {
    if (!enabled()) return;
    tone(220, 0, 0.18, 'sawtooth', 0.08);
    tone(180, 0.1, 0.22, 'sawtooth', 0.08);
  },
  swipe() {
    if (!enabled()) return;
    tone(900, 0, 0.05, 'sine', 0.05);
  },
  chest() {
    if (!enabled()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.25, 'triangle'));
  },
  fanfare() {
    if (!enabled()) return;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, 'square', 0.07));
  },
  tick() {
    if (!enabled()) return;
    tone(1200, 0, 0.03, 'sine', 0.04);
  },
};
