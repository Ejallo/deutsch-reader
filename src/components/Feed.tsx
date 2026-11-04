import { useCallback, useEffect, useRef, useState } from 'react';
import { addXp, countPractice, recordBestCombo, recordPerfectDay, DAILY_GOAL, type LearnMode, getData, learningCards, recordGoal, saveChunkReview, saveReview, todayProgress, updateSettings, useData, type Chunk, type ChunkExample, type Word } from '../lib/store';
import { review, type Answer } from '../lib/srs';
import { afterAnswer, checkChunk, checkGap, checkTiles, checkWritten, EXTRA_NEW_STEP, fullGerman, isSpecial, itemKey, newSession, nextItem, shortTranslation, type FeedItem, type Format } from '../lib/feed';
import { comboMilestone, comboMultiplier, comboTier, GOLDEN_CHANCE, GOLDEN_GAP, GOLDEN_MULT, levelOf, rollCrit, XP } from '../lib/gamify';
import { sfx, unlockAudio } from '../lib/sfx';
import { closestQuest, questEvent, type Metric } from '../lib/quests';
import { waitingCards } from './TabBar';
import { speak } from '../lib/tts';
import { BlitzCard, ChestCard, Confetti, MilestoneCard, SentenceCard } from './SpecialCards';
import { ChestScreen, LessonSummary, LevelUpScreen, type SessionStats } from './Rewards';
import { Mascot, PBar } from './ui';

interface Props {
  onClose: () => void;
}

type Result = { answer: Answer; picked?: number; typed?: string; xp?: number; bonus?: number; golden?: boolean };
/** An answered card kept so it can be looked at again (read-only). */
type Seen = { item: FeedItem; result: Result };
type CardData = { word?: Word; chunk?: Chunk; example?: ChunkExample };

const ROUND_BONUS_XP = 20;
const LEAVE_MS = 260;
const SWIPE_PX = 60;
const HISTORY = 10;
const NAV_GAP_MS = 350; // one wheel flick fires many events: move one card per flick
const MODES: [LearnMode, string][] = [
  ['all', 'Всё'],
  ['words', 'Слова'],
  ['chunks', '🧩 Чанки'],
];
// A correct chunk answer faster than this counts as "easy" and is scheduled much further out
const EASY_MS: Partial<Record<Format, number>> = { 'c-choose': 4000, 'c-tiles': 9000, 'c-write': 7000, 'c-ru': 9000 };
const BREAK_DRAMA = 5; // losing a combo at least this long gets its own moment
const NO_GOLD: Format[] = ['intro', 'c-intro', 'sentence'];
const FAST_MS = 3000; // a correct answer quicker than this counts for the "fast" quest
const HINT_MAX = 5; // "ещё N до…" names a card goal only when it is this close
// Quests the next card can move, for the "ещё N до задания" hint
const HINT_METRICS: Metric[] = ['correct', 'chunk', 'listen', 'fast', 'writePerfect', 'tiles', 'gap', 'fixMistake'];
// Per-format quest counters for a correct answer
const FORMAT_METRIC: Partial<Record<Format, Metric>> = { listen: 'listen', write: 'writePerfect', 'c-tiles': 'tiles', 'c-write': 'gap' };

/** The word or chunk a card is about, as it is in the data now. */
function resolveCard(data: ReturnType<typeof getData>, item: FeedItem | null): CardData {
  if (!item || isSpecial(item.format)) return {};
  if (!item.chunkId) return { word: data.words[item.wordId] };
  const c = data.chunks[item.chunkId];
  if (!c || c.deleted || !c.examples.length) return {};
  return { chunk: c, example: c.examples[Math.min(item.ex ?? 0, c.examples.length - 1)] };
}

/** The right answer and its meaning, shown under an answered card. */
function answerText(item: FeedItem, { word, chunk, example }: CardData) {
  if (word) return { solution: fullGerman(word), meaning: shortTranslation(word) };
  return item.format === 'c-ru' ? { solution: chunk!.text, meaning: chunk!.translation } : { solution: example!.de, meaning: example!.ru };
}

export function Feed({ onClose }: Props) {
  const data = useData();
  const session = useRef(newSession());
  const [item, setItem] = useState<FeedItem | null>(null);
  const [empty, setEmpty] = useState<'empty' | 'limit' | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [specialDone, setSpecialDone] = useState(false);
  const [combo, setCombo] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);
  const touchY = useRef<number | null>(null);
  const stats = useRef<SessionStats>({ xp: 0, correct: 0, wrong: 0, maxCombo: 0 });
  const [showChest, setShowChest] = useState(false);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [broke, setBroke] = useState(0); // length of the combo the last answer just lost
  const lastGolden = useRef(-GOLDEN_GAP);

  const load = useCallback(() => {
    const r = nextItem(getData(), session.current);
    let it = r.item;
    // Now and then a quiz card turns golden and pays several times the XP
    const s = session.current;
    if (it && !isSpecial(it.format) && !NO_GOLD.includes(it.format) && s.count - lastGolden.current >= GOLDEN_GAP && Math.random() < GOLDEN_CHANCE) {
      lastGolden.current = s.count;
      it = { ...it, golden: true };
      sfx.golden();
    }
    setItem(it);
    setEmpty(r.item ? null : r.reason);
    setResult(null);
    setSpecialDone(false);
    setRoundDone(0);
    setBroke(0);
  }, []);

  /** Adds XP and opens the level-up screen when it crosses into a new level. */
  const gainXp = (amount: number) => {
    const before = levelOf(getData().stats.xp).level;
    const got = addXp(amount);
    const after = levelOf(getData().stats.xp).level;
    if (after > before) {
      sfx.levelUp();
      setLevelUp(after);
    }
    questEvent('xp', got);
    return got;
  };

  // Session counters behind quests: cards missed earlier, perfect answers in a row, articles in a row
  const missed = useRef(new Set<string>());
  const cleanRun = useRef(0);
  const articleRun = useRef(0);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    load();
  }, [load]);

  const needsWord = !!item && !isSpecial(item.format) && !item.chunkId;
  const live = resolveCard(data, item);
  const { word, chunk, example } = live;
  const shownAt = useRef(0);

  // Answered cards of this session; `back` points into it while looking at past cards
  const history = useRef<Seen[]>([]);
  const [back, setBack] = useState<number | null>(null);
  const current = useRef<{ item: FeedItem | null; result: Result | null }>({ item: null, result: null });
  current.current = { item, result };
  const lastNav = useRef(0);

  const goNext = useCallback(() => {
    const { item: it, result: r } = current.current;
    const h = history.current;
    if (it && r && h[h.length - 1]?.item.key !== it.key) history.current = [...h, { item: it, result: r }].slice(-HISTORY);
    sfx.swipe();
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      load();
    }, LEAVE_MS);
  }, [load]);

  // Speak when a card appears where hearing the word is the point
  useEffect(() => {
    shownAt.current = Date.now();
    if ((needsWord && !word) || (item?.chunkId && !chunk)) load(); // removed on another screen or device
    else if (word && item && getData().settings.listening && (item.format === 'intro' || item.format === 'listen')) speak(fullGerman(word));
    else if (chunk && item?.format === 'c-intro' && getData().settings.listening) speak(chunk.text);
  }, [item?.key]);

  /** The answer that completes today's goal extends the streak and queues a celebration. */
  // After the daily goal, every next 20 cards is a bonus round with its own small reward
  const [roundDone, setRoundDone] = useState(0);
  const countTowardGoal = () => {
    const n = todayProgress(getData()).reviewed;
    if (n === DAILY_GOAL) {
      recordGoal();
      questEvent('goal');
      session.current.celebrateGoal = true;
    } else if (n > DAILY_GOAL && n % DAILY_GOAL === 0) {
      questEvent('bonusRound');
      stats.current.xp += gainXp(ROUND_BONUS_XP);
      sfx.fanfare();
      setRoundDone(n / DAILY_GOAL);
    }
  };

  const submit = (answer: Answer, extra: Omit<Result, 'answer'> = {}) => {
    if (!item || (!word && !chunk) || result) return;
    let say: string;
    if (chunk && example) {
      const c = getData().chunks[chunk.id];
      const fast = Date.now() - shownAt.current < (EASY_MS[item.format] ?? 0);
      if (item.graded) saveChunkReview(c.id, review(c.card, answer, new Date(), fast), !c.card);
      else countPractice();
      say = item.format === 'c-ru' ? c.text : example.de;
    } else {
      const w = getData().words[item.wordId];
      if (item.graded) saveReview(w.id, review(w.card, answer), !w.card);
      else countPractice();
      say = fullGerman(w);
    }
    countTowardGoal();
    afterAnswer(session.current, item, answer !== 'again', learningCards(getData()).length);

    // "Almost" keeps the combo alive but doesn't grow it
    const prevCombo = session.current.combo;
    const nextCombo = answer === 'good' ? prevCombo + 1 : answer === 'hard' ? prevCombo : 0;
    session.current.combo = nextCombo;
    setCombo(nextCombo);
    // A golden card pays a fixed multiplier; any other correct answer may roll a crit
    const golden = !!item.golden && answer === 'good';
    const bonus = answer !== 'good' ? 1 : golden ? GOLDEN_MULT : rollCrit();
    // The bonus adds to the combo multiplier instead of multiplying it, so levels don't inflate
    const base = answer === 'good' ? XP.good * (comboMultiplier(nextCombo) + bonus - 1) : answer === 'hard' ? XP.hard : 0;
    const xp = gainXp(base);
    const st = stats.current;
    st.xp += xp;
    if (answer === 'again') st.wrong++;
    else st.correct++;
    st.maxCombo = Math.max(st.maxCombo, nextCombo);
    if (answer === 'good') {
      sfx.correct(nextCombo);
      if (bonus > 1) sfx.crit();
      if (comboTier(nextCombo) > comboTier(prevCombo)) sfx.comboUp(comboTier(nextCombo));
    } else if (answer === 'hard') sfx.almost();
    else if (prevCombo >= BREAK_DRAMA) {
      sfx.comboBreak();
      setBroke(prevCombo);
    } else sfx.wrong();

    setResult({ answer, xp, bonus, golden, ...extra });
    if (getData().settings.listening) setTimeout(() => speak(say), 250);
    trackQuests(answer, nextCombo);
  };

  /** Feeds one answer into the quest counters (and the best-combo / perfect-day stats behind badges). */
  const trackQuests = (answer: Answer, nextCombo: number) => {
    if (!item) return;
    const key = itemKey(item);
    if (answer === 'again') missed.current.add(key);
    else {
      questEvent('correct');
      if (item.chunkId) questEvent('chunk');
      if (missed.current.delete(key)) questEvent('fixMistake');
    }
    if (answer === 'good') {
      const m = FORMAT_METRIC[item.format];
      if (m) questEvent(m);
      if (Date.now() - shownAt.current < FAST_MS) questEvent('fast');
    }
    cleanRun.current = answer === 'good' ? cleanRun.current + 1 : 0;
    questEvent('cleanRun', cleanRun.current);
    if (item.format === 'article') {
      articleRun.current = answer === 'good' ? articleRun.current + 1 : 0;
      questEvent('articleRun', articleRun.current);
    }
    questEvent('combo', nextCombo);
    recordBestCombo(nextCombo);
    if (item.graded && waitingCards(getData(), 'all') === 0) questEvent('dueClear');
    // The answer that reaches the goal judges the session's accuracy
    if (todayProgress(getData()).reviewed === DAILY_GOAL) {
      const st = stats.current;
      if (st.correct / Math.max(1, st.correct + st.wrong) >= 0.9) questEvent('accurateGoal');
      if (st.wrong === 0) recordPerfectDay();
    }
  };

  /** The closest thing the next answers unlock: the goal, a quest or a surprise card, else the next level. */
  const nextHint = (): string => {
    const d = getData();
    const s = session.current;
    const near: [number, string][] = [];
    const goalLeft = DAILY_GOAL - todayProgress(d).reviewed;
    if (goalLeft > 0) near.push([goalLeft, `Ещё ${goalLeft} до цели дня`]);
    const q = closestQuest(HINT_METRICS);
    if (q) near.push([q.left, `Ещё ${q.left} до задания «${q.title}»`]);
    const surprise = s.nextSurpriseAt - s.count;
    if (surprise > 0) near.push([surprise, `Ещё ${surprise} до сюрприза 🎁`]);
    const best = near.filter(([n]) => n <= HINT_MAX).sort((a, b) => a[0] - b[0])[0];
    if (best) return best[1];
    const lvl = levelOf(d.stats.xp);
    return `Ещё ${lvl.need - lvl.into} XP до уровня ${lvl.level + 1}`;
  };

  const finishIntro = () => {
    if (!item) return;
    afterAnswer(session.current, item, true, 0);
    stats.current.xp += gainXp(XP.intro);
    questEvent('newWord');
    goNext();
  };

  const finishSpecial = (xp: number) => {
    if (item?.format === 'chest') questEvent('chestFeed');
    if (item?.format === 'blitz') questEvent('blitz', xp / XP.blitzHit);
    stats.current.xp += gainXp(xp);
    setSpecialDone(true);
  };

  const finishSentence = (xp: number) => {
    if (!item) return;
    countPractice();
    countTowardGoal();
    afterAnswer(session.current, item, true, 0);
    stats.current.xp += gainXp(xp);
    questEvent('sentence');
    setSpecialDone(true);
  };

  const switchMode = (m: LearnMode) => {
    if (m === getData().settings.learnMode) return;
    updateSettings({ learnMode: m });
    session.current.offeredMore = false;
    setBack(null);
    load(); // cards of the other kind still queued are dropped by nextItem
  };

  const moreNew = () => {
    session.current.extraNew += EXTRA_NEW_STEP;
    session.current.offeredMore = false;
    goNext();
  };

  const canAdvance = !!item && (item.format === 'intro' || item.format === 'c-intro' || !!result || specialDone);

  const navReady = () => {
    const t = Date.now();
    if (t - lastNav.current < NAV_GAP_MS) return false;
    lastNav.current = t;
    return true;
  };

  // Swipe down / wheel up / ↓ shows the previous answered card, read-only
  const canBack = !leaving && item?.format !== 'goal' && !showChest && (back ?? history.current.length) > 0;
  const goBack = () => {
    if (!canBack || !navReady()) return;
    sfx.swipe();
    setBack((back ?? history.current.length) - 1);
  };
  const goForward = () => {
    if (back === null || !navReady()) return;
    setBack(back + 1 < history.current.length ? back + 1 : null);
  };

  // Swipe up / wheel / keys move to the next card once this one is done
  const tryAdvance = () => {
    if (back !== null) return goForward();
    if (!canAdvance || leaving) return;
    if (item?.format === 'intro' || item?.format === 'c-intro') finishIntro();
    else goNext();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') tryAdvance();
      if (e.key === 'ArrowDown') goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const p = todayProgress(data);
  const rounds = Math.floor(p.reviewed / DAILY_GOAL);
  const tier = comboTier(combo);

  // A past card is drawn by the same components with its saved result, so every control stays locked
  const renderQuiz = (it: FeedItem, res: Result | null, { word, chunk, example }: CardData, readOnly: boolean) => {
    const ans = (answer: Answer, extra: Omit<Result, 'answer'>) => !readOnly && submit(answer, extra);
    const pick = (i: number) => ans(i === it.answer ? 'good' : 'again', { picked: i });
    if (chunk && example) {
      switch (it.format) {
        case 'c-intro':
          return <ChunkIntroCard c={chunk} e={example} onDone={finishIntro} />;
        case 'c-choose':
          return <ChunkChooseCard e={example} item={it} result={res} onPick={pick} />;
        case 'c-tiles':
          return <ChunkTilesCard e={example} tiles={it.tiles ?? []} result={res} onCheck={(order) => ans(checkTiles(example, order), { typed: order.join(' ') })} />;
        case 'c-write':
          return <ChunkWriteCard e={example} result={res} onCheck={(typed) => ans(checkGap(example, typed), { typed })} />;
        case 'c-ru':
          return <ChunkRuCard c={chunk} result={res} onCheck={(typed) => ans(checkChunk(chunk, typed), { typed })} />;
      }
      return null;
    }
    if (!word) return null;
    switch (it.format) {
      case 'intro':
        return <IntroCard w={word} onDone={finishIntro} />;
      case 'choose':
        return <ChooseCard w={word} item={it} result={res} onPick={pick} />;
      case 'listen':
        return <ListenCard w={word} item={it} result={res} onPick={pick} />;
      case 'article':
        return <ArticleCard w={word} item={it} result={res} onPick={pick} combo={readOnly ? 0 : combo} />;
      case 'write':
        return <WriteCard w={word} result={res} onCheck={(typed) => ans(checkWritten(word, typed), { typed })} />;
      case 'sentence':
        return <SentenceCard w={word} done={specialDone} onFinish={finishSentence} onNext={goNext} />;
    }
    return null;
  };

  const renderCard = () => {
    if (!item) return null;
    switch (item.format) {
      case 'chest':
        return <ChestCard done={specialDone} onOpen={finishSpecial} onNext={goNext} />;
      case 'blitz':
        return <BlitzCard ids={item.blitz ?? []} done={specialDone} onFinish={finishSpecial} onNext={goNext} />;
      case 'milestone':
        return <MilestoneCard n={item.milestone ?? 0} onShown={() => setSpecialDone(true)} onNext={goNext} />;
      case 'goal':
        return null;
      case 'more':
        return <MoreCard left={item.left ?? 0} onMore={moreNew} onSkip={goNext} />;
    }
    return renderQuiz(item, result, live, false);
  };

  const seen = back !== null ? history.current[back] : null;
  const past = seen ? resolveCard(data, seen.item) : null;
  const pastOk = !!past && (!!past.word || !!past.example);

  return (
    <div
      className={`feed ${tier === 3 && back === null ? 'combo-hot' : ''}`}
      onPointerDown={unlockAudio}
      onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (touchY.current !== null) {
          const dy = touchY.current - e.changedTouches[0].clientY;
          if (dy > SWIPE_PX) tryAdvance();
          else if (dy < -SWIPE_PX) goBack();
        }
        touchY.current = null;
      }}
      onWheel={(e) => {
        if (e.deltaY > 40) tryAdvance();
        else if (e.deltaY < -40) goBack();
      }}
    >
      <header className="feed-top">
        <button className="feed-close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        <button className="feed-back" onClick={goBack} disabled={!canBack} aria-label="Предыдущая карточка" title="Предыдущая карточка (свайп вниз)">
          ↩
        </button>
        <PBar value={(p.reviewed % DAILY_GOAL) / DAILY_GOAL} accent="mint" h={14} />
        {rounds > 0 && (
          <span key={rounds} className="pill rounds-pill" title="Раунды за сегодня">
            ✓×{rounds}
          </span>
        )}
        {tier > 0 ? (
          <span key={tier} className={`pill combo-pill t${tier}`}>
            {tier === 1 ? '⚡' : tier === 2 ? '🔥' : '🔥🔥'}×{combo}
          </span>
        ) : (
          <span className="feed-count">
            {p.reviewed % DAILY_GOAL}/{DAILY_GOAL}
          </span>
        )}
        <button
          className={`feed-listen ${data.settings.listening ? 'on' : ''}`}
          onClick={() => updateSettings({ listening: !data.settings.listening })}
          aria-label={data.settings.listening ? 'Выключить аудирование' : 'Включить аудирование'}
          title="Аудирование"
        >
          {data.settings.listening ? '🎧' : '🔇'}
        </button>
      </header>

      <div className="segment feed-mode">
        {MODES.map(([m, label]) => (
          <button key={m} className={data.settings.learnMode === m ? 'on' : ''} onClick={() => switchMode(m)}>
            {label}
          </button>
        ))}
      </div>

      <div className="feed-stage">
        {empty && (
          <EmptyCard
            reason={empty}
            mode={data.settings.learnMode}
            limit={data.settings.newPerDay}
            onClose={onClose}
            onMore={() => {
              session.current.extraNew += EXTRA_NEW_STEP;
              load();
            }}
          />
        )}
        {item && (word || chunk || isSpecial(item.format)) && item.format !== 'goal' && (
          // Stays mounted while a past card is shown, so a half-typed answer survives the trip back
          <div key={item.key} className={`feed-card ${leaving ? 'leaving' : 'entering'} ${back !== null ? 'parked' : ''} ${result ? `res-${result.answer}` : ''} ${item.golden ? 'golden' : ''} fmt-${item.format}`}>
            {item.golden && <span className="pill golden-pill">✨ Золотая карточка · ×{GOLDEN_MULT} XP</span>}
            {result?.answer === 'good' &&
              (comboMilestone(combo) || roundDone > 0 || (result.bonus ?? 1) > 1 ? <Confetti count={result.golden ? 160 : 90} /> : <Confetti count={24} power={0.55} />)}
            {renderCard()}
            {!!result?.xp && (
              <span className={`xp-float ${(result.bonus ?? 1) > 1 ? 'big' : ''}`}>
                +{result.xp} XP{result.golden ? ' ✨' : (result.bonus ?? 1) > 1 ? ` · КРИТ ×${result.bonus}` : ''}
              </span>
            )}
            {broke > 0 && <span className="combo-break">💔 Серия ×{broke} сгорела</span>}
          </div>
        )}
        {seen && (
          <div key={`past-${seen.item.key}`} className={`feed-card entering-back reviewing res-${seen.result.answer} fmt-${seen.item.format}`}>
            <span className="pill review-pill">Просмотр · ответ уже засчитан</span>
            {pastOk ? renderQuiz(seen.item, seen.result, past!, true) : <p className="muted">Эта карточка удалена из словаря.</p>}
          </div>
        )}
      </div>

      {result && back === null && (word || (chunk && example)) && (
        <ResultSheet result={result} {...answerText(item!, live)} combo={combo} broke={broke} round={roundDone} hint={nextHint()} onNext={goNext} />
      )}
      {seen && (
        <ReviewSheet
          answer={seen.result.answer}
          text={pastOk ? answerText(seen.item, past!) : null}
          canBack={canBack}
          onBack={goBack}
          onReturn={() => setBack(null)}
        />
      )}

      {item?.format === 'goal' && !showChest && (
        <LessonSummary
          stats={stats.current}
          onChest={() => setShowChest(true)}
          onContinue={() => {
            setSpecialDone(true);
            goNext();
          }}
        />
      )}
      {levelUp !== null && <LevelUpScreen level={levelUp} onDone={() => setLevelUp(null)} />}
      {showChest && (
        <ChestScreen
          onDone={() => {
            setShowChest(false);
            setSpecialDone(true);
            goNext();
          }}
        />
      )}
    </div>
  );
}

/** Mint «Richtig!» or soft pink «Почти!» sheet under the card. */
function ResultSheet({ result, solution, meaning, combo, broke, round, hint, onNext }: { result: Result; solution: string; meaning: string; combo: number; broke: number; round: number; hint: string; onNext: () => void }) {
  const mult = comboMultiplier(combo);
  const bonus = result.bonus ?? 1;
  const roundLine = round > 0 ? `Раунд ${round} пройден! +${ROUND_BONUS_XP} XP` : '';
  if (result.answer === 'good') {
    return (
      <div className="result-sheet c-mint">
        <div className="head">
          <Mascot size={84} mood="happy" />
          <div>
            <div className="ttl">Richtig!</div>
            <div className="sub">
              +{result.xp ?? 0} XP{result.golden ? ` · золотая ×${bonus}` : bonus > 1 ? ` · крит ×${bonus}` : ''}{mult > 1 ? ` · комбо ×${combo}` : ''}
            </div>
            {roundLine && <div className="sub" style={{ fontWeight: 800, opacity: 1 }}>{roundLine}</div>}
          </div>
        </div>
        <div className="next-hint">{hint}</div>
        <button className="chunky c-card" onClick={onNext}>
          Дальше
        </button>
      </div>
    );
  }
  return (
    <div className={`result-sheet ${result.answer === 'hard' ? 'c-butter' : 'c-pink'}`}>
      <div className="head">
        <Mascot size={84} mood={result.answer === 'hard' ? 'wait' : 'sad'} />
        <div>
          <div className="ttl">{result.answer === 'hard' ? 'Почти! 💪' : broke ? `Серия ×${broke} сгорела` : 'Не совсем'}</div>
          <div className="sub">
            Правильно: <b>{solution}</b> — {meaning}{/[.!?…]$/.test(meaning) ? '' : '.'}{result.answer === 'again' ? ' Карточка вернётся через пару карточек.' : ''}
          </div>
        </div>
      </div>
      {roundLine && <div className="sub" style={{ fontWeight: 800, opacity: 1 }}>{roundLine}</div>}
      <div className="next-hint">{hint}</div>
      <button className="chunky c-card" onClick={onNext}>
        Понятно
      </button>
    </div>
  );
}

/** Sheet under a past card: what the right answer was, and the way back to the current card. */
function ReviewSheet({ answer, text, canBack, onBack, onReturn }: { answer: Answer; text: { solution: string; meaning: string } | null; canBack: boolean; onBack: () => void; onReturn: () => void }) {
  const title = answer === 'good' ? 'Ты ответил верно' : answer === 'hard' ? 'Было почти верно' : 'Здесь была ошибка';
  return (
    <div className={`result-sheet ${answer === 'good' ? 'c-mint' : answer === 'hard' ? 'c-butter' : 'c-pink'}`}>
      <div className="head">
        <div>
          <div className="ttl">{title}</div>
          {text && (
            <div className="sub">
              Правильно: <b>{text.solution}</b> — {text.meaning}
            </div>
          )}
        </div>
      </div>
      <div className="review-actions">
        <button className="chunky c-card" disabled={!canBack} onClick={onBack}>
          ↓ Ещё назад
        </button>
        <button className="chunky c-card" onClick={onReturn}>
          К текущей ↑
        </button>
      </div>
    </div>
  );
}

function Speaker({ text, big }: { text: string; big?: boolean }) {
  return (
    <button className={`speaker ${big ? 'big' : ''}`} onClick={() => speak(text)} aria-label="Озвучить">
      🔊
    </button>
  );
}

function IntroCard({ w, onDone }: { w: Word; onDone: () => void }) {
  return (
    <>
      <span className="feed-label">Новое слово</span>
      <div className="lesson-card">
        <Speaker text={fullGerman(w)} />
        <div className="feed-word">{fullGerman(w)}</div>
        {w.plural && <p className="muted small" style={{ margin: 0 }}>мн. ч. {w.plural}</p>}
        <p className="feed-tr">{shortTranslation(w)}</p>
        {w.meanings && <p className="small muted" style={{ margin: 0 }}>{w.meanings}</p>}
        {w.example && <p className="feed-example">„{w.example}“</p>}
        {w.note && <p className="small muted" style={{ margin: 0 }}>{w.note}</p>}
      </div>
      <button className="chunky c-peach feed-cta" onClick={onDone}>
        Запомнил ↑
      </button>
    </>
  );
}

function Options({ item, result, onPick, labels }: { item: FeedItem; result: Result | null; onPick: (i: number) => void; labels?: string[] }) {
  return (
    <div className={`options ${item.format === 'article' ? 'row3' : ''}`}>
      {(labels ?? item.options).map((o, i) => {
        const cls = !result ? '' : i === item.answer ? 'ok' : i === result.picked ? 'bad' : 'dim';
        return (
          <button key={i} className={`option ${cls} ${item.format === 'article' ? `art-${o}` : ''}`} disabled={!!result} onClick={() => onPick(i)}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function ChooseCard({ w, item, result, onPick }: { w: Word; item: FeedItem; result: Result | null; onPick: (i: number) => void }) {
  return (
    <>
      <span className="feed-label">Переведи</span>
      <div className="lesson-card">
        <Speaker text={fullGerman(w)} />
        <div className="feed-word">{fullGerman(w)}</div>
        {w.example && <p className="feed-example">„{w.example}“</p>}
      </div>
      <Options item={item} result={result} onPick={onPick} />
    </>
  );
}

function ListenCard({ w, item, result, onPick }: { w: Word; item: FeedItem; result: Result | null; onPick: (i: number) => void }) {
  return (
    <>
      <span className="feed-label">Послушай и выбери перевод</span>
      <div className="lesson-card">
        <Speaker text={fullGerman(w)} big />
        {result && <div className="feed-word">{fullGerman(w)}</div>}
      </div>
      <Options item={item} result={result} onPick={onPick} />
    </>
  );
}

function ArticleCard({ w, item, result, onPick, combo }: { w: Word; item: FeedItem; result: Result | null; onPick: (i: number) => void; combo: number }) {
  return (
    <>
      <span className="feed-label">Какой артикль?</span>
      <div className="lesson-card">
        {result?.answer === 'good' && combo >= 3 && <span className="pill sticker">КОМБО ×{combo} ⚡</span>}
        <Speaker text={fullGerman(w)} />
        <div className="feed-word">
          {result ? (
            <>
              <span className="ans-chip">{w.article}</span> {w.lemma}
            </>
          ) : (
            <>___ {w.lemma}</>
          )}
        </div>
        <p className="feed-example">{result ? shortTranslation(w) : w.example ? `„${w.example}“` : shortTranslation(w)}</p>
      </div>
      <Options item={item} result={result} onPick={onPick} />
      {!result && <div className="art-hint">der — синий · die — розовый · das — мятный</div>}
    </>
  );
}

const UMLAUTS = ['ä', 'ö', 'ü', 'ß'];

function WriteCard({ w, result, onCheck }: { w: Word; result: Result | null; onCheck: (typed: string) => void }) {
  return (
    <>
      <span className="feed-label">Напиши по-немецки{w.article ? ' с артиклем' : ''}</span>
      <div className="lesson-card">
        <div className="feed-word" style={{ fontSize: 26 }}>
          {shortTranslation(w)}
        </div>
      </div>
      <TypeAnswer result={result} onCheck={onCheck} placeholder={w.article ? 'der / die / das …' : '…'} />
    </>
  );
}

/** Text field with umlaut buttons and a check button. */
function TypeAnswer({ result, onCheck, placeholder }: { result: Result | null; onCheck: (typed: string) => void; placeholder: string }) {
  const [value, setValue] = useState(result?.typed ?? ''); // a past card shows what was typed
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const check = () => {
    if (!value.trim()) {
      setError('Сначала напиши ответ');
      return;
    }
    onCheck(value);
  };

  return (
    <>
      <input
        ref={inputRef}
        className={`write-input ${result ? `res-${result.answer}` : ''}`}
        value={value}
        disabled={!!result}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => e.key === 'Enter' && check()}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
      />
      {!result && (
        <>
          <div className="umlauts">
            {UMLAUTS.map((u) => (
              <button
                key={u}
                onPointerDown={(e) => e.preventDefault()} // keep the keyboard open
                onClick={() => {
                  setValue((v) => v + u);
                  inputRef.current?.focus();
                }}
              >
                {u}
              </button>
            ))}
          </div>
          <button className="chunky c-peach feed-cta" onClick={check}>
            Проверить
          </button>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </>
  );
}

/** Example sentence with the chunk's key word hidden (or shown once answered). */
function Cloze({ e, reveal }: { e: ChunkExample; reveal: boolean }) {
  const i = e.de.indexOf(e.gap);
  const after = e.de.slice(i + e.gap.length);
  const glued = after.match(/^\S*/)![0]; // punctuation right after the gap stays on its line
  return (
    <p className="cloze">
      {e.de.slice(0, i)}
      <span className="nowrap">
        <span className={`gap ${reveal ? 'on' : ''}`}>{reveal ? e.gap : '\u00a0'.repeat(Math.max(4, e.gap.length))}</span>
        {glued}
      </span>
      {after.slice(glued.length)}
    </p>
  );
}

function ChunkIntroCard({ c, e, onDone }: { c: Chunk; e: ChunkExample; onDone: () => void }) {
  return (
    <>
      <span className="feed-label">Новый чанк</span>
      <div className="lesson-card">
        <Speaker text={c.text} />
        <div className="feed-word chunk-text">{c.text}</div>
        <p className="feed-tr">{c.translation}</p>
        {c.note && <p className="small muted" style={{ margin: 0 }}>{c.note}</p>}
        <p className="feed-example">„{e.de}“</p>
        <p className="small muted" style={{ margin: 0 }}>{e.ru}</p>
      </div>
      <button className="chunky c-peach feed-cta" onClick={onDone}>
        Запомнил ↑
      </button>
    </>
  );
}

function ChunkChooseCard({ e, item, result, onPick }: { e: ChunkExample; item: FeedItem; result: Result | null; onPick: (i: number) => void }) {
  return (
    <>
      <span className="feed-label">Вставь пропуск</span>
      <div className="lesson-card">
        <Speaker text={e.de} />
        <Cloze e={e} reveal={!!result} />
        <p className="small muted" style={{ margin: 0 }}>{e.ru}</p>
      </div>
      <Options item={item} result={result} onPick={onPick} />
    </>
  );
}

function ChunkWriteCard({ e, result, onCheck }: { e: ChunkExample; result: Result | null; onCheck: (typed: string) => void }) {
  return (
    <>
      <span className="feed-label">Впиши пропущенное слово</span>
      <div className="lesson-card">
        <Cloze e={e} reveal={!!result} />
        <p className="small muted" style={{ margin: 0 }}>{e.ru}</p>
      </div>
      <TypeAnswer result={result} onCheck={onCheck} placeholder="…" />
    </>
  );
}

function ChunkRuCard({ c, result, onCheck }: { c: Chunk; result: Result | null; onCheck: (typed: string) => void }) {
  const n = c.text.split(/\s+/).length;
  return (
    <>
      <span className="feed-label">Скажи это по-немецки</span>
      <div className="lesson-card">
        <div className="feed-word" style={{ fontSize: 24 }}>
          {c.translation}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {result ? c.text : `чанк из ${n} ${n === 1 ? 'слова' : 'слов'}`}
        </p>
      </div>
      <TypeAnswer result={result} onCheck={onCheck} placeholder="…" />
    </>
  );
}

/** Put the shuffled words of the sentence back in order; tap a placed word to take it back. */
function ChunkTilesCard({ e, tiles, result, onCheck }: { e: ChunkExample; tiles: string[]; result: Result | null; onCheck: (order: string[]) => void }) {
  const [placed, setPlaced] = useState<number[]>(() => restoreOrder(tiles, result?.typed));
  const left = tiles.map((_, i) => i).filter((i) => !placed.includes(i));
  return (
    <>
      <span className="feed-label">Собери предложение</span>
      <div className="lesson-card">
        <p className="feed-tr" style={{ fontSize: 18, textAlign: 'center' }}>
          {e.ru}
        </p>
        <div className={`wtile-line ${result ? `res-${result.answer}` : ''}`}>
          {placed.map((i) => (
            <button key={i} className="wtile" disabled={!!result} onClick={() => setPlaced((p) => p.filter((x) => x !== i))}>
              {tiles[i]}
            </button>
          ))}
        </div>
      </div>
      {!result && (
        <>
          <div className="wtile-pool">
            {left.map((i) => (
              <button key={i} className="wtile" onClick={() => setPlaced((p) => [...p, i])}>
                {tiles[i]}
              </button>
            ))}
          </div>
          <button className="chunky c-peach feed-cta" disabled={left.length > 0} onClick={() => onCheck(placed.map((i) => tiles[i]))}>
            Проверить
          </button>
        </>
      )}
    </>
  );
}

/** Tile indices for a saved answer (words joined by spaces), so a past card shows the sentence as it was built. */
function restoreOrder(tiles: string[], typed?: string) {
  const used: number[] = [];
  for (const t of typed ? typed.split(' ') : []) {
    const i = tiles.findIndex((x, j) => x === t && !used.includes(j));
    if (i >= 0) used.push(i);
  }
  return used;
}

function MoreCard({ left, onMore, onSkip }: { left: number; onMore: () => void; onSkip: () => void }) {
  return (
    <>
      <Mascot size={110} mood="happy" />
      <p className="feed-tr">Лимит новых на сегодня пройден</p>
      <p className="muted">
        Ждут ещё {left}. Можно взять ещё {Math.min(EXTRA_NEW_STEP, left)} или просто повторять уже знакомые.
      </p>
      <button className="chunky c-peach feed-cta" onClick={onMore}>
        + Ещё {Math.min(EXTRA_NEW_STEP, left)} новых
      </button>
      <button className="chunky c-card feed-cta" onClick={onSkip}>
        Только повторять
      </button>
    </>
  );
}

function EmptyCard({ reason, mode, limit, onClose, onMore }: { reason: 'empty' | 'limit'; mode: LearnMode; limit: number; onClose: () => void; onMore: () => void }) {
  return (
    <div className="feed-card entering">
      <Mascot size={110} mood="wait" />
      {reason === 'empty' ? (
        <>
          <p className="feed-tr">{mode === 'chunks' ? 'Чанков пока нет' : mode === 'words' ? 'Слов пока нет' : 'Пока нечего учить'}</p>
          <p className="muted">Открой текст, нажми на незнакомое слово и «+ В словарь» или «Учить чанком» — оно появится здесь.</p>
        </>
      ) : (
        <>
          <p className="feed-tr">На сегодня новые карточки закончились</p>
          <p className="muted">Лимит — {limit} новых в день. Можно взять ещё сейчас.</p>
          <button className="chunky c-peach feed-cta" onClick={onMore}>
            + Ещё {EXTRA_NEW_STEP} новых
          </button>
        </>
      )}
      <button className="chunky c-peach feed-cta" onClick={onClose}>
        Назад
      </button>
    </div>
  );
}
