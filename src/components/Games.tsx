import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Boss, type BossMood } from './Boss';
import { addXp, getData, saveGameRecord, saveMedal, takeFirstGameOfDay, todayKey, unlockedWords, winBoss, type GameId, type GameRecords, type Word } from '../lib/store';
import { fullGerman, shortTranslation, shuffle } from '../lib/feed';
import { levelOf } from '../lib/gamify';
import { sfx } from '../lib/sfx';
import { speak } from '../lib/tts';
import { Confetti } from './SpecialCards';
import { LevelUpScreen } from './Rewards';
import { Mascot, PBar } from './ui';

// Mini-games are play on top of learning: they give XP but never touch the FSRS schedule or the daily goal.
// XP comes from unique words, medals and records, so looping a small vocabulary can't farm it.
export const GAME_MIN_WORDS = 6;
export const MIN_WORDS: Record<GameId, number> = { speed: GAME_MIN_WORDS, survival: 20, pairs: GAME_MIN_WORDS, boss: GAME_MIN_WORDS };
const SPEED_MS = 60_000;
const SPEED_PENALTY_MS = 2000;
const LIVES = 3;
const PAIRS_ROUNDS = 3;
const PAIRS_PER_ROUND = 6;
const PAIRS_PENALTY_MS = 3000;
const PAIRS_XP = 30;
const BOSS_SIZE = 8;
const BOSS_XP = 150;
const BOSS_GEMS = 30;
const RECORD_XP = 50;
const XP_PER_WORD = 3;
const SHOW_WRONG_MS = 900;

// Medal thresholds: answers for speed/survival, milliseconds (lower is better) for pairs
const MEDALS: Record<keyof GameRecords, [number, number, number]> = {
  speed: [10, 20, 30],
  survival: [10, 25, 50],
  pairs: [60_000, 40_000, 25_000],
};
const MEDAL_XP = [20, 50, 100];
const MEDAL_ICON = ['', '🥉', '🥈', '🥇'];
const MEDAL_NAME = ['', 'Бронза', 'Серебро', 'Золото'];

const medalFor = (game: keyof GameRecords, value: number) => {
  const t = MEDALS[game];
  const reached = game === 'pairs' ? t.filter((ms) => value > 0 && value <= ms) : t.filter((n) => value >= n);
  return reached.length;
};
/** XP for every medal level reached in one run. */
const medalXp = (medal: number) => MEDAL_XP.slice(0, medal).reduce((a, b) => a + b, 0);

export const GAMES: Record<GameId, { emoji: string; title: string; rules: string }> = {
  speed: { emoji: '⚡', title: 'Скорость', rules: '60 секунд: выбирай перевод как можно быстрее. Ошибка отнимает 2 секунды. Медали: 10 · 20 · 30.' },
  survival: { emoji: '❤️', title: 'Выживание', rules: '3 жизни, вопросы без конца. Слова, которые уже были, возвращаются сложнее. Медали: 10 · 25 · 50.' },
  pairs: { emoji: '🧩', title: 'Пары', rules: 'Соедини 6 слов с переводами. 3 раунда на время, ошибка +3 секунды. Медали: 60 · 40 · 25 с.' },
  boss: { emoji: '👹', title: 'Босс', rules: 'Der Fehlerteufel собран из слов, где ты чаще ошибаешься. Бей его верными ответами — у тебя 3 сердца. Один босс в день.' },
};

type Kind = 'choose' | 'article' | 'listen';
interface Question {
  w: Word;
  kind: Kind;
  options: string[];
  answer: number;
}

/** A question about `w`; falls back to translation when the word has no article. */
function makeQuestion(pool: Word[], w: Word, kind: Kind): Question {
  if (kind === 'article' && w.article) {
    const options = ['der', 'die', 'das'];
    return { w, kind, options, answer: options.indexOf(w.article) };
  }
  const right = shortTranslation(w);
  const wrong = shuffle([...new Set(pool.map(shortTranslation))].filter((t) => t !== right)).slice(0, 3);
  const options = shuffle([right, ...wrong]);
  return { w, kind: kind === 'article' ? 'choose' : kind, options, answer: options.indexOf(right) };
}

const pickWord = (pool: Word[], last?: Word) => {
  const others = pool.filter((w) => w.id !== last?.id);
  return others[Math.floor(Math.random() * others.length)] ?? pool[0];
};

const pickOne = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** Pays out a run: doubled for the first game of the day, with the level-up screen when a level is crossed. */
function usePayout() {
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const pay = (amount: number) => {
    const first = takeFirstGameOfDay();
    const before = levelOf(getData().stats.xp).level;
    const xp = addXp(first ? amount * 2 : amount);
    const after = levelOf(getData().stats.xp).level;
    if (after > before) {
      sfx.levelUp();
      setLevelUp(after);
    }
    return { xp, first };
  };
  const screen = levelUp !== null ? <LevelUpScreen level={levelUp} onDone={() => setLevelUp(null)} /> : null;
  return { pay, screen };
}

/** A short banner over the playing field: medals and records reached mid-run. */
function useToast() {
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const show = (text: string) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));
  const node = toast ? (
    <div key={toast.n} className="game-toast">
      {toast.text}
    </div>
  ) : null;
  return { show, node };
}

/**
 * Tracks one scored run (speed, survival): unique words for XP, medals and the record as they are reached.
 * `old` is the record before this run, so the chase line can say how far it is.
 */
function useRun(game: 'speed' | 'survival', toast: (t: string) => void) {
  const [old] = useState(() => getData().stats.records[game]);
  const words = useRef(new Set<string>());
  const medal = useRef(0);
  const hit = (w: Word, score: number) => {
    words.current.add(w.id);
    const m = medalFor(game, score);
    if (m > medal.current) {
      medal.current = m;
      sfx.chest();
      toast(`${MEDAL_ICON[m]} ${MEDAL_NAME[m]}! +${MEDAL_XP[m - 1]} XP`);
    } else if (old > 0 && score === old + 1) {
      sfx.crit();
      toast('🏆 Новый рекорд!');
    }
  };
  const chase = (score: number) =>
    old > 0 ? <span className={`pill record-chase ${score > old ? 'beaten' : ''}`}>{score > old ? '🏆 Рекорд!' : `🏆 ${old} · ещё ${old - score + 1}`}</span> : null;
  /** Saves the record and medal; returns what the run earned before the daily double. */
  const finish = (score: number) => {
    const record = saveGameRecord(game, score);
    saveMedal(game, medal.current);
    const base = words.current.size * XP_PER_WORD + medalXp(medal.current) + (record ? RECORD_XP : 0);
    return { base, record, medal: medal.current, unique: words.current.size };
  };
  return { hit, chase, finish };
}

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)} с`;

export function recordLine(id: GameId): string {
  const d = getData();
  const r = d.stats.records;
  if (id === 'boss') return d.stats.bossWonDay === todayKey() ? 'Побеждён ✓ · завтра новый' : 'Ждёт тебя';
  const medal = MEDAL_ICON[d.stats.medals[id]];
  const rec = id === 'pairs' ? (r.pairs ? `Рекорд ${fmtTime(r.pairs)}` : '') : r[id] ? `Рекорд ${r[id]}` : '';
  return rec ? `${medal ? `${medal} ` : ''}${rec}` : 'Рекорда нет';
}

export function Game({ id, onClose }: { id: GameId; onClose: () => void }) {
  const [run, setRun] = useState(0); // 0 = intro, then one number per attempt
  const pool = useMemo(() => unlockedWords(getData()), []);
  const g = GAMES[id];
  const bossDone = id === 'boss' && getData().stats.bossWonDay === todayKey();

  if (!run)
    return (
      <div className="overlay game-intro">
        <div className="overlay-inner">
          <div className="game-emoji">{id === 'boss' ? <Boss size={130} /> : g.emoji}</div>
          <div className="chest-title">{g.title}</div>
          <p className="muted" style={{ fontWeight: 600 }}>
            {g.rules}
          </p>
          <div className="pill review-pill">{recordLine(id)}</div>
          {getData().stats.gamesDay !== todayKey() && <p className="small" style={{ fontWeight: 700 }}>⚡ Первая игра дня — XP ×2</p>}
          {pool.length < MIN_WORDS[id] ? (
            <p className="muted">
              Нужно минимум {MIN_WORDS[id]} слов в словаре — сейчас {pool.length}.
            </p>
          ) : bossDone ? (
            <p className="muted">Сегодня босс уже повержен. Новый появится завтра.</p>
          ) : (
            <button className="chunky c-peach" onClick={() => setRun(1)}>
              Старт
            </button>
          )}
          <button className="link" onClick={onClose}>
            Назад
          </button>
        </div>
      </div>
    );

  const again = () => setRun(run + 1);
  switch (id) {
    case 'speed':
      return <SpeedGame key={run} pool={pool} onAgain={again} onClose={onClose} />;
    case 'survival':
      return <SurvivalGame key={run} pool={pool} onAgain={again} onClose={onClose} />;
    case 'pairs':
      return <PairsGame key={run} pool={pool} onAgain={again} onClose={onClose} />;
    case 'boss':
      return <BossGame key={run} pool={pool} onAgain={again} onClose={onClose} />;
  }
}

interface GameProps {
  pool: Word[];
  onAgain: () => void;
  onClose: () => void;
}

/** Feed-like frame: close button, a status line, the playing field. */
function Shell({ onClose, status, toast, children }: { onClose: () => void; status: ReactNode; toast?: ReactNode; children: ReactNode }) {
  return (
    <div className="feed game">
      <header className="feed-top">
        <button className="feed-close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        {status}
      </header>
      <div className="feed-stage">
        <div className="feed-card">
          {toast}
          {children}
        </div>
      </div>
    </div>
  );
}

/** One multiple-choice question; after a pick it shows right and wrong until the next one. */
function QuestionView({ q, picked, onPick }: { q: Question; picked: number | null; onPick: (i: number) => void }) {
  useEffect(() => {
    if (q.kind === 'listen') speak(fullGerman(q.w));
  }, [q]);
  const label = q.kind === 'article' ? 'Какой артикль?' : q.kind === 'listen' ? 'Послушай и выбери перевод' : 'Переведи';
  return (
    <>
      <span className="feed-label">{label}</span>
      <div className="lesson-card">
        {q.kind === 'listen' ? (
          <button className="speaker big" onClick={() => speak(fullGerman(q.w))} aria-label="Озвучить">
            🔊
          </button>
        ) : (
          <div className="feed-word">{q.kind === 'article' ? `___ ${q.w.lemma}` : fullGerman(q.w)}</div>
        )}
        {picked !== null && q.kind !== 'choose' && <p className="feed-example">{fullGerman(q.w)} — {shortTranslation(q.w)}</p>}
      </div>
      <div className={`options ${q.kind === 'article' ? 'row3' : ''}`}>
        {q.options.map((o, i) => {
          const cls = picked === null ? '' : i === q.answer ? 'ok' : i === picked ? 'bad' : 'dim';
          return (
            <button key={i} className={`option ${cls} ${q.kind === 'article' ? `art-${o}` : ''}`} disabled={picked !== null} onClick={() => onPick(i)}>
              {o}
            </button>
          );
        })}
      </div>
    </>
  );
}

interface Outcome {
  xp: number;
  first: boolean;
  record?: boolean;
  medal?: number;
  unique?: number;
}

/** Result screen shared by every game; without `onAgain` there is no replay (the boss after a win). */
function GameOver(props: { title: string; big: ReactNode; sub: string; out: Outcome; win?: boolean; gems?: number; onAgain?: () => void; onClose: () => void }) {
  const { title, big, sub, out, win, gems, onAgain, onClose } = props;
  const happy = out.record || win || !!out.medal;
  return (
    <div className="overlay game-over">
      {happy && <Confetti count={140} />}
      <div className="overlay-inner">
        <Mascot mood={happy ? 'happy' : 'wait'} />
        <div className="summary-title">{title}</div>
        <div className="game-big">{big}</div>
        <div className="muted" style={{ fontWeight: 600 }}>
          {sub}
        </div>
        <div className="game-badges">
          {out.record && <span className="pill golden-pill record-pill">🏆 Новый рекорд! +{RECORD_XP} XP</span>}
          {!!out.medal && (
            <span className="pill record-pill medal-pill">
              {MEDAL_ICON[out.medal]} {MEDAL_NAME[out.medal]} · +{medalXp(out.medal)} XP
            </span>
          )}
          {out.first && <span className="pill record-pill first-pill">⚡ Первая игра дня · XP ×2</span>}
        </div>
        <div className="stat-tiles">
          <div className="c-lav">
            <b>+{out.xp}</b>
            <span>XP</span>
          </div>
          {out.unique !== undefined && (
            <div className="c-mint">
              <b>{out.unique}</b>
              <span>разных слов</span>
            </div>
          )}
          {!!gems && (
            <div className="c-sky">
              <b>+{gems}</b>
              <span>кристаллов</span>
            </div>
          )}
        </div>
        {onAgain ? (
          <button className="chunky c-peach" onClick={onAgain}>
            Ещё раз
          </button>
        ) : (
          <button className="chunky c-peach" onClick={onClose}>
            Готово
          </button>
        )}
        {onAgain && (
          <button className="link" onClick={onClose}>
            Выйти
          </button>
        )}
      </div>
    </div>
  );
}

/** Answers one question, then moves on after a short pause (longer on a mistake, so the right answer is seen). */
function useQuiz(next: () => Question) {
  const [q, setQ] = useState(next);
  const [picked, setPicked] = useState<number | null>(null);
  const advance = (delay: number) =>
    setTimeout(() => {
      setPicked(null);
      setQ(next());
    }, delay);
  return { q, picked, setPicked, advance };
}

function SpeedGame({ pool, onAgain, onClose }: GameProps) {
  const last = useRef<Word | undefined>(undefined);
  const nextQ = () => {
    const w = pickWord(pool, last.current);
    last.current = w;
    return makeQuestion(pool, w, 'choose');
  };
  const { q, picked, setPicked, advance } = useQuiz(nextQ);
  const end = useRef(Date.now() + SPEED_MS);
  const [left, setLeft] = useState(SPEED_MS);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [over, setOver] = useState<Outcome | null>(null);
  const { pay, screen } = usePayout();
  const toast = useToast();
  const run = useRun('speed', toast.show);
  const lastTick = useRef(99);

  useEffect(() => {
    if (over) return;
    const t = setInterval(() => {
      const ms = Math.max(0, end.current - Date.now());
      setLeft(ms);
      const sec = Math.ceil(ms / 1000);
      if (sec <= 5 && sec < lastTick.current && ms > 0) sfx.tick();
      lastTick.current = sec;
      if (ms === 0) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [over]);

  useEffect(() => {
    if (left > 0 || over) return;
    const r = run.finish(score);
    sfx.fanfare();
    setOver({ ...pay(r.base), record: r.record, medal: r.medal, unique: r.unique });
  }, [left]);

  const pick = (i: number) => {
    if (picked !== null || left === 0) return;
    setPicked(i);
    if (i === q.answer) {
      setScore(score + 1);
      setStreak(streak + 1);
      sfx.correct(streak + 1);
      run.hit(q.w, score + 1);
      advance(250);
    } else {
      setStreak(0);
      end.current -= SPEED_PENALTY_MS;
      sfx.wrong();
      advance(SHOW_WRONG_MS);
    }
  };

  if (over)
    return (
      <>
        <GameOver title="Время вышло!" big={String(score)} sub={`верных ответов · рекорд ${getData().stats.records.speed}`} out={over} onAgain={onAgain} onClose={onClose} />
        {screen}
      </>
    );
  return (
    <Shell
      onClose={onClose}
      toast={toast.node}
      status={
        <>
          <PBar value={left / SPEED_MS} accent={left < 10_000 ? 'pink' : 'butter'} h={14} />
          <span className="feed-count">{Math.ceil(left / 1000)} с</span>
          <span className="pill combo-pill">✓ {score}</span>
        </>
      }
    >
      {run.chase(score)}
      <QuestionView q={q} picked={picked} onPick={pick} />
    </Shell>
  );
}

function Hearts({ n }: { n: number }) {
  return (
    <span className="hearts" aria-label={`Жизней: ${n}`}>
      {Array.from({ length: LIVES }, (_, i) => (
        <i key={i} className={i < n ? '' : 'lost'}>
          ❤️
        </i>
      ))}
    </span>
  );
}

function SurvivalGame({ pool, onAgain, onClose }: GameProps) {
  const last = useRef<Word | undefined>(undefined);
  const scoreRef = useRef(0);
  const seen = useRef(new Set<string>());
  const listening = getData().settings.listening;
  // Harder formats join as the run goes on, and a word seen before comes back in a harder one
  const nextQ = () => {
    const w = pickWord(pool, last.current);
    last.current = w;
    const s = scoreRef.current;
    let kinds: Kind[] = s < 5 ? ['choose'] : s < 12 ? ['choose', 'article'] : listening ? ['choose', 'article', 'listen'] : ['choose', 'article'];
    if (seen.current.has(w.id)) {
      const hard: Kind[] = [...(w.article ? ['article' as const] : []), ...(listening ? ['listen' as const] : [])];
      if (hard.length) kinds = hard;
    }
    seen.current.add(w.id);
    return makeQuestion(pool, w, pickOne(kinds));
  };
  const { q, picked, setPicked, advance } = useQuiz(nextQ);
  const [lives, setLives] = useState(LIVES);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState<Outcome | null>(null);
  const { pay, screen } = usePayout();
  const toast = useToast();
  const run = useRun('survival', toast.show);

  const pick = (i: number) => {
    if (picked !== null || over) return;
    setPicked(i);
    if (i === q.answer) {
      scoreRef.current = score + 1;
      setScore(score + 1);
      sfx.correct(Math.min(score + 1, 8));
      run.hit(q.w, score + 1);
      advance(350);
      return;
    }
    const n = lives - 1;
    setLives(n);
    if (n > 0) {
      sfx.wrong();
      advance(SHOW_WRONG_MS);
      return;
    }
    sfx.comboBreak();
    setTimeout(() => {
      const r = run.finish(score);
      if (r.record || r.medal) sfx.fanfare();
      setOver({ ...pay(r.base), record: r.record, medal: r.medal, unique: r.unique });
    }, SHOW_WRONG_MS);
  };

  if (over)
    return (
      <>
        <GameOver title="Жизни кончились" big={String(score)} sub={`вопросов продержался · рекорд ${getData().stats.records.survival}`} out={over} onAgain={onAgain} onClose={onClose} />
        {screen}
      </>
    );
  return (
    <Shell
      onClose={onClose}
      toast={toast.node}
      status={
        <>
          <Hearts n={lives} />
          <span style={{ flex: 1 }} />
          <span className="pill combo-pill">✓ {score}</span>
        </>
      }
    >
      {run.chase(score)}
      <QuestionView q={q} picked={picked} onPick={pick} />
    </Shell>
  );
}

type Tile = { id: string; text: string };

/** Six words in one column, their translations shuffled in the other; tap one of each to match. */
function PairsGame({ pool, onAgain, onClose }: GameProps) {
  const deal = () => {
    // Words with identical translations would make a round ambiguous
    const seen = new Set<string>();
    const words = shuffle(pool).filter((w) => {
      const t = shortTranslation(w);
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
    const round = words.slice(0, PAIRS_PER_ROUND);
    return { de: shuffle(round.map((w) => ({ id: w.id, text: fullGerman(w) }))), ru: shuffle(round.map((w) => ({ id: w.id, text: shortTranslation(w) }))) };
  };
  const [round, setRound] = useState(1);
  const [cards, setCards] = useState(deal);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{ side: 'de' | 'ru'; id: string } | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const start = useRef(Date.now());
  const penalty = useRef(0);
  const [now, setNow] = useState(Date.now());
  const [over, setOver] = useState<(Outcome & { ms: number }) | null>(null);
  const { pay, screen } = usePayout();
  const [old] = useState(() => getData().stats.records.pairs);
  const matched = useRef(0);

  useEffect(() => {
    if (over) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [over]);

  const elapsed = now - start.current + penalty.current;

  const tap = (side: 'de' | 'ru', t: Tile) => {
    if (done.has(t.id) || over) return;
    if (!sel || sel.side === side) {
      setSel({ side, id: t.id });
      if (side === 'de') speak(t.text);
      return;
    }
    if (sel.id === t.id) {
      const nextDone = new Set(done).add(t.id);
      setDone(nextDone);
      setSel(null);
      matched.current++;
      sfx.correct(Math.min(matched.current, 8));
      if (nextDone.size < cards.de.length) return;
      if (round < PAIRS_ROUNDS) {
        setTimeout(() => {
          setRound(round + 1);
          setCards(deal());
          setDone(new Set());
        }, 400);
        return;
      }
      const ms = Date.now() - start.current + penalty.current;
      const record = saveGameRecord('pairs', ms);
      const medal = medalFor('pairs', ms);
      saveMedal('pairs', medal);
      sfx.fanfare();
      setOver({ ms, ...pay(PAIRS_XP + medalXp(medal) + (record ? RECORD_XP : 0)), record, medal });
      return;
    }
    penalty.current += PAIRS_PENALTY_MS;
    sfx.wrong();
    setBad([sel.id, t.id]);
    setSel(null);
    setTimeout(() => setBad([]), 400);
  };

  if (over)
    return (
      <>
        <GameOver title="Все пары собраны!" big={fmtTime(over.ms)} sub={`3 раунда · рекорд ${fmtTime(getData().stats.records.pairs)}`} out={over} onAgain={onAgain} onClose={onClose} />
        {screen}
      </>
    );

  const col = (side: 'de' | 'ru') =>
    cards[side].map((t) => {
      const cls = done.has(t.id) ? 'matched' : sel?.side === side && sel.id === t.id ? 'sel' : bad.includes(t.id) ? 'bad' : '';
      return (
        <button key={`${side}-${t.id}`} className={`pair-tile ${cls} ${side === 'de' ? 'de' : ''}`} disabled={done.has(t.id)} onClick={() => tap(side, t)}>
          {t.text}
        </button>
      );
    });

  return (
    <Shell
      onClose={onClose}
      status={
        <>
          <PBar value={(round - 1 + done.size / cards.de.length) / PAIRS_ROUNDS} accent="lav" h={14} />
          <span className="feed-count">{fmtTime(elapsed)}</span>
        </>
      }
    >
      {old > 0 && <span className={`pill record-chase ${elapsed > old ? 'late' : ''}`}>🏆 рекорд {fmtTime(old)}</span>}
      <span className="feed-label">
        Раунд {round} из {PAIRS_ROUNDS} · соедини пары
      </span>
      <div className="pairs">
        <div>{col('de')}</div>
        <div>{col('ru')}</div>
      </div>
    </Shell>
  );
}

/** The day's boss: words with the most lapses first, then the hardest ones. */
function bossWords(pool: Word[]): Word[] {
  const score = (w: Word) => (w.card?.lapses ?? 0) * 10 + (w.card?.difficulty ?? 0);
  return [...pool].sort((a, b) => score(b) - score(a)).slice(0, BOSS_SIZE);
}

function BossGame({ pool, onAgain, onClose }: GameProps) {
  const words = useMemo(() => bossWords(pool), [pool]);
  const hp = words.length;
  // Every boss word must be answered once; a missed one goes back into the queue
  const queue = useRef(shuffle(words));
  const kinds: Kind[] = getData().settings.listening ? ['choose', 'article', 'listen'] : ['choose', 'article'];
  const nextQ = () => makeQuestion(pool, queue.current[0], pickOne(kinds));
  const { q, picked, setPicked, advance } = useQuiz(nextQ);
  const [lives, setLives] = useState(LIVES);
  const [hits, setHits] = useState(0);
  const [shake, setShake] = useState(0);
  const [react, setReact] = useState<{ mood: BossMood; n: number } | null>(null);
  const reactTimer = useRef(0);
  const [over, setOver] = useState<(Outcome & { win: boolean; gems: number }) | null>(null);
  const { pay, screen } = usePayout();
  useEffect(() => () => clearTimeout(reactTimer.current), []);

  /** Short reaction on top of the base mood; `dead` stays. */
  const flash = (mood: BossMood, ms: number) => {
    clearTimeout(reactTimer.current);
    setReact((r) => ({ mood, n: (r?.n ?? 0) + 1 }));
    if (mood !== 'dead') reactTimer.current = window.setTimeout(() => setReact(null), ms);
  };

  const pick = (i: number) => {
    if (picked !== null || over) return;
    setPicked(i);
    const w = queue.current.shift()!;
    if (i === q.answer) {
      const h = hits + 1;
      setHits(h);
      setShake((n) => n + 1);
      sfx.correct(Math.min(h, 8));
      if (h < hp) {
        flash('hit', 500);
        return void advance(450);
      }
      flash('dead', 0);
      winBoss(BOSS_GEMS);
      sfx.fanfare();
      setTimeout(() => setOver({ ...pay(BOSS_XP + h * XP_PER_WORD), win: true, gems: BOSS_GEMS }), 1300);
      return;
    }
    queue.current.push(w);
    const n = lives - 1;
    setLives(n);
    flash('laugh', 750);
    if (n > 0) {
      sfx.wrong();
      advance(SHOW_WRONG_MS);
      return;
    }
    sfx.comboBreak();
    setTimeout(() => setOver({ ...pay(hits * XP_PER_WORD), win: false, gems: 0 }), SHOW_WRONG_MS);
  };

  if (over)
    return (
      <>
        <GameOver
          title={over.win ? 'Босс повержен!' : 'Босс устоял'}
          big={<Boss mood={over.win ? 'dead' : 'gloat'} size={124} />}
          sub={over.win ? 'Слова, где ты ошибался, теперь твои. Новый босс — завтра.' : `Осталось ${hp - hits} из ${hp} здоровья — попробуй ещё раз`}
          out={over}
          win={over.win}
          gems={over.gems}
          onAgain={over.win ? undefined : onAgain}
          onClose={onClose}
        />
        {screen}
      </>
    );
  return (
    <Shell
      onClose={onClose}
      status={
        <>
          <Hearts n={lives} />
          <span style={{ flex: 1 }} />
        </>
      }
    >
      <div className="boss">
        <div className="boss-stage">
          <Boss key={react?.n ?? 0} mood={react?.mood ?? ((hp - hits) / hp <= 0.3 ? 'scared' : 'idle')} size={150} />
          {react?.mood === 'hit' && (
            <span key={`dmg${shake}`} className="boss-dmg">
              −1
            </span>
          )}
        </div>
        <div className="boss-name">Der Fehlerteufel</div>
        <PBar value={(hp - hits) / hp} accent="pink" h={12} />
      </div>
      <QuestionView q={q} picked={picked} onPick={pick} />
    </Shell>
  );
}
