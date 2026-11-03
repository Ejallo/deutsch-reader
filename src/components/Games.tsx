import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addXp, getData, saveGameRecord, todayKey, unlockedWords, winBoss, type GameId, type Word } from '../lib/store';
import { fullGerman, shortTranslation, shuffle } from '../lib/feed';
import { levelOf } from '../lib/gamify';
import { sfx } from '../lib/sfx';
import { speak } from '../lib/tts';
import { Confetti } from './SpecialCards';
import { LevelUpScreen } from './Rewards';
import { Mascot, PBar } from './ui';

// Mini-games are play on top of learning: they give XP but never touch the FSRS schedule or the daily goal
export const GAME_MIN_WORDS = 6;
const SPEED_MS = 60_000;
const SPEED_PENALTY_MS = 2000;
const LIVES = 3;
const PAIRS_ROUNDS = 3;
const PAIRS_PER_ROUND = 6;
const PAIRS_PENALTY_MS = 3000;
const BOSS_SIZE = 8;
const BOSS_XP = 150;
const BOSS_GEMS = 30;
const RECORD_XP = 50;
const XP_PER_HIT = 3;
const SHOW_WRONG_MS = 900;

export const GAMES: Record<GameId, { emoji: string; title: string; rules: string }> = {
  speed: { emoji: '⚡', title: 'Скорость', rules: '60 секунд: выбирай перевод как можно быстрее. Ошибка отнимает 2 секунды.' },
  survival: { emoji: '❤️', title: 'Выживание', rules: '3 жизни, вопросы без конца, и они становятся сложнее. Сколько продержишься?' },
  pairs: { emoji: '🧩', title: 'Пары', rules: 'Соедини 6 слов с переводами. 3 раунда на время, ошибка +3 секунды.' },
  boss: { emoji: '👹', title: 'Босс', rules: 'Der Fehlerteufel собран из слов, где ты чаще ошибаешься. Бей его верными ответами — у тебя 3 сердца.' },
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

/** XP plus the level-up screen when it crosses a level. */
function useGain() {
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const gain = (amount: number) => {
    const before = levelOf(getData().stats.xp).level;
    const got = addXp(amount);
    const after = levelOf(getData().stats.xp).level;
    if (after > before) {
      sfx.levelUp();
      setLevelUp(after);
    }
    return got;
  };
  const screen = levelUp !== null ? <LevelUpScreen level={levelUp} onDone={() => setLevelUp(null)} /> : null;
  return { gain, screen };
}

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)} с`;

export function recordLine(id: GameId): string {
  const d = getData();
  const r = d.stats.records;
  if (id === 'boss') return d.stats.bossWonDay === todayKey() ? 'Побеждён ✓' : 'Ждёт тебя';
  if (id === 'pairs') return r.pairs ? `Рекорд ${fmtTime(r.pairs)}` : 'Рекорда нет';
  return r[id] ? `Рекорд ${r[id]}` : 'Рекорда нет';
}

export function Game({ id, onClose }: { id: GameId; onClose: () => void }) {
  const [run, setRun] = useState(0); // 0 = intro, then one number per attempt
  const pool = useMemo(() => unlockedWords(getData()), []);
  const g = GAMES[id];

  if (!run)
    return (
      <div className="overlay game-intro">
        <div className="overlay-inner">
          <div className="game-emoji">{g.emoji}</div>
          <div className="chest-title">{g.title}</div>
          <p className="muted" style={{ fontWeight: 600 }}>
            {g.rules}
          </p>
          <div className="pill review-pill">{recordLine(id)}</div>
          {pool.length < GAME_MIN_WORDS ? (
            <p className="muted">Нужно минимум {GAME_MIN_WORDS} слов в словаре — сейчас {pool.length}.</p>
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
function Shell({ onClose, status, children }: { onClose: () => void; status: ReactNode; children: ReactNode }) {
  return (
    <div className="feed game">
      <header className="feed-top">
        <button className="feed-close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        {status}
      </header>
      <div className="feed-stage">
        <div className="feed-card">{children}</div>
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

/** Result screen shared by every game. */
function GameOver(props: { title: string; big: string; sub: string; record: boolean; win?: boolean; xp: number; gems?: number; onAgain: () => void; onClose: () => void; extra?: ReactNode }) {
  const { title, big, sub, record, win, xp, gems, onAgain, onClose, extra } = props;
  const happy = record || win;
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
        {record && <div className="pill golden-pill record-pill">🏆 Новый рекорд! +{RECORD_XP} XP</div>}
        <div className="stat-tiles">
          <div className="c-lav">
            <b>+{xp}</b>
            <span>XP</span>
          </div>
          {!!gems && (
            <div className="c-sky">
              <b>+{gems}</b>
              <span>кристаллов</span>
            </div>
          )}
        </div>
        {extra}
        <button className="chunky c-peach" onClick={onAgain}>
          Ещё раз
        </button>
        <button className="link" onClick={onClose}>
          Выйти
        </button>
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
  const [over, setOver] = useState<{ xp: number; record: boolean } | null>(null);
  const { gain, screen } = useGain();
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
    const record = saveGameRecord('speed', score);
    sfx.fanfare();
    if (record) sfx.crit();
    setOver({ xp: gain(score * XP_PER_HIT + (record ? RECORD_XP : 0)), record });
  }, [left]);

  const pick = (i: number) => {
    if (picked !== null || left === 0) return;
    setPicked(i);
    if (i === q.answer) {
      setScore(score + 1);
      setStreak(streak + 1);
      sfx.correct(streak + 1);
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
        <GameOver title="Время вышло!" big={String(score)} sub={`верных ответов · рекорд ${getData().stats.records.speed}`} record={over.record} xp={over.xp} onAgain={onAgain} onClose={onClose} />
        {screen}
      </>
    );
  return (
    <Shell
      onClose={onClose}
      status={
        <>
          <PBar value={left / SPEED_MS} accent={left < 10_000 ? 'pink' : 'butter'} h={14} />
          <span className="feed-count">{Math.ceil(left / 1000)} с</span>
          <span className="pill combo-pill">✓ {score}</span>
        </>
      }
    >
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
  // Harder formats join as the run goes on
  const nextQ = () => {
    const w = pickWord(pool, last.current);
    last.current = w;
    const s = scoreRef.current;
    const kinds: Kind[] = s < 5 ? ['choose'] : s < 12 ? ['choose', 'article'] : getData().settings.listening ? ['choose', 'article', 'listen'] : ['choose', 'article'];
    return makeQuestion(pool, w, kinds[Math.floor(Math.random() * kinds.length)]);
  };
  const { q, picked, setPicked, advance } = useQuiz(nextQ);
  const [lives, setLives] = useState(LIVES);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState<{ xp: number; record: boolean } | null>(null);
  const { gain, screen } = useGain();

  const pick = (i: number) => {
    if (picked !== null || over) return;
    setPicked(i);
    if (i === q.answer) {
      scoreRef.current = score + 1;
      setScore(score + 1);
      sfx.correct(Math.min(score + 1, 8));
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
      const record = saveGameRecord('survival', score);
      if (record) sfx.fanfare();
      setOver({ xp: gain(score * XP_PER_HIT + (record ? RECORD_XP : 0)), record });
    }, SHOW_WRONG_MS);
  };

  if (over)
    return (
      <>
        <GameOver title="Жизни кончились" big={String(score)} sub={`вопросов продержался · рекорд ${getData().stats.records.survival}`} record={over.record} xp={over.xp} onAgain={onAgain} onClose={onClose} />
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
          <span className="pill combo-pill">✓ {score}</span>
        </>
      }
    >
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
  const [over, setOver] = useState<{ ms: number; xp: number; record: boolean } | null>(null);
  const { gain, screen } = useGain();
  const matched = useRef(0);

  useEffect(() => {
    if (over) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [over]);

  const elapsed = (over?.ms ?? now - start.current) + (over ? 0 : penalty.current);

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
      sfx.fanfare();
      setOver({ ms, xp: gain(30 + (record ? RECORD_XP : 0)), record });
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
        <GameOver title="Все пары собраны!" big={fmtTime(over.ms)} sub={`3 раунда · рекорд ${fmtTime(getData().stats.records.pairs)}`} record={over.record} xp={over.xp} onAgain={onAgain} onClose={onClose} />
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
  const nextQ = () => makeQuestion(pool, queue.current[0], kinds[Math.floor(Math.random() * kinds.length)]);
  const { q, picked, setPicked, advance } = useQuiz(nextQ);
  const [lives, setLives] = useState(LIVES);
  const [hits, setHits] = useState(0);
  const [shake, setShake] = useState(0);
  const [over, setOver] = useState<{ win: boolean; xp: number; gems: number } | null>(null);
  const { gain, screen } = useGain();
  const [alreadyWon] = useState(() => getData().stats.bossWonDay === todayKey()); // as of this fight's start

  const pick = (i: number) => {
    if (picked !== null || over) return;
    setPicked(i);
    const w = queue.current.shift()!;
    if (i === q.answer) {
      const h = hits + 1;
      setHits(h);
      setShake((n) => n + 1);
      sfx.correct(Math.min(h, 8));
      if (h < hp) return void advance(450);
      // A repeat win on the same day pays only the hits, so the big reward stays daily
      const gems = alreadyWon ? 0 : BOSS_GEMS;
      if (!alreadyWon) winBoss(gems);
      sfx.fanfare();
      setTimeout(() => setOver({ win: true, xp: gain((alreadyWon ? 0 : BOSS_XP) + h * XP_PER_HIT), gems }), 500);
      return;
    }
    queue.current.push(w);
    const n = lives - 1;
    setLives(n);
    if (n > 0) {
      sfx.wrong();
      advance(SHOW_WRONG_MS);
      return;
    }
    sfx.comboBreak();
    setTimeout(() => setOver({ win: false, xp: gain(hits * XP_PER_HIT), gems: 0 }), SHOW_WRONG_MS);
  };

  if (over)
    return (
      <>
        <GameOver
          title={over.win ? 'Босс повержен!' : 'Босс устоял'}
          big={over.win ? '👹💥' : '👹'}
          sub={over.win ? (alreadyWon ? 'Сегодняшняя награда уже получена — но победа есть победа' : 'Слова, где ты ошибался, теперь твои') : `Осталось ${hp - hits} из ${hp} здоровья — попробуй ещё раз`}
          record={false}
          win={over.win}
          xp={over.xp}
          gems={over.gems}
          onAgain={onAgain}
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
        <div key={shake} className={`boss-face ${shake ? 'hit' : ''}`}>
          👹
        </div>
        <div className="boss-name">Der Fehlerteufel</div>
        <PBar value={(hp - hits) / hp} accent="pink" h={12} />
      </div>
      <QuestionView q={q} picked={picked} onPick={pick} />
    </Shell>
  );
}
