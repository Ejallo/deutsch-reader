import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/** What a correct answer looked like, so the background can answer it in kind. */
export interface CorrectFx {
  tier: number; // combo tier after the answer (0–3)
  tierUp: boolean;
  combo: number;
  fast: boolean;
  bonus: number; // crit or golden multiplier, 1 = none
  golden: boolean;
}

export interface FeedFxHandle {
  correct: (e: CorrectFx) => void;
  wrong: (lostCombo: number) => void;
}

const GLYPHS = ['ä', 'ö', 'ü', 'ß', '★', '✦', 'der', 'die', 'das'];
const RAYS = 20;
const STARS = 22;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** Where the companion mascot is, relative to `root` (falls back to the upper middle). */
function origin(root: HTMLElement): [number, number] {
  const r = root.getBoundingClientRect();
  const m = root.parentElement?.querySelector('.feed-pal .mascot')?.getBoundingClientRect();
  return m ? [m.left - r.left + m.width / 2, m.top - r.top + m.height / 2] : [r.width / 2, r.height * 0.35];
}

/**
 * The feed's living backdrop: colour blobs and rays that warm up with the combo tier,
 * plus a top layer for stickers and speed lines. Driven imperatively from the Feed.
 */
export const FeedFx = forwardRef<FeedFxHandle, { tier: number }>(function FeedFx({ tier }, ref) {
  const bg = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const rays = useRef<HTMLDivElement>(null);

  // Stars for the top tier are placed once
  useEffect(() => {
    const b = bg.current;
    if (!b) return;
    const made: HTMLElement[] = [];
    for (let i = 0; i < STARS; i++) {
      const s = document.createElement('i');
      s.className = 'fx-star';
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.animationDelay = `${-Math.random() * 2.2}s`;
      b.appendChild(s);
      made.push(s);
    }
    return () => made.forEach((s) => s.remove());
  }, []);

  const wave = (color: string, scale: number, dur: number, fill: boolean) => {
    const b = bg.current;
    if (!b || reduced()) return;
    const [x, y] = origin(b);
    const w = document.createElement('i');
    w.className = 'fx-wave';
    if (fill) w.style.background = color;
    else w.style.border = `3px solid ${color}`;
    w.style.left = `${x}px`;
    w.style.top = `${y}px`;
    b.appendChild(w);
    w.animate([{ transform: 'scale(.3)', opacity: 0.9 }, { transform: `scale(${scale})`, opacity: 0 }], { duration: dur, easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = () => w.remove();
  };

  const floaters = (n: number, t: number) => {
    const b = bg.current;
    if (!b || reduced()) return;
    const { width, height } = b.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const f = document.createElement('i');
      f.className = `fx-floaty t${t}`;
      f.textContent = pick(GLYPHS);
      f.style.fontSize = `${14 + Math.random() * (10 + t * 7)}px`;
      const x = Math.random() * (width - 30);
      const y0 = height + 20 + Math.random() * 60;
      const y1 = height * (0.1 + Math.random() * 0.4);
      const sw = (Math.random() - 0.5) * 90;
      b.appendChild(f);
      f.animate(
        [{ transform: `translate(${x}px,${y0}px)`, opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { transform: `translate(${x + sw}px,${y1}px) rotate(${sw / 2}deg)`, opacity: 0 }],
        { duration: 1800 + Math.random() * 1400, delay: i * 35, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'backwards' },
      ).onfinish = () => f.remove();
    }
  };

  /** Meme-style caption that slides across on a diagonal. */
  const sticker = (text: string, cls: string, dir = 1) => {
    const t = top.current;
    if (!t) return;
    const s = document.createElement('span');
    s.className = `fx-sticker ${cls}`;
    s.textContent = text;
    t.appendChild(s);
    const W = t.clientWidth;
    const w = s.offsetWidth;
    const y = t.clientHeight * (0.3 + Math.random() * 0.06);
    const c = W / 2 - w / 2;
    s.animate(
      reduced()
        ? [{ transform: `translate(${c}px,${y}px) rotate(-6deg)`, opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { transform: `translate(${c}px,${y}px) rotate(-6deg)`, opacity: 0 }]
        : [
            { transform: `translate(${dir > 0 ? -w - 20 : W + 20}px,${y}px) rotate(-8deg) scale(.8)` },
            { transform: `translate(${c}px,${y - 10}px) rotate(-6deg) scale(1.08)`, offset: 0.2, easing: 'cubic-bezier(.3,1.4,.5,1)' },
            { transform: `translate(${c + 6}px,${y - 12}px) rotate(-6deg) scale(1)`, offset: 0.75 },
            { transform: `translate(${dir > 0 ? W + 40 : -w - 40}px,${y - 30}px) rotate(-4deg) scale(.9)` },
          ],
      { duration: 1300, easing: 'cubic-bezier(.5,0,.3,1)' },
    ).onfinish = () => s.remove();
  };

  const speedLines = () => {
    const t = top.current;
    if (!t || reduced()) return;
    const W = t.clientWidth;
    const H = t.clientHeight;
    for (let i = 0; i < 9; i++) {
      const y = H * 0.15 + i * H * 0.06 + Math.random() * 12;
      const l = document.createElement('i');
      l.className = 'fx-speed';
      l.style.width = `${70 + Math.random() * 90}px`;
      t.appendChild(l);
      l.animate(
        [{ transform: `translate(${W + 20}px,${y}px)`, opacity: 0 }, { transform: `translate(${W * 0.45}px,${y}px)`, opacity: 0.7, offset: 0.4 }, { transform: `translate(-200px,${y}px)`, opacity: 0 }],
        { duration: 360 + i * 25, easing: 'ease-in' },
      ).onfinish = () => l.remove();
    }
  };

  useImperativeHandle(ref, () => ({
    correct(e) {
      const r = rays.current;
      if (r && !reduced()) {
        r.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)', offset: 0.25 }, { transform: 'scale(1)' }], { duration: 700, easing: 'cubic-bezier(.3,1.5,.5,1)' });
        if (!e.tier) r.animate([{ opacity: 0 }, { opacity: 0.35, offset: 0.3 }, { opacity: 0 }], 800);
        if (e.bonus > 1) r.animate([{ filter: 'none' }, { filter: 'sepia(1) saturate(4) brightness(1.1)', opacity: 0.95, offset: 0.3 }, { filter: 'none' }], 1200);
      }
      wave('var(--fx-ink)', 10, 900, false);
      if (e.tierUp) wave('var(--fx-b1)', 24, 1100, true);
      floaters(4 + e.tier * 5, e.tier);
      if (e.fast) {
        speedLines();
        sticker('БЛИЦ ⚡', 's-blitz', -1);
      } else if (e.bonus > 1) sticker(e.golden ? `ЗОЛОТАЯ ×${e.bonus} ✨` : `КРИТ ×${e.bonus} ✨`, 's-crit');
      else if (e.tierUp) sticker(e.tier === 3 ? `КОСМОС ×${e.combo} 🌌` : e.tier === 2 ? `В УДАРЕ! ×${e.combo}` : `КОМБО ×${e.combo}`, `s-t${e.tier}`);
    },
    wrong(lost) {
      const b = bg.current;
      if (!b) return;
      b.classList.add('cold');
      setTimeout(() => b.classList.remove('cold'), 1100);
      if (reduced()) return;
      // letters still floating drop like stones
      b.querySelectorAll<HTMLElement>('.fx-floaty').forEach((f) => {
        const m = new DOMMatrix(getComputedStyle(f).transform);
        f.getAnimations().forEach((a) => a.cancel());
        f.animate([{ transform: `translate(${m.e}px,${m.f}px)`, opacity: 0.8 }, { transform: `translate(${m.e}px,${m.f + 320}px) rotate(50deg)`, opacity: 0 }], { duration: 700, easing: 'cubic-bezier(.5,0,.9,.6)' }).onfinish = () => f.remove();
      });
      if (lost >= 3) rays.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(.2) rotate(-40deg)', opacity: 0 }], { duration: 500, easing: 'ease-in' });
    },
  }));

  return (
    <>
      <div ref={bg} className={`fx-bg t${tier}`} aria-hidden="true">
        <i className="fx-blob b1" />
        <i className="fx-blob b2" />
        <i className="fx-blob b3" />
        <div ref={rays} className="fx-rays">
          <svg viewBox="-100 -100 200 200">
            {Array.from({ length: RAYS }, (_, i) => {
              const a = (i / RAYS) * Math.PI * 2;
              const b = a + Math.PI / (RAYS * 2);
              return <path key={i} d={`M0 0 L${Math.cos(a) * 100} ${Math.sin(a) * 100} L${Math.cos(b) * 100} ${Math.sin(b) * 100} Z`} />;
            })}
          </svg>
        </div>
      </div>
      <div ref={top} className="fx-top" aria-hidden="true" />
    </>
  );
});
