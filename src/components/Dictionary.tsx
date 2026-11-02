import { useMemo, useState } from 'react';
import { removeWord, resetWordProgress, updateWord, useData, type Word } from '../lib/store';
import { fullGerman, shortTranslation } from '../lib/feed';
import { speak } from '../lib/tts';
import { SyncBadge } from './SyncBadge';
import { TabBar, type Tab } from './TabBar';

interface Props {
  onTab: (t: Tab) => void;
  onLearn: () => void;
  onSettings: () => void;
}

type Filter = 'all' | 'learning' | 'known' | 'hard' | 'soon';

const FILTERS: [Filter, string][] = [
  ['all', 'Все'],
  ['learning', 'Учу'],
  ['known', 'Знаю'],
  ['hard', 'Трудные'],
  ['soon', 'Повтор сегодня'],
];

const DAY = 86400000;

/** 1–5 dots from FSRS stability (days the memory is expected to hold). */
export function strength(w: Word): number {
  if (w.status === 'known') return 5;
  const s = w.card?.stability ?? 0;
  if (!w.card) return 0;
  return s < 1 ? 1 : s < 3 ? 2 : s < 7 ? 3 : s < 21 ? 4 : 5;
}

/** Words the learner keeps forgetting. */
export const isHard = (w: Word) => w.status === 'learning' && !!w.card && (w.card.lapses >= 2 || (w.card.reps >= 3 && w.card.stability < 1));

function nextReview(w: Word): string {
  if (w.status === 'known') return 'знаешь';
  if (!w.card) return 'ещё не начато';
  const diff = w.card.due - Date.now();
  if (diff <= 0) return 'пора повторить';
  if (diff < DAY) return 'повтор сегодня';
  const days = Math.round(diff / DAY);
  return `повтор через ${days} дн.`;
}

function Dots({ n }: { n: number }) {
  return (
    <span className="dots" aria-label={`Прочность ${n} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Dictionary({ onTab, onLearn, onSettings }: Props) {
  const data = useData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const words = useMemo(() => Object.values(data.words).filter((w) => !w.deleted), [data.words]);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * DAY;
    return {
      total: words.length,
      learning: words.filter((w) => w.status === 'learning').length,
      known: words.filter((w) => w.status === 'known').length,
      solid: words.filter((w) => strength(w) >= 4).length,
      week: words.filter((w) => w.createdAt >= weekAgo).length,
      hard: words.filter(isHard).length,
    };
  }, [words]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const endOfDay = new Date().setHours(23, 59, 59, 999);
    return words
      .filter((w) => {
        if (filter === 'learning' && w.status !== 'learning') return false;
        if (filter === 'known' && w.status !== 'known') return false;
        if (filter === 'hard' && !isHard(w)) return false;
        if (filter === 'soon' && !(w.status === 'learning' && w.card && w.card.due <= endOfDay)) return false;
        if (!q) return true;
        return `${fullGerman(w)} ${w.translation} ${w.meanings}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (filter === 'soon' ? (a.card?.due ?? 0) - (b.card?.due ?? 0) : b.createdAt - a.createdAt));
  }, [words, query, filter]);

  const open = openId ? data.words[openId] : null;

  return (
    <div className="screen">
      <header className="bar">
        <h1>Словарь</h1>
        <div className="bar-actions">
          <SyncBadge />
          <button className="icon-btn" onClick={onSettings} aria-label="Настройки">
            ⚙︎
          </button>
        </div>
      </header>

      <div className="dict-stats">
        <div>
          <b>{stats.total}</b>
          <span>всего</span>
        </div>
        <div>
          <b>{stats.solid}</b>
          <span>закреплено</span>
        </div>
        <div>
          <b>+{stats.week}</b>
          <span>за неделю</span>
        </div>
        <div className={stats.hard ? 'warn' : ''}>
          <b>{stats.hard}</b>
          <span>трудных</span>
        </div>
      </div>

      <input className="dict-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по-немецки или по-русски" />
      <div className="chips">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={filter === id ? 'chip on' : 'chip'} onClick={() => setFilter(id)}>
            {label}
            {id === 'learning' && ` ${stats.learning}`}
            {id === 'known' && ` ${stats.known}`}
          </button>
        ))}
      </div>

      {words.length === 0 ? (
        <div className="empty">
          <p>Словарь пуст. Открой текст, нажми на незнакомое слово и «Учить».</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Ничего не нашлось.</p>
      ) : (
        <ul className="dict-list">
          {shown.map((w) => (
            <li key={w.id}>
              <button className="dict-row" onClick={() => setOpenId(w.id)}>
                <span className="dict-de">{fullGerman(w)}</span>
                <span className="dict-ru">{shortTranslation(w)}</span>
                <span className="dict-meta">
                  <Dots n={strength(w)} />
                  <span>{nextReview(w)}</span>
                  {isHard(w) && <span className="tag tag-learning">трудное</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !open.deleted && <WordDetails w={open} onClose={() => setOpenId(null)} />}
      <TabBar active="words" onTab={onTab} onLearn={onLearn} />
    </div>
  );
}

function WordDetails({ w, onClose }: { w: Word; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [translation, setTranslation] = useState(w.translation);
  const [meanings, setMeanings] = useState(w.meanings);

  const save = () => {
    updateWord(w.id, { translation: translation.trim() || w.translation, meanings: meanings.trim() });
    setEditing(false);
  };

  return (
    <>
      <button className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={fullGerman(w)}>
        <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="sheet-head">
          <span className="sheet-word">{fullGerman(w)}</span>
          <button className="icon-btn" onClick={() => speak(fullGerman(w))} aria-label="Озвучить">
            🔊
          </button>
        </div>
        <p className="muted small">{[w.pos, w.plural && `мн. ${w.plural}`].filter(Boolean).join(' · ')}</p>

        {editing ? (
          <>
            <label className="field">
              <span>Перевод</span>
              <input value={translation} onChange={(e) => setTranslation(e.target.value)} />
            </label>
            <label className="field">
              <span>Значения (через запятую)</span>
              <input value={meanings} onChange={(e) => setMeanings(e.target.value)} />
            </label>
            <div className="row">
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditing(false)}>Отмена</button>
            </div>
          </>
        ) : (
          <>
            <p className="sheet-tr">{w.translation}</p>
            {w.meanings && <p className="small">Значения: {w.meanings}</p>}
            {w.example && <p className="feed-example">«{w.example}»</p>}
            {w.note && <p className="muted small">{w.note}</p>}
          </>
        )}

        <div className="word-stats">
          <span>
            Прочность <Dots n={strength(w)} />
          </span>
          <span>{nextReview(w)}</span>
          {w.card && (
            <span>
              повторений {w.card.reps}, ошибок {w.card.lapses}
            </span>
          )}
          <span>добавлено {new Date(w.createdAt).toLocaleDateString('ru-RU')}</span>
        </div>

        {!editing && (
          <div className="sheet-actions">
            <button onClick={() => setEditing(true)}>Исправить перевод</button>
            {w.status === 'learning' ? (
              <button onClick={() => updateWord(w.id, { status: 'known' })}>Знаю</button>
            ) : (
              <button onClick={() => updateWord(w.id, { status: 'learning' })}>Учить снова</button>
            )}
            {w.card && (
              <button
                className="link"
                onClick={() => {
                  if (confirm('Сбросить прогресс? Слово начнётся заново как новое.')) resetWordProgress(w.id);
                }}
              >
                Сбросить прогресс
              </button>
            )}
            <button
              className="link danger"
              onClick={() => {
                if (confirm(`Удалить «${fullGerman(w)}» из словаря?`)) {
                  removeWord(w.id);
                  onClose();
                }
              }}
            >
              Удалить
            </button>
          </div>
        )}
      </div>
    </>
  );
}
