import type { ReactNode } from 'react';
import { currentStreak, useData, type TextDoc } from '../lib/store';
import { levelOf } from '../lib/gamify';

export type Accent = 'peach' | 'lav' | 'mint' | 'butter' | 'sky' | 'pink' | 'card';

/** Progress bar with the glossy highlight strip. */
export function PBar({ value, accent = 'mint', h = 10, onFill }: { value: number; accent?: Accent; h?: number; onFill?: boolean }) {
  return (
    <div className={`pbar c-${accent}${onFill ? ' on-fill' : ''}`} style={{ ['--h' as string]: `${h}px` }}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Pill({ children, accent, className = '' }: { children: ReactNode; accent?: Accent; className?: string }) {
  return <span className={`pill ${accent ? `c-${accent}` : ''} ${className}`}>{children}</span>;
}

/** Streak and level pills shown in screen headers. */
export function StatStrip() {
  const data = useData();
  return (
    <div className="pills">
      <Pill accent="peach">🔥 {currentStreak(data)}</Pill>
      <Pill accent="lav">Ур. {levelOf(data.stats.xp).level}</Pill>
    </div>
  );
}

export function TopBar({ title, back, onBack, right }: { title: string; back?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div>
      {back && (
        <div className="back-row">
          <button className="sq-btn" onClick={onBack} aria-label="Назад">
            ‹
          </button>
          <span>{back}</span>
          {right && <div className="end">{right}</div>}
        </div>
      )}
      <div className="bar">
        <h1>{title}</h1>
        {!back && right}
      </div>
    </div>
  );
}

export { Mascot } from './Mascot';

export const articleClass = (article: string) => (article === 'der' || article === 'die' || article === 'das' ? `c-${article}` : '');

/** CEFR level of a text from its source line (generated texts, library shelves). */
export function textLevel(t: TextDoc): string {
  const m = t.source?.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  if (m) return m[1];
  if (t.source?.startsWith('MiniKlexikon')) return 'A1';
  if (t.source?.startsWith('Klexikon')) return 'A2';
  if (t.source?.startsWith('Wikinews')) return 'B1';
  if (t.source?.startsWith('tagesschau')) return 'B2';
  if (t.source?.includes('Гримм')) return 'B2';
  return 'DE';
}

export const levelAccent = (lvl: string): Accent => (lvl.startsWith('A') ? 'mint' : lvl.startsWith('B') ? 'sky' : lvl.startsWith('C') ? 'lav' : 'peach');

/** How far a text was read on this device (0–1), saved by the reader. */
export function readProgress(id: string): number {
  try {
    return Math.min(1, Number(localStorage.getItem(`read:${id}`) ?? 0));
  } catch {
    return 0;
  }
}

export function lastOpenedText(): string | null {
  try {
    return localStorage.getItem('lastText');
  } catch {
    return null;
  }
}
