import { useCallback, useEffect, useRef, useState } from 'react';
import { addXp, countPractice, DAILY_GOAL, getData, recordGoal, saveReview, todayProgress, updateSettings, useData, type Word } from '../lib/store';
import { review, type Answer } from '../lib/srs';
import { afterAnswer, checkWritten, fullGerman, isSpecial, newSession, nextItem, shortTranslation, type FeedItem } from '../lib/feed';
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
const LEAVE_MS = 260;
const SWIPE_PX = 60;

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
  }, []);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    load();
  }, [load]);

  const needsWord = !!item && !isSpecial(item.format);
  const word: Word | undefined = item && needsWord ? data.words[item.wordId] : undefined;

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
    if (needsWord && !word) load(); // word was removed on another screen or device
    else if (word && item && getData().settings.listening && (item.format === 'intro' || item.format === 'listen')) speak(fullGerman(word));
  }, [item?.key]);

  /** The answer that completes today's goal extends the streak and queues a celebration. */
  const countTowardGoal = () => {
    if (todayProgress(getData()).reviewed === DAILY_GOAL) {
      recordGoal();
      session.current.celebrateGoal = true;
    }
  };

  const submit = (answer: Answer, extra: Omit<Result, 'answer'> = {}) => {
    if (!item || !word || result) return;
    const w = getData().words[item.wordId];
    if (item.graded) saveReview(w.id, review(w.card, answer), !w.card);
    else countPractice();
    countTowardGoal();
    const learning = Object.values(getData().words).filter((x) => !x.deleted && x.status === 'learning').length;
    afterAnswer(session.current, item, answer !== 'again', learning);

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
    if (getData().settings.listening) setTimeout(() => speak(fullGerman(w)), 250);
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

  const canAdvance = !!item && (item.format === 'intro' || !!result || specialDone);

  // Swipe up / wheel / keys move to the next card once this one is done
  const tryAdvance = () => {
    if (!canAdvance || leaving) return;
    if (item?.format === 'intro') finishIntro();
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
        <PBar value={p.reviewed / DAILY_GOAL} accent="mint" h={14} />
        {mult > 1 ? (
          <span key={mult} className="pill combo-pill">
            ⚡×{combo}
          </span>
        ) : (
          <span className={`feed-count ${p.reviewed >= DAILY_GOAL ? 'done' : ''}`}>{p.reviewed >= DAILY_GOAL ? `✓ ${p.reviewed}` : `${p.reviewed}/${DAILY_GOAL}`}</span>
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
        {empty && <EmptyCard reason={empty} limit={data.settings.newPerDay} onClose={onClose} />}
        {item && (word || !needsWord) && item.format !== 'goal' && (
          <div key={item.key} className={`feed-card ${leaving ? 'leaving' : 'entering'} ${result ? `res-${result.answer}` : ''} fmt-${item.format}`}>
            {result?.answer === 'good' && combo > 0 && combo % 3 === 0 && <Confetti />}
            {renderCard()}
            {!!result?.xp && <span className="xp-float">+{result.xp} XP</span>}
          </div>
        )}
      </div>

      {result && word && <ResultSheet result={result} w={word} combo={combo} onNext={goNext} />}

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
function ResultSheet({ result, w, combo, onNext }: { result: Result; w: Word; combo: number; onNext: () => void }) {
  const mult = comboMultiplier(combo);
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
        Правильно: <b>{fullGerman(w)}</b> — {shortTranslation(w)}.{result.answer === 'again' ? ' Слово вернётся через пару карточек.' : ''}
      </div>
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
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const check = () => {
    if (!value.trim()) {
      setError('Сначала напиши слово');
      return;
    }
    onCheck(value);
  };

  return (
    <>
      <span className="feed-label">Напиши по-немецки{w.article ? ' с артиклем' : ''}</span>
      <div className="lesson-card">
        <div className="feed-word" style={{ fontSize: 26 }}>
          {shortTranslation(w)}
        </div>
      </div>
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
        placeholder={w.article ? 'der / die / das …' : '…'}
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

function EmptyCard({ reason, limit, onClose }: { reason: 'empty' | 'limit'; limit: number; onClose: () => void }) {
  return (
    <div className="feed-card entering">
      <Mascot size={110} />
      {reason === 'empty' ? (
        <>
          <p className="feed-tr">Пока нечего учить</p>
          <p className="muted">Открой текст, нажми на незнакомое слово и «Учить» — оно появится здесь.</p>
        </>
      ) : (
        <>
          <p className="feed-tr">На сегодня новые слова закончились</p>
          <p className="muted">Лимит — {limit} новых в день. Завтра будут ещё.</p>
        </>
      )}
      <button className="chunky c-peach feed-cta" onClick={onClose}>
        Назад
      </button>
    </div>
  );
}
