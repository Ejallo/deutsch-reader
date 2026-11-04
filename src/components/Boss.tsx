/** Der Fehlerteufel — the daily boss, a red orc with a golden muzzle. Pure SVG so every part animates on its own. */
export type BossMood = 'idle' | 'scared' | 'hit' | 'laugh' | 'dead' | 'gloat';

const RED = '#d4372f';
const RED_D = '#b02b29';
const RED_DD = '#8e2022';
const DARK = '#4a1012';
const GOLD = '#c4923a';
const GOLD_D = '#a2742a';
const BAR = '#4a2a12';
const TUSK = '#f3e3c3';
const WHITE = '#f8eedb';
const SWEAT = '#7cc4f2';

const mirror = (d: string) => <path d={d} transform="matrix(-1 0 0 1 220 0)" />;

function Brows({ mood }: { mood: BossMood }) {
  // Scared: inner ends go up; laughing: raised a bit; otherwise a heavy angry frown
  const d =
    mood === 'scared' || mood === 'dead'
      ? 'M64 66 L100 54 L102 63 L67 75 Z'
      : mood === 'laugh' || mood === 'gloat'
        ? 'M66 58 L102 66 L100 75 L65 67 Z'
        : 'M66 62 L103 73 L100 83 L64 72 Z';
  return (
    <g className="b-brows" fill={DARK}>
      <path d={d} />
      {mirror(d)}
    </g>
  );
}

function Eyes({ mood }: { mood: BossMood }) {
  if (mood === 'hit')
    return (
      <g stroke={DARK} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M76 80 L94 87 L76 94" />
        <path d="M144 80 L126 87 L144 94" />
      </g>
    );
  if (mood === 'dead')
    return (
      <g stroke={DARK} strokeWidth={5} strokeLinecap="round">
        <path d="M78 79 L96 95 M96 79 L78 95" />
        <path d="M124 79 L142 95 M142 79 L124 95" />
      </g>
    );
  if (mood === 'laugh' || mood === 'gloat')
    return (
      <g className="b-eyes">
        <g stroke={DARK} strokeWidth={5} strokeLinecap="round" fill="none">
          <path d="M74 90 Q87 77 100 90" />
          <path d="M120 90 Q133 77 146 90" />
        </g>
        <circle className="b-glint" cx={87} cy={84} r={2.4} fill="#ffd23f" />
        <circle className="b-glint" cx={133} cy={84} r={2.4} fill="#ffd23f" />
      </g>
    );
  if (mood === 'scared')
    return (
      <g className="b-eyes">
        <circle cx={87} cy={85} r={12} fill={WHITE} />
        <circle cx={133} cy={85} r={12} fill={WHITE} />
        <g className="b-pupils" fill={DARK}>
          <circle cx={87} cy={86} r={3.2} />
          <circle cx={133} cy={86} r={3.2} />
        </g>
      </g>
    );
  const white = 'M74 77 L101 85 Q98 96 87 96 Q76 94 74 77 Z';
  return (
    <g className="b-eyes">
      <g fill={WHITE}>
        <path d={white} />
        {mirror(white)}
      </g>
      <g fill={DARK}>
        <circle cx={90} cy={88} r={4.5} />
        <circle cx={130} cy={88} r={4.5} />
      </g>
    </g>
  );
}

export function Boss({ mood = 'idle', size = 120, className = '' }: { mood?: BossMood; size?: number; className?: string }) {
  const open = mood === 'laugh' || mood === 'gloat' || mood === 'scared';
  return (
    <span className={`boss-art m-${mood} ${className}`} style={{ width: size, height: size * 0.9 }}>
      <svg viewBox="0 0 220 198" width="100%" height="100%" aria-label="Der Fehlerteufel" role="img">
        {/* body */}
        <g className="b-body">
          <path d="M8 198 C8 150 36 126 80 120 L140 120 C184 126 212 150 212 198 Z" fill={RED_D} />
          <g fill={RED} opacity={0.7}>
            <path d="M30 160 C40 136 62 128 84 126 L84 150 C62 150 44 156 30 170 Z" />
            {mirror('M30 160 C40 136 62 128 84 126 L84 150 C62 150 44 156 30 170 Z')}
          </g>
          <g fill={DARK} opacity={0.75}>
            <path d="M50 130 L66 125 L92 198 L74 198 Z" />
            {mirror('M50 130 L66 125 L92 198 L74 198 Z')}
          </g>
          <path d="M66 156 Q110 146 154 156 L150 178 Q110 168 70 178 Z" fill={RED} />
          <g className="b-badge">
            <ellipse cx={110} cy={174} rx={18} ry={14} fill={GOLD} />
            <g fill={BAR}>
              <rect x={101} y={166} width={4} height={16} rx={1.5} />
              <rect x={108} y={166} width={4} height={16} rx={1.5} />
              <rect x={115} y={166} width={4} height={16} rx={1.5} />
            </g>
          </g>
        </g>

        {/* head */}
        <g className="b-head">
          <g className="b-ear b-ear-l">
            <path d="M64 60 L26 42 L60 96 Z" fill={RED_D} />
            <path d="M60 66 L38 54 L58 84 Z" fill={RED_DD} />
          </g>
          <g className="b-ear b-ear-r">
            <path d="M156 60 L194 42 L160 96 Z" fill={RED_D} />
            <path d="M160 66 L182 54 L162 84 Z" fill={RED_DD} />
          </g>
          <path d="M60 68 C60 28 82 12 110 12 C138 12 160 28 160 68 L164 112 C164 140 140 152 110 152 C80 152 56 140 56 112 Z" fill={RED} />
          <path d="M57 104 C60 140 84 152 110 152 C136 152 160 140 163 104 C150 122 132 128 110 128 C88 128 70 122 57 104 Z" fill={RED_D} />
          <path d="M92 20 C100 16 120 16 128 20 C120 24 100 24 92 20 Z" fill="#e2483f" opacity={0.6} />

          <Brows mood={mood} />
          <Eyes mood={mood} />
          <path d="M100 92 Q110 86 120 92 Q125 104 118 107 Q110 111 102 107 Q95 104 100 92 Z" fill={RED_D} />
          <g fill={DARK} opacity={0.6}>
            <ellipse cx={105} cy={104} rx={2.2} ry={1.6} />
            <ellipse cx={115} cy={104} rx={2.2} ry={1.6} />
          </g>

          {/* jaw: mouth, tusks, muzzle */}
          <g className="b-jaw">
            <path d={open ? 'M74 116 Q110 104 146 116 L144 146 Q110 154 76 146 Z' : 'M76 118 Q110 108 144 118 L142 136 Q110 142 78 136 Z'} fill="#3a0c0c" />
            <g className="b-tusks" fill={TUSK}>
              <path d="M80 124 L72 98 L92 118 Z" />
              {mirror('M80 124 L72 98 L92 118 Z')}
            </g>
            <g className="b-muzzle">
              <rect x={64} y={121} width={92} height={11} rx={5} fill={GOLD_D} />
              <rect x={83} y={110} width={54} height={32} rx={9} fill={GOLD} />
              <g fill={BAR}>
                <rect x={91} y={116} width={6} height={20} rx={2} />
                <rect x={101} y={116} width={6} height={20} rx={2} />
                <rect x={111} y={116} width={6} height={20} rx={2} />
                <rect x={121} y={116} width={6} height={20} rx={2} />
              </g>
            </g>
          </g>

          {mood === 'scared' && <path className="b-sweat" d="M160 40 Q166 52 160 56 Q154 52 160 40 Z" fill={SWEAT} />}
        </g>
      </svg>
      {mood === 'dead' && (
        <span className="b-stars" aria-hidden style={{ fontSize: Math.max(10, size * 0.14) }}>
          <i>✦</i>
          <i>✦</i>
          <i>✦</i>
        </span>
      )}
    </span>
  );
}
