import { useCallback, useEffect, useRef, useState } from 'react';
import { countPractice, getData, saveReview, todayProgress, useData, type Word } from '../lib/store';
import { review, type Answer } from '../lib/srs';
import { afterAnswer, checkWritten, fullGerman, newSession, nextItem, shortTranslation, type FeedItem } from '../lib/feed';
import { speak } from '../lib/tts';

interface Props {
  onClose: () => void;
}

type Result = { answer: Answer; picked?: number; typed?: string };

const DAILY_GOAL = 20;
const AUTO_NEXT_MS = 900;
const LEAVE_MS = 260;
const SWIPE_PX = 60;

export function Feed({ onClose }: Props) {
  const data = useData();
  const session = useRef(newSession());
  const [item, setItem] = useState<FeedItem | null>(null);
  const [empty, setEmpty] = useState<'empty' | 'limit' | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touchY = useRef<number | null>(null);

  const load = useCallback(() => {
    const r = nextItem(getData(), session.current);
    setItem(r.item);
    setEmpty(r.item ? null : r.reason);
    setResult(null);
  }, []);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    load();
  }, [load]);

  const word: Word | undefined = item ? data.words[item.wordId] : undefined;

  const goNext = useCallback(() => {
    clearTimeout(autoTimer.current);
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      load();
    }, LEAVE_MS);
  }, [load]);

  // Speak when a card appears where hearing the word is the point
  useEffect(() => {
    if (item && !word) load(); // word was removed on another screen or device
    else if (word && item && (item.format === 'intro' || item.format === 'listen')) speak(fullGerman(word));
  }, [item?.key]);

  const canAdvance = !!item && (item.format === 'intro' || !!result);

  const submit = (answer: Answer, extra: Omit<Result, 'answer'> = {}) => {
    if (!item || !word || result) return;
    const w = getData().words[item.wordId];
    if (item.graded) saveReview(w.id, review(w.card, answer), !w.card);
    else countPractice();
    const learning = Object.values(getData().words).filter((x) => !x.deleted && x.status === 'learning').length;
    afterAnswer(session.current, item, answer !== 'again', learning);
    setResult({ answer, ...extra });
    speak(fullGerman(w));
    if (answer === 'good') autoTimer.current = setTimeout(goNext, AUTO_NEXT_MS);
  };

  const finishIntro = () => {
    if (!item) return;
    afterAnswer(session.current, item, true, 0);
    goNext();
  };

  // Swipe up / wheel / keys move to the next card once this one is done
  const tryAdvance = () => {
    if (!canAdvance || leaving) return;
    if (item?.format === 'intro') finishIntro();
    else goNext();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') tryAdvance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const p = todayProgress(data);
  const now = Date.now();
  const learningWords = Object.values(data.words).filter((w) => !w.deleted && w.status === 'learning');
  const dueCount = learningWords.filter((w) => w.card && w.card.due <= now).length;

  return (
    <div
      className="feed"
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
          ×
        </button>
        <div className="feed-goal">
          <div className="feed-goal-bar">
            <i style={{ width: `${Math.min(100, (p.reviewed / DAILY_GOAL) * 100)}%` }} />
          </div>
          <span>
            {p.reviewed}/{DAILY_GOAL}
          </span>
        </div>
        <span className="feed-due" title="К повторению">
          {dueCount}
        </span>
      </header>

      <div className="feed-stage">
        {empty && <EmptyCard reason={empty} limit={data.settings.newPerDay} onClose={onClose} />}
        {item && word && (
          <div key={item.key} className={`feed-card ${leaving ? 'leaving' : 'entering'} ${result ? `res-${result.answer}` : ''}`}>
            {!item.graded && item.format !== 'intro' && <span className="feed-chip">Повторение</span>}
            {item.format === 'intro' && <IntroCard w={word} onDone={finishIntro} />}
            {item.format === 'choose' && <ChooseCard w={word} item={item} result={result} onPick={(i) => submit(i === item.answer ? 'good' : 'again', { picked: i })} />}
            {item.format === 'listen' && <ListenCard w={word} item={item} result={result} onPick={(i) => submit(i === item.answer ? 'good' : 'again', { picked: i })} />}
            {item.format === 'article' && <ArticleCard w={word} item={item} result={result} onPick={(i) => submit(i === item.answer ? 'good' : 'again', { picked: i })} />}
            {item.format === 'write' && <WriteCard w={word} result={result} onCheck={(typed) => submit(checkWritten(word, typed), { typed })} />}
          </div>
        )}
      </div>

      <div className="feed-bottom">
        {result && result.answer !== 'good' && (
          <button className="feed-next" onClick={goNext}>
            Дальше ↑
          </button>
        )}
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

function Verdict({ result, w }: { result: Result | null; w: Word }) {
  if (!result) return null;
  if (result.answer === 'good') return <p className="verdict good">Верно!</p>;
  return (
    <p className={`verdict ${result.answer}`}>
      {result.answer === 'hard' ? 'Почти! ' : ''}Правильно: <b>{fullGerman(w)}</b>
    </p>
  );
}

function IntroCard({ w, onDone }: { w: Word; onDone: () => void }) {
  return (
    <>
      <span className="feed-label">Новое слово</span>
      <div className="feed-word">
        {fullGerman(w)} <Speaker text={fullGerman(w)} />
      </div>
      {w.plural && <p className="muted">мн. {w.plural}</p>}
      <p className="feed-tr">{shortTranslation(w)}</p>
      {w.meanings && <p className="small muted">{w.meanings}</p>}
      {w.example && <p className="feed-example">«{w.example}»</p>}
      {w.note && <p className="small muted">{w.note}</p>}
      <button className="primary feed-cta" onClick={onDone}>
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
      <span className="feed-label">Выбери перевод</span>
      <div className="feed-word">
        {fullGerman(w)} <Speaker text={fullGerman(w)} />
      </div>
      {w.example && <p className="feed-example">«{w.example}»</p>}
      <Options item={item} result={result} onPick={onPick} />
    </>
  );
}

function ListenCard({ w, item, result, onPick }: { w: Word; item: FeedItem; result: Result | null; onPick: (i: number) => void }) {
  return (
    <>
      <span className="feed-label">Послушай и выбери перевод</span>
      <Speaker text={fullGerman(w)} big />
      {result && <div className="feed-word">{fullGerman(w)}</div>}
      <Options item={item} result={result} onPick={onPick} />
    </>
  );
}

function ArticleCard({ w, item, result, onPick }: { w: Word; item: FeedItem; result: Result | null; onPick: (i: number) => void }) {
  return (
    <>
      <span className="feed-label">Какой артикль?</span>
      <div className="feed-word">
        {result ? fullGerman(w) : <>… {w.lemma}</>}
      </div>
      <p className="muted">{shortTranslation(w)}</p>
      {result && w.plural && <p className="small muted">мн. {w.plural}</p>}
      <Options item={item} result={result} onPick={onPick} />
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
      <p className="feed-tr">{shortTranslation(w)}</p>
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
          <button className="primary feed-cta" onClick={check}>
            Проверить
          </button>
          {error && <p className="error">{error}</p>}
        </>
      )}
      <Verdict result={result} w={w} />
    </>
  );
}

function EmptyCard({ reason, limit, onClose }: { reason: 'empty' | 'limit'; limit: number; onClose: () => void }) {
  return (
    <div className="feed-card entering">
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
      <button className="primary feed-cta" onClick={onClose}>
        К текстам
      </button>
    </div>
  );
}
