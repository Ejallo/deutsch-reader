import { useCallback, useEffect, useRef, useState } from 'react';
import { addXp, countPractice, DAILY_GOAL, getData, learningCards, recordGoal, saveChunkReview, saveReview, todayProgress, updateSettings, useData, type Chunk, type ChunkExample, type Word } from '../lib/store';
import { review, type Answer } from '../lib/srs';
import { afterAnswer, checkChunk, checkGap, checkTiles, checkWritten, EXTRA_NEW_STEP, fullGerman, isSpecial, newSession, nextItem, shortTranslation, type FeedItem, type Format } from '../lib/feed';
import { comboMultiplier, XP } from '../lib/gamify';
import { sfx, unlockAudio } from '../lib/sfx';
import { speak } from '../lib/tts';
import { BlitzCard, ChestCard, Confetti, MilestoneCard, SentenceCard } from './SpecialCards';
import { ChestScreen, LessonSummary, type SessionStats } from './Rewards';
import { Mascot, PBar } from './ui';

interface Props {
  onClose: () => void;
}

type Result = { answer: Answer; picked?: number; typed?: string; xp?: number };

const AUTO_NEXT_MS = 1100;
const ROUND_BONUS_XP = 20;
const LEAVE_MS = 260;
const SWIPE_PX = 60;
// A correct chunk answer faster than this counts as "easy" and is scheduled much further out
const EASY_MS: Partial<Record<Format, number>> = { 'c-choose': 4000, 'c-tiles': 9000, 'c-write': 7000, 'c-ru': 9000 };

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
  const autoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touchY = useRef<number | null>(null);
  const stats = useRef<SessionStats>({ xp: 0, correct: 0, wrong: 0, maxCombo: 0 });
  const [showChest, setShowChest] = useState(false);

  const load = useCallback(() => {
    const r = nextItem(getData(), session.current);
    setItem(r.item);
    setEmpty(r.item ? null : r.reason);
    setResult(null);
    setSpecialDone(false);
    setRoundDone(0);
  }, []);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    load();
  }, [load]);

  const needsWord = !!item && !isSpecial(item.format) && !item.chunkId;
  const word: Word | undefined = item && needsWord ? data.words[item.wordId] : undefined;
  const liveChunk = item?.chunkId ? data.chunks[item.chunkId] : undefined;
  const chunk: Chunk | undefined = liveChunk && !liveChunk.deleted && liveChunk.examples.length ? liveChunk : undefined;
  const example: ChunkExample | undefined = chunk ? chunk.examples[Math.min(item?.ex ?? 0, chunk.examples.length - 1)] : undefined;
  const shownAt = useRef(0);

  const goNext = useCallback(() => {
    clearTimeout(autoTimer.current);
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
      session.current.celebrateGoal = true;
    } else if (n > DAILY_GOAL && n % DAILY_GOAL === 0) {
      stats.current.xp += addXp(ROUND_BONUS_XP);
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
    const nextCombo = answer === 'good' ? session.current.combo + 1 : answer === 'hard' ? session.current.combo : 0;
    session.current.combo = nextCombo;
    setCombo(nextCombo);
    const base = answer === 'good' ? XP.good * comboMultiplier(nextCombo) : answer === 'hard' ? XP.hard : 0;
    const xp = addXp(base);
    const st = stats.current;
    st.xp += xp;
    if (answer === 'again') st.wrong++;
    else st.correct++;
    st.maxCombo = Math.max(st.maxCombo, nextCombo);
    if (answer === 'good') sfx.correct(nextCombo);
    else if (answer === 'hard') sfx.almost();
    else sfx.wrong();

    setResult({ answer, xp, ...extra });
    if (getData().settings.listening) setTimeout(() => speak(say), 250);
    if (answer === 'good') autoTimer.current = setTimeout(goNext, AUTO_NEXT_MS);
  };

  const finishIntro = () => {
    if (!item) return;
    afterAnswer(session.current, item, true, 0);
    stats.current.xp += addXp(XP.intro);
    goNext();
  };

  const finishSpecial = (xp: number) => {
    stats.current.xp += addXp(xp);
    setSpecialDone(true);
  };

  const finishSentence = (xp: number) => {
    if (!item) return;
    countPractice();
    countTowardGoal();
    afterAnswer(session.current, item, true, 0);
    stats.current.xp += addXp(xp);
    setSpecialDone(true);
  };

  const moreNew = () => {
    session.current.extraNew += EXTRA_NEW_STEP;
    session.current.offeredMore = false;
    goNext();
  };

  const canAdvance = !!item && (item.format === 'intro' || item.format === 'c-intro' || !!result || specialDone);

  // Swipe up / wheel / keys move to the next card once this one is done
  const tryAdvance = () => {
    if (!canAdvance || leaving) return;
    if (item?.format === 'intro' || item?.format === 'c-intro') finishIntro();
    else goNext();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') tryAdvance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const p = todayProgress(data);
  const rounds = Math.floor(p.reviewed / DAILY_GOAL);
  const mult = comboMultiplier(combo);

  const renderCard = () => {
    if (!item) return null;
    const pick = (i: number) => submit(i === item.answer ? 'good' : 'again', { picked: i });
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
    if (chunk && example) {
      switch (item.format) {
        case 'c-intro':
          return <ChunkIntroCard c={chunk} e={example} onDone={finishIntro} />;
        case 'c-choose':
          return <ChunkChooseCard e={example} item={item} result={result} onPick={pick} />;
        case 'c-tiles':
          return <ChunkTilesCard e={example} tiles={item.tiles ?? []} result={result} onCheck={(order) => submit(checkTiles(example, order), { typed: order.join(' ') })} />;
        case 'c-write':
          return <ChunkWriteCard e={example} result={result} onCheck={(typed) => submit(checkGap(example, typed), { typed })} />;
        case 'c-ru':
          return <ChunkRuCard c={chunk} result={result} onCheck={(typed) => submit(checkChunk(chunk, typed), { typed })} />;
      }
      return null;
    }
    if (!word) return null;
    switch (item.format) {
      case 'intro':
        return <IntroCard w={word} onDone={finishIntro} />;
      case 'choose':
        return <ChooseCard w={word} item={item} result={result} onPick={pick} />;
      case 'listen':
        return <ListenCard w={word} item={item} result={result} onPick={pick} />;
      case 'article':
        return <ArticleCard w={word} item={item} result={result} onPick={pick} combo={combo} />;
      case 'write':
        return <WriteCard w={word} result={result} onCheck={(typed) => submit(checkWritten(word, typed), { typed })} />;
      case 'sentence':
        return <SentenceCard w={word} done={specialDone} onFinish={finishSentence} onNext={goNext} />;
    }
    return null;
  };

  return (
    <div
      className="feed"
      onPointerDown={unlockAudio}
      onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (touchY.current !== null && touchY.current - e.changedTouches[0].clientY > SWIPE_PX) tryAdvance();
        touchY.current = null;
      }}
      onWheel={(e) => {
        if (e.deltaY > 40) tryAdvance();
      }}
    >
      <header className="feed-top">
        <button className="feed-close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        <PBar value={(p.reviewed % DAILY_GOAL) / DAILY_GOAL} accent="mint" h={14} />
        {rounds > 0 && (
          <span key={rounds} className="pill rounds-pill" title="Раунды за сегодня">
            ✓×{rounds}
          </span>
        )}
        {mult > 1 ? (
          <span key={mult} className="pill combo-pill">
            ⚡×{combo}
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

      <div className="feed-stage">
        {empty && (
          <EmptyCard
            reason={empty}
            limit={data.settings.newPerDay}
            onClose={onClose}
            onMore={() => {
              session.current.extraNew += EXTRA_NEW_STEP;
              load();
            }}
          />
        )}
        {item && (word || chunk || isSpecial(item.format)) && item.format !== 'goal' && (
          <div key={item.key} className={`feed-card ${leaving ? 'leaving' : 'entering'} ${result ? `res-${result.answer}` : ''} fmt-${item.format}`}>
            {((result?.answer === 'good' && combo > 0 && combo % 3 === 0) || roundDone > 0) && <Confetti />}
            {renderCard()}
            {!!result?.xp && <span className="xp-float">+{result.xp} XP</span>}
          </div>
        )}
      </div>

      {result && (word || (chunk && example)) && (
        <ResultSheet
          result={result}
          solution={word ? fullGerman(word) : item?.format === 'c-ru' ? chunk!.text : example!.de}
          meaning={word ? shortTranslation(word) : item?.format === 'c-ru' ? chunk!.translation : example!.ru}
          combo={combo}
          round={roundDone}
          onNext={goNext}
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
function ResultSheet({ result, solution, meaning, combo, round, onNext }: { result: Result; solution: string; meaning: string; combo: number; round: number; onNext: () => void }) {
  const mult = comboMultiplier(combo);
  const roundLine = round > 0 ? `Раунд ${round} пройден! +${ROUND_BONUS_XP} XP` : '';
  if (result.answer === 'good') {
    return (
      <div className="result-sheet c-mint">
        <div className="head">
          <div className="mark">✓</div>
          <div>
            <div className="ttl">Richtig!</div>
            <div className="sub">
              +{result.xp ?? 0} XP{mult > 1 ? ` · комбо ×${combo}` : ''}
            </div>
            {roundLine && <div className="sub" style={{ fontWeight: 800, opacity: 1 }}>{roundLine}</div>}
          </div>
        </div>
        <button className="chunky c-card" onClick={onNext}>
          Дальше
        </button>
      </div>
    );
  }
  return (
    <div className={`result-sheet ${result.answer === 'hard' ? 'c-butter' : 'c-pink'}`}>
      <div className="ttl">Почти! 💪</div>
      <div className="sub">
        Правильно: <b>{solution}</b> — {meaning}{/[.!?…]$/.test(meaning) ? '' : '.'}{result.answer === 'again' ? ' Карточка вернётся через пару карточек.' : ''}
      </div>
      {roundLine && <div className="sub" style={{ fontWeight: 800, opacity: 1 }}>{roundLine}</div>}
      <button className="chunky c-card" onClick={onNext}>
        Понятно
      </button>
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
  const [value, setValue] = useState('');
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
  const [placed, setPlaced] = useState<number[]>([]);
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

function MoreCard({ left, onMore, onSkip }: { left: number; onMore: () => void; onSkip: () => void }) {
  return (
    <>
      <Mascot size={110} />
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

function EmptyCard({ reason, limit, onClose, onMore }: { reason: 'empty' | 'limit'; limit: number; onClose: () => void; onMore: () => void }) {
  return (
    <div className="feed-card entering">
      <Mascot size={110} />
      {reason === 'empty' ? (
        <>
          <p className="feed-tr">Пока нечего учить</p>
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
