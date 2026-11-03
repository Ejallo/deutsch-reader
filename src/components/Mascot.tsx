import type { ReactNode } from 'react';
import { useData, type MascotId } from '../lib/store';

export const MASCOTS: { id: MascotId; de: string; ru: string }[] = [
  { id: 'kater', de: 'der Kater', ru: 'Кот учёный' },
  { id: 'fuchs', de: 'der Fuchs', ru: 'Лис-учитель' },
  { id: 'beagle', de: 'der Beagle', ru: 'Бигль' },
  { id: 'eule', de: 'die Eule', ru: 'Сова' },
  { id: 'umlaut', de: 'das Ü', ru: 'Умляут' },
  { id: 'kaktus', de: 'der Kaktus', ru: 'Кактус' },
  { id: 'wurst', de: 'die Wurst', ru: 'Сосиска' },
  { id: 'klecks', de: 'der Klecks', ru: 'Клякса' },
];

export const DEFAULT_MASCOT: MascotId = 'kater';

const INK = '#1f2333';
const BLUSH = '#f5a9b8';
const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Dot eyes, smile and cheeks shared by the simple characters. */
function Face({ y = 0, gap = 10, cheeks = 19 }: { y?: number; gap?: number; cheeks?: number }) {
  return (
    <>
      <circle cx={-gap} cy={y - 2} r={4.5} fill={INK} />
      <circle cx={gap} cy={y - 2} r={4.5} fill={INK} />
      <path d={`M-6 ${y + 5} Q0 ${y + 11} 6 ${y + 5}`} stroke={INK} strokeWidth={2.5} fill="none" {...round} />
      <ellipse cx={-cheeks} cy={y + 5} rx={4.5} ry={2.8} fill={BLUSH} />
      <ellipse cx={cheeks} cy={y + 5} rx={4.5} ry={2.8} fill={BLUSH} />
    </>
  );
}

const ART: Record<MascotId, ReactNode> = {
  wurst: (
    <g transform="scale(1.15)">
      <rect x={-48} y={-15} width={96} height={40} rx={20} fill="#c96f55" />
      <rect x={-48} y={-20} width={96} height={40} rx={20} fill="#e98b6d" />
      <path d="M-34 -9 l8 -5 l8 5 l8 -5 l8 5 l8 -5 l8 5 l8 -5 l8 5" stroke="#f3c94a" strokeWidth={3} fill="none" {...round} />
      <Face y={4} />
    </g>
  ),
  kaktus: (
    <g transform="translate(0,2)">
      <g stroke="#7cc59a" strokeWidth={12} fill="none" {...round}>
        <path d="M-16 0 H-30 V-16" />
        <path d="M16 -8 H30 V-24" />
      </g>
      <rect x={-18} y={-40} width={36} height={60} rx={18} fill="#7cc59a" />
      <g stroke="#5fa57d" strokeWidth={1.5} strokeLinecap="round">
        <path d="M-12 -28 l-3 -2" />
        <path d="M12 -30 l3 -2" />
        <path d="M-13 8 l-3 1" />
        <path d="M13 4 l3 1" />
      </g>
      <circle cx={0} cy={-42} r={6} fill="#f5a9b8" />
      <circle cx={0} cy={-42} r={2.5} fill="#f3c94a" />
      <rect x={-25} y={14} width={50} height={9} rx={3} fill="#d4745a" />
      <polygon points="-21,23 21,23 16,46 -16,46" fill="#e98b6d" />
      <circle cx={-8} cy={-14} r={4} fill={INK} />
      <circle cx={8} cy={-14} r={4} fill={INK} />
      <path d="M-5 -7 Q0 -2 5 -7" stroke={INK} strokeWidth={2.3} fill="none" {...round} />
      <ellipse cx={-12} cy={-6} rx={3.5} ry={2.2} fill={BLUSH} />
      <ellipse cx={12} cy={-6} rx={3.5} ry={2.2} fill={BLUSH} />
    </g>
  ),
  beagle: (
    <>
      <path d="M24 18 Q42 8 40 -16" stroke="#c98a4b" strokeWidth={7} fill="none" {...round} />
      <circle cx={40} cy={-18} r={4.5} fill="#fff" />
      <ellipse cx={0} cy={0} rx={30} ry={48} fill="#c98a4b" />
      <ellipse cx={0} cy={24} rx={19} ry={22} fill="#fff" />
      <ellipse cx={0} cy={-22} rx={5} ry={18} fill="#fff" />
      <ellipse cx={0} cy={-2} rx={15} ry={11} fill="#fff" />
      <ellipse cx={-28} cy={-12} rx={9} ry={22} fill="#8a5530" />
      <ellipse cx={28} cy={-12} rx={9} ry={22} fill="#8a5530" />
      <ellipse cx={-10} cy={48} rx={8} ry={5.5} fill="#fff" stroke="#e6ddd2" strokeWidth={1} />
      <ellipse cx={10} cy={48} rx={8} ry={5.5} fill="#fff" stroke="#e6ddd2" strokeWidth={1} />
      <circle cx={-10} cy={-18} r={4.6} fill={INK} />
      <circle cx={10} cy={-18} r={4.6} fill={INK} />
      <circle cx={-8.6} cy={-19.4} r={1.5} fill="#fff" />
      <circle cx={11.4} cy={-19.4} r={1.5} fill="#fff" />
      <ellipse cx={0} cy={-6} rx={5.5} ry={3.8} fill={INK} />
      <path d="M-5 2 Q0 6.5 5 2" stroke={INK} strokeWidth={2.2} fill="none" {...round} />
      <ellipse cx={0} cy={7.5} rx={3} ry={3.8} fill="#f08b9a" />
      <ellipse cx={-17} cy={-6} rx={3.8} ry={2.4} fill={BLUSH} />
      <ellipse cx={17} cy={-6} rx={3.8} ry={2.4} fill={BLUSH} />
    </>
  ),
  eule: (
    <>
      <polygon points="-28,-26 -32,-48 -12,-34" fill="#9d87d6" />
      <polygon points="28,-26 32,-48 12,-34" fill="#9d87d6" />
      <ellipse cx={0} cy={2} rx={34} ry={40} fill="#b9a6e6" />
      <ellipse cx={0} cy={18} rx={22} ry={20} fill="#e4dbf8" />
      <circle cx={-12} cy={-10} r={11} fill="#fff" />
      <circle cx={12} cy={-10} r={11} fill="#fff" />
      <circle cx={-11} cy={-9} r={5} fill={INK} />
      <circle cx={13} cy={-9} r={5} fill={INK} />
      <polygon points="-5,0 5,0 0,9" fill="#f2a65a" />
      <ellipse cx={-10} cy={42} rx={7} ry={4} fill="#f2a65a" />
      <ellipse cx={10} cy={42} rx={7} ry={4} fill="#f2a65a" />
    </>
  ),
  umlaut: (
    <g transform="translate(0,4)">
      <path d="M-20 -14 V12 Q-20 34 0 34 Q20 34 20 12 V-14" stroke="#5fae8e" strokeWidth={20} fill="none" strokeLinecap="round" />
      <path d="M-20 -18 V8 Q-20 30 0 30 Q20 30 20 8 V-18" stroke="#8fd9b9" strokeWidth={20} fill="none" strokeLinecap="round" />
      <circle cx={-20} cy={-42} r={9} fill={INK} />
      <circle cx={20} cy={-42} r={9} fill={INK} />
      <circle cx={-17} cy={-45} r={3} fill="#fff" />
      <circle cx={23} cy={-45} r={3} fill="#fff" />
      <path d="M-6 26 Q0 33 6 26" stroke={INK} strokeWidth={2.5} fill="none" {...round} />
      <ellipse cx={-20} cy={6} rx={4} ry={2.6} fill={BLUSH} />
      <ellipse cx={20} cy={6} rx={4} ry={2.6} fill={BLUSH} />
    </g>
  ),
  fuchs: (
    <>
      <path d="M20 30 Q62 30 54 -10 Q50 -30 36 -26 Q44 6 20 14 Z" fill="#f08a3e" />
      <path d="M54 -10 Q50 -30 36 -26 Q42 -14 44 -6 Z" fill="#fff3e6" />
      <polygon points="-25,-28 -22,-64 -6,-42" fill="#f08a3e" />
      <polygon points="25,-28 22,-64 6,-42" fill="#f08a3e" />
      <polygon points="-20,-33 -19,-54 -11,-42" fill="#fff3e6" />
      <polygon points="20,-33 19,-54 11,-42" fill="#fff3e6" />
      <ellipse cx={0} cy={0} rx={29} ry={47} fill="#f08a3e" />
      <path d="M-28 -14 Q-12 -10 0 0 Q12 -10 28 -14 Q25 12 0 20 Q-25 12 -28 -14 Z" fill="#fff3e6" />
      <ellipse cx={0} cy={30} rx={16} ry={15} fill="#fff3e6" />
      <ellipse cx={-10} cy={47} rx={8} ry={5.5} fill="#d97530" />
      <ellipse cx={10} cy={47} rx={8} ry={5.5} fill="#d97530" />
      <path d="M-17 -28 L-6 -24" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M17 -31 L6 -24" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M-14 -16 Q-10 -19.5 -6 -16" stroke={INK} strokeWidth={2.8} fill="none" strokeLinecap="round" />
      <path d="M6 -16 Q10 -19.5 14 -16" stroke={INK} strokeWidth={2.8} fill="none" strokeLinecap="round" />
      <g fill="none" stroke={INK} strokeWidth={2}>
        <circle cx={-10} cy={-16} r={8} />
        <circle cx={10} cy={-16} r={8} />
        <path d="M-2 -16 H2" />
      </g>
      <circle cx={0} cy={2} r={3.8} fill={INK} />
      <path d="M-5 10 Q2 14.5 9 7" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
    </>
  ),
  kater: (
    <>
      <path d="M30 30 Q60 26 54 -6 Q52 -18 44 -14" stroke="#8e96a8" strokeWidth={9} fill="none" strokeLinecap="round" />
      <polygon points="-32,-24 -28,-60 -8,-42" fill="#8e96a8" />
      <polygon points="32,-24 28,-60 8,-42" fill="#8e96a8" />
      <polygon points="-27,-30 -25,-50 -15,-41" fill="#f5c3cc" />
      <polygon points="27,-30 25,-50 15,-41" fill="#f5c3cc" />
      <ellipse cx={0} cy={0} rx={38} ry={47} fill="#a9b1c2" />
      <ellipse cx={0} cy={22} rx={24} ry={24} fill="#d6dbe5" />
      <g stroke="#8e96a8" strokeWidth={3} strokeLinecap="round">
        <path d="M0 -42 V-32" />
        <path d="M-8 -40 L-6 -32" />
        <path d="M8 -40 L6 -32" />
      </g>
      <path d="M-26 8 Q0 20 26 8" stroke="#f3c94a" strokeWidth={4} fill="none" strokeDasharray="4 2.5" />
      <rect x={-17} y={18} width={34} height={22} rx={2} fill="#e5574f" />
      <path d="M0 18 V40" stroke="#fff" strokeWidth={1.6} />
      <ellipse cx={-16} cy={24} rx={7} ry={5.5} fill="#a9b1c2" />
      <ellipse cx={16} cy={24} rx={7} ry={5.5} fill="#a9b1c2" />
      <ellipse cx={-14} cy={47} rx={10} ry={6} fill="#8e96a8" />
      <ellipse cx={14} cy={47} rx={10} ry={6} fill="#8e96a8" />
      <circle cx={-13} cy={-18} r={5} fill={INK} />
      <circle cx={13} cy={-18} r={5} fill={INK} />
      <circle cx={-11.5} cy={-19.5} r={1.6} fill="#fff" />
      <circle cx={14.5} cy={-19.5} r={1.6} fill="#fff" />
      <polygon points="-4,-9 4,-9 0,-4" fill="#f08b9a" />
      <path d="M-6 -2 Q-3 1 0 -2 Q3 1 6 -2" stroke={INK} strokeWidth={2} fill="none" {...round} />
      <g stroke={INK} strokeWidth={1.3} strokeLinecap="round">
        <path d="M-10 -6 L-52 -16" />
        <path d="M-10 -4 L-54 -4" />
        <path d="M-10 -2 L-50 8" />
        <path d="M10 -6 L52 -16" />
        <path d="M10 -4 L54 -4" />
        <path d="M10 -2 L50 8" />
      </g>
      <ellipse cx={-24} cy={-6} rx={4.5} ry={2.8} fill={BLUSH} />
      <ellipse cx={24} cy={-6} rx={4.5} ry={2.8} fill={BLUSH} />
    </>
  ),
  klecks: (
    <g transform="scale(1.1)">
      <path d="M-30 -10 C-34 -36 -6 -44 6 -34 C20 -46 44 -30 34 -8 C48 4 36 34 14 30 C4 42 -22 40 -24 26 C-44 24 -44 0 -30 -10 Z" fill="#6b86e0" />
      <circle cx={42} cy={-34} r={5} fill="#6b86e0" />
      <circle cx={-42} cy={34} r={4} fill="#6b86e0" />
      <circle cx={-9} cy={-4} r={7} fill="#fff" />
      <circle cx={11} cy={-4} r={7} fill="#fff" />
      <circle cx={-8} cy={-3} r={3.5} fill={INK} />
      <circle cx={12} cy={-3} r={3.5} fill={INK} />
      <path d="M-4 10 Q1 16 6 10" stroke="#fff" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </g>
  ),
};

/** The user's tamagotchi; `id` overrides the one chosen in settings. */
export function Mascot({ size = 130, id }: { size?: number; id?: MascotId }) {
  const chosen = useData().settings.mascot;
  const m = id ?? (chosen || DEFAULT_MASCOT);
  return (
    <svg className="mascot" width={size} height={size} viewBox="-66 -70 132 132" aria-hidden="true">
      <ellipse cx={0} cy={56} rx={36} ry={5} fill="currentColor" opacity={0.08} />
      {ART[m] ?? ART[DEFAULT_MASCOT]}
    </svg>
  );
}

export function MascotPicker({ value, onPick }: { value: MascotId | ''; onPick: (id: MascotId) => void }) {
  return (
    <div className="mascot-grid">
      {MASCOTS.map((m) => (
        <button key={m.id} className={value === m.id ? 'on' : ''} onClick={() => onPick(m.id)} aria-label={m.ru}>
          <Mascot id={m.id} size={58} />
          <span>{m.de}</span>
        </button>
      ))}
    </div>
  );
}
