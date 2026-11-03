import { getData } from './store';

// Sounds are synthesized with Web Audio: no files to download, instant playback
let ctx: AudioContext | null = null;

/** iOS only lets audio start from a user gesture, so call this on the first tap. */
export function unlockAudio() {
  if (!ctx) ctx = new AudioContext();
  // iOS also suspends ("interrupted") the context after the app goes to background
  if (ctx.state === 'running') return;
  void ctx.resume().catch(() => undefined);
  // Playing a silent buffer inside the gesture is what actually wakes audio on iOS
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, 22050);
  src.connect(ctx.destination);
  src.start(0);
}

/**
 * A touch pointerdown isn't a user activation on iOS, so unlock on the events that
 * are (touchend, click, keydown). Capture phase runs before the answer's own handler.
 */
export function installAudioUnlock() {
  for (const ev of ['touchend', 'click', 'keydown'] as const) {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  }
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

/** Soft bell: sine fundamental plus a quieter inharmonic overtone, long decay. */
function bell(freq: number, start: number, dur = 0.6, gain = 0.16) {
  tone(freq, start, dur, 'sine', gain);
  tone(freq * 2.76, start, dur * 0.4, 'sine', gain * 0.18);
}

const enabled = () => getData().settings.sound && !!ctx;

export const sfx = {
  correct(combo = 0) {
    if (!enabled()) return;
    // Pitch climbs with the combo, so a streak literally sounds higher
    const base = 660 * Math.pow(2, Math.min(combo, 8) / 12);
    bell(base, 0, 0.45);
    bell(base * 1.5, 0.09, 0.7);
  },
  almost() {
    if (!enabled()) return;
    bell(587, 0, 0.5, 0.13);
  },
  wrong() {
    if (!enabled()) return;
    // Low, soft falling pair: clearly "no" without the harsh buzz
    tone(330, 0, 0.22, 'sine', 0.12);
    tone(262, 0.12, 0.35, 'sine', 0.12);
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
