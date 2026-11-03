import type { ReactNode } from 'react';
import { currentStreak, todayKey, useData, type AppData, type MascotId } from '../lib/store';

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

export type Mood = 'happy' | 'wait' | 'sad' | 'sleep';

/** Mood from the day: asleep at night, happy once the goal is met, sad when the streak is at risk or lost. */
export function mascotMood(d: AppData, date = new Date()): Mood {
  const h = date.getHours();
  if (h >= 23 || h < 7) return 'sleep';
  if (d.stats.lastGoalDay === todayKey(date)) return 'happy';
  if (h >= 20 || (d.stats.lastGoalDay && currentStreak(d) === 0)) return 'sad';
  return 'wait';
}

const INK = '#1f2333';
const BLUSH = '#f5a9b8';
const TEAR = '#7cc4f2';
const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

interface FaceSpec {
  eyes: [number, number][];
  r: number;
  kind: 'dot' | 'disc' | 'arc'; // dot = solid eye, disc = white eye with pupil, arc = fox's narrow eyes
  shine?: boolean;
  lid?: string; // eyelid colour for closed disc eyes
  mouth?: { x: number; y: number; w: number; color?: string };
  happyBrows?: ReactNode;
}

interface Art {
  wrap?: string;
  body: ReactNode;
  face: FaceSpec;
  front?: ReactNode;
}

function Eyes({ f, mood }: { f: FaceSpec; mood: Mood }) {
  const { r } = f;
  return (
    <>
      {f.eyes.map(([x, y], i) => {
        if (mood === 'sleep') {
          const closed = <path d={`M${x - r} ${y} Q${x} ${y + r} ${x + r} ${y}`} stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
          return f.kind === 'disc' ? (
            <g key={i}>
              <circle cx={x} cy={y} r={r} fill={f.lid} />
              {closed}
            </g>
          ) : (
            <g key={i}>{closed}</g>
          );
        }
        if (mood === 'happy') {
          // happy squint: eyes become ^ ^
          const squint = (
            <path d={`M${x - r} ${y + r * 0.35} Q${x} ${y - r * 1.25} ${x + r} ${y + r * 0.35}`} stroke={INK} strokeWidth={Math.max(2.8, r * 0.42)} fill="none" strokeLinecap="round" />
          );
          return (
            <g key={i}>
              {f.kind === 'disc' && <circle cx={x} cy={y} r={r} fill={f.lid} />}
              {squint}
            </g>
          );
        }
        if (f.kind === 'arc')
          return (
            <g key={i}>
              <circle cx={x} cy={y - 1} r={mood === 'sad' ? 3.6 : 3} fill={INK} />
              {mood === 'sad' && <circle cx={x + 1.1} cy={y - 2.2} r={1.3} fill="#fff" />}
            </g>
          );
        if (f.kind === 'disc') {
          const [px, py] = mood === 'wait' ? [r * 0.3, -r * 0.35] : mood === 'sad' ? [0, r * 0.25] : [1, 1];
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={r} fill="#fff" />
              <circle cx={x + px} cy={y + py} r={r * 0.47} fill={INK} />
            </g>
          );
        }
        const dy = mood === 'wait' ? -1.5 : mood === 'sad' ? 1.5 : 0;
        const sad = mood === 'sad'; // big wet shine, like puppy eyes
        return (
          <g key={i}>
            <circle cx={x} cy={y + dy} r={sad ? r * 1.1 : r} fill={INK} />
            {(f.shine || sad) && <circle cx={x + r * 0.3} cy={y + dy - r * 0.3} r={r * (sad ? 0.42 : 0.33)} fill="#fff" />}
            {sad && <circle cx={x - r * 0.35} cy={y + dy + r * 0.4} r={r * 0.18} fill="#fff" />}
          </g>
        );
      })}
    </>
  );
}

function Face({ f, mood }: { f: FaceSpec; mood: Mood }) {
  const m = f.mouth;
  const col = m?.color ?? INK;
  return (
    <>
      <g className="m-eyes">
        <Eyes f={f} mood={mood} />
      </g>
      {mood === 'happy' && f.happyBrows}
      {mood === 'sad' &&
        f.eyes.map(([x, y], i) => {
          const s = x < 0 ? -1 : 1;
          const top = y - f.r - 4;
          return <path key={i} d={`M${x + s * f.r * 1.1} ${top + 3} Q${x} ${top - 1} ${x - s * f.r * 0.6} ${top - 5}`} stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
        })}
      {mood === 'sad' &&
        f.eyes.map(([x, y], i) => (
          // a tear rolls down from each eye, one after the other
          <path key={i} className="m-tear" transform={`translate(${x + (x < 0 ? -1 : 1) * f.r * 0.5},${y + f.r + 4})`} d="M0 -4 Q3.5 1 0 2.5 Q-3.5 1 0 -4 Z" fill={TEAR} />
        ))}
      {m &&
        (mood === 'sleep' ? (
          <ellipse cx={m.x} cy={m.y + 2} rx={2.2} ry={2.8} fill={col} />
        ) : mood === 'happy' ? (
          // wide open smile with a tongue
          <g>
            <path d={`M${m.x - m.w * 1.25} ${m.y - 1} Q${m.x} ${m.y + m.w * 2.1} ${m.x + m.w * 1.25} ${m.y - 1} Z`} fill={INK} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
            <ellipse cx={m.x} cy={m.y + m.w * 0.85} rx={m.w * 0.55} ry={m.w * 0.38} fill="#f08b9a" />
          </g>
        ) : (
          <path
            d={
              mood === 'wait'
                  ? `M${m.x - m.w * 0.6} ${m.y + 2} H${m.x + m.w * 0.6}`
                  : `M${m.x - m.w * 1.1} ${m.y + 6} Q${m.x} ${m.y - 3} ${m.x + m.w * 1.1} ${m.y + 6}`
            }
            stroke={col}
            strokeWidth={2.4}
            fill="none"
            {...round}
          />
        ))}
    </>
  );
}

const cheeks = (x: number, y: number, rx = 4.5, ry = 2.8) => (
  <>
    <ellipse cx={-x} cy={y} rx={rx} ry={ry} fill={BLUSH} />
    <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={BLUSH} />
  </>
);

const ART: Record<MascotId, Art> = {
  wurst: {
    wrap: 'scale(1.15)',
    body: (
      <>
        <rect x={-48} y={-15} width={96} height={40} rx={20} fill="#c96f55" />
        <rect x={-48} y={-20} width={96} height={40} rx={20} fill="#e98b6d" />
        <path d="M-34 -9 l8 -5 l8 5 l8 -5 l8 5 l8 -5 l8 5 l8 -5 l8 5" stroke="#f3c94a" strokeWidth={3} fill="none" {...round} />
        {cheeks(19, 9)}
      </>
    ),
    face: { eyes: [[-10, 2], [10, 2]], r: 4.5, kind: 'dot', mouth: { x: 0, y: 9, w: 6 } },
  },
  kaktus: {
    wrap: 'translate(0,2)',
    body: (
      <>
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
        {cheeks(12, -6, 3.5, 2.2)}
      </>
    ),
    face: { eyes: [[-8, -14], [8, -14]], r: 4, kind: 'dot', mouth: { x: 0, y: -7, w: 5 } },
  },
  beagle: {
    body: (
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
        <ellipse cx={0} cy={-6} rx={5.5} ry={3.8} fill={INK} />
        {cheeks(17, -6, 3.8, 2.4)}
      </>
    ),
    face: {
      eyes: [[-10, -18], [10, -18]],
      r: 4.6,
      kind: 'dot',
      shine: true,
      mouth: { x: 0, y: 2, w: 5 },
    },
  },
  eule: {
    body: (
      <>
        <polygon points="-28,-26 -32,-48 -12,-34" fill="#9d87d6" />
        <polygon points="28,-26 32,-48 12,-34" fill="#9d87d6" />
        <ellipse cx={0} cy={2} rx={34} ry={40} fill="#b9a6e6" />
        <ellipse cx={0} cy={18} rx={22} ry={20} fill="#e4dbf8" />
        <ellipse cx={-10} cy={42} rx={7} ry={4} fill="#f2a65a" />
        <ellipse cx={10} cy={42} rx={7} ry={4} fill="#f2a65a" />
      </>
    ),
    face: { eyes: [[-12, -10], [12, -10]], r: 11, kind: 'disc', lid: '#9d87d6' },
    front: <polygon points="-5,0 5,0 0,9" fill="#f2a65a" />,
  },
  umlaut: {
    wrap: 'translate(0,4)',
    body: (
      <>
        <path d="M-20 -14 V12 Q-20 34 0 34 Q20 34 20 12 V-14" stroke="#5fae8e" strokeWidth={20} fill="none" strokeLinecap="round" />
        <path d="M-20 -18 V8 Q-20 30 0 30 Q20 30 20 8 V-18" stroke="#8fd9b9" strokeWidth={20} fill="none" strokeLinecap="round" />
        {cheeks(20, 6, 4, 2.6)}
      </>
    ),
    face: { eyes: [[-20, -42], [20, -42]], r: 9, kind: 'dot', shine: true, mouth: { x: 0, y: 26, w: 6 } },
  },
  fuchs: {
    body: (
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
        <circle cx={0} cy={2} r={3.8} fill={INK} />
      </>
    ),
    face: {
      eyes: [[-10, -16], [10, -16]],
      r: 4,
      kind: 'arc',
      mouth: { x: 2, y: 9, w: 5 },
      happyBrows: (
        <>
          <path d="M-17 -28 L-6 -24" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
          <path d="M17 -31 L6 -24" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
        </>
      ),
    },
    front: (
      <g fill="none" stroke={INK} strokeWidth={2}>
        <circle cx={-10} cy={-16} r={8} />
        <circle cx={10} cy={-16} r={8} />
        <path d="M-2 -16 H2" />
      </g>
    ),
  },
  kater: {
    body: (
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
        <polygon points="-4,-9 4,-9 0,-4" fill="#f08b9a" />
        {cheeks(24, -6)}
      </>
    ),
    face: {
      eyes: [[-13, -18], [13, -18]],
      r: 5,
      kind: 'dot',
      shine: true,
      mouth: { x: 0, y: -3, w: 5 },
    },
    front: (
      <g stroke={INK} strokeWidth={1.3} strokeLinecap="round">
        <path d="M-10 -6 L-52 -16" />
        <path d="M-10 -4 L-54 -4" />
        <path d="M-10 -2 L-50 8" />
        <path d="M10 -6 L52 -16" />
        <path d="M10 -4 L54 -4" />
        <path d="M10 -2 L50 8" />
      </g>
    ),
  },
  klecks: {
    wrap: 'scale(1.1)',
    body: (
      <>
        <path d="M-30 -10 C-34 -36 -6 -44 6 -34 C20 -46 44 -30 34 -8 C48 4 36 34 14 30 C4 42 -22 40 -24 26 C-44 24 -44 0 -30 -10 Z" fill="#6b86e0" />
        <circle cx={42} cy={-34} r={5} fill="#6b86e0" />
        <circle cx={-42} cy={34} r={4} fill="#6b86e0" />
      </>
    ),
    face: { eyes: [[-9, -4], [11, -4]], r: 7, kind: 'disc', lid: '#5a74cc', mouth: { x: 1, y: 10, w: 5, color: '#fff' } },
  },
};

const SPARKS: [number, number, number][] = [
  [-50, -42, 1.1],
  [50, -30, 0.9],
  [-46, 12, 0.7],
  [54, 16, 0.8],
];

/** The user's tamagotchi; `id` overrides the one chosen in settings, `mood` the one from the day. */
export function Mascot({ size = 130, id, mood, still }: { size?: number; id?: MascotId; mood?: Mood; still?: boolean }) {
  const data = useData();
  const m = id ?? (data.settings.mascot || DEFAULT_MASCOT);
  const md = mood ?? mascotMood(data);
  const a = ART[m] ?? ART[DEFAULT_MASCOT];
  return (
    <svg className={`mascot ${still ? '' : md}`} width={size} height={size} viewBox="-66 -70 132 132" aria-hidden="true">
      <ellipse className="m-shadow" cx={0} cy={56} rx={36} ry={5} fill="currentColor" opacity={0.08} />
      {md === 'happy' && !still && (
        <g className="m-spark" fill="#f3c94a">
          {SPARKS.map(([x, y, s], i) => (
            <path key={i} transform={`translate(${x},${y}) scale(${s})`} d="M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6 Z" />
          ))}
        </g>
      )}
      <g className="m-body">
        <g transform={a.wrap}>
          {a.body}
          <Face f={a.face} mood={md} />
          {a.front}
        </g>
      </g>
      {md === 'sleep' && (
        <g className="m-zz" fill="currentColor" opacity={0.55} fontWeight={800} fontFamily="var(--display)">
          <text x={30} y={-44} fontSize={14}>
            z
          </text>
          <text x={42} y={-56} fontSize={11}>
            z
          </text>
        </g>
      )}
    </svg>
  );
}

/** Every mascot in every mood — open the app with ?mascots to preview. */
export function MascotGallery() {
  const moods: [Mood, string][] = [
    ['happy', 'рад'],
    ['wait', 'ждёт'],
    ['sad', 'грустит'],
    ['sleep', 'спит'],
  ];
  return (
    <div className="screen">
      <div className="mascot-grid">
        {moods.map(([, label]) => (
          <b key={label} style={{ textAlign: 'center', fontSize: 13 }}>
            {label}
          </b>
        ))}
        {MASCOTS.flatMap((m) => moods.map(([mood]) => <Mascot key={m.id + mood} id={m.id} mood={mood} size={76} />))}
      </div>
    </div>
  );
}

export function MascotPicker({ value, onPick }: { value: MascotId | ''; onPick: (id: MascotId) => void }) {
  return (
    <div className="mascot-grid">
      {MASCOTS.map((m) => (
        <button key={m.id} className={value === m.id ? 'on' : ''} onClick={() => onPick(m.id)} aria-label={m.ru}>
          <Mascot id={m.id} size={58} mood="happy" still />
          <span>{m.de}</span>
        </button>
      ))}
    </div>
  );
}
