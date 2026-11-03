import { useMemo, useState } from 'react';
import { liveChunks, removeChunks, removeWord, removeWords, resetChunkProgress, resetWordProgress, updateChunk, updateWord, useData, type Chunk, type Word } from '../lib/store';
import { AddWordSheet } from './AddWordSheet';
import { AddChunkSheet } from './AddChunkSheet';
import { fullGerman, shortTranslation } from '../lib/feed';
import { speak } from '../lib/tts';
import { TabBar, type Tab } from './TabBar';
import { articleClass, Mascot, StatStrip, TopBar } from './ui';

interface Props {
  onTab: (t: Tab) => void;
  onLearn: () => void;
}

type Filter = 'all' | 'learning' | 'known' | 'hard' | 'soon';

const FILTERS: [Filter, string][] = [
  ['all', 'Все'],
  ['soon', 'Повтор'],
  ['learning', 'Учу'],
  ['known', 'Знаю'],
  ['hard', 'Трудные'],
];

const DAY = 86400000;

/** What strength, due dates and filters need: both words and chunks have it. */
type Card = Pick<Word, 'status' | 'card'>;

/** 1–5 dots from FSRS stability (days the memory is expected to hold). */
export function strength(w: Card): number {
  if (w.status === 'known') return 5;
  const s = w.card?.stability ?? 0;
  if (!w.card) return 0;
  return s < 1 ? 1 : s < 3 ? 2 : s < 7 ? 3 : s < 21 ? 4 : 5;
}

/** Words the learner keeps forgetting. */
export const isHard = (w: Card) => w.status === 'learning' && !!w.card && (w.card.lapses >= 2 || (w.card.reps >= 3 && w.card.stability < 1));

function nextReview(w: Card): string {
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
    <span className="mastery" aria-label={`Прочность ${n} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Dictionary({ onTab, onLearn }: Props) {
  // Home's "+ Добавить" on the chunks card opens the dictionary on chunks
  const [segment, setSegment] = useState<'words' | 'chunks'>(() => {
    try {
      const s = sessionStorage.getItem('dictSegment');
      sessionStorage.removeItem('dictSegment');
      return s === 'chunks' ? 'chunks' : 'words';
    } catch {
      return 'words';
    }
  });
  const toggle = (
    <div className="segment">
      <button className={segment === 'words' ? 'on' : ''} onClick={() => setSegment('words')}>
        Слова
      </button>
      <button className={segment === 'chunks' ? 'on' : ''} onClick={() => setSegment('chunks')}>
        🧩 Чанки
      </button>
    </div>
  );
  return (
    <div className="screen">
      <TopBar title="Словарь" right={<StatStrip />} />
      {toggle}
      {segment === 'words' ? <WordsBody /> : <ChunksBody />}
      <TabBar active="words" onTab={onTab} onLearn={onLearn} />
    </div>
  );
}

function WordsBody() {
  const data = useData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const words = useMemo(() => Object.values(data.words).filter((w) => !w.deleted), [data.words]);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * DAY;
    return {
      total: words.length,
      learning: words.filter((w) => w.status === 'learning').length,
      known: words.filter((w) => w.status === 'known').length,
      solid: words.filter((w) => strength(w) >= 4).length,
      due: words.filter((w) => w.status === 'learning' && w.card && w.card.due <= new Date().setHours(23, 59, 59, 999)).length,
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
    <>
      <div className="dict-stats">
        <div className="c-lav">
          <b>{stats.total}</b>
          <span>всего</span>
        </div>
        <div className="c-mint">
          <b>{stats.known}</b>
          <span>знаю</span>
        </div>
        <div className="c-butter">
          <b>+{stats.week}</b>
          <span>неделя</span>
        </div>
        <div className="c-pink">
          <b>{stats.hard}</b>
          <span>трудных</span>
        </div>
      </div>

      <div className="dict-actions">
        <button className="chunky c-lav" onClick={() => setAdding(true)}>
          + Добавить
        </button>
        {words.length > 0 && (
          <button
            className={`chip ${selecting ? 'on' : ''}`}
            onClick={() => {
              setSelecting((v) => !v);
              setPicked(new Set());
            }}
          >
            {selecting ? 'Готово' : 'Выбрать'}
          </button>
        )}
      </div>

      <input className="dict-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕  Поиск по-немецки или по-русски" />
      <div className="chips tight">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={filter === id ? 'chip on' : id === 'soon' && stats.due ? 'chip accent c-peach' : 'chip'} onClick={() => setFilter(id)}>
            {label}
            {id === 'soon' && stats.due > 0 && ` ${stats.due}`}
          </button>
        ))}
      </div>

      {words.length === 0 ? (
        <div className="empty">
          <Mascot size={96} mood="wait" />
          <p>Словарь пуст. Нажми на незнакомое слово в тексте и «+ В словарь» — или добавь слово вручную.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Ничего не нашлось.</p>
      ) : (
        <ul className="dict-list">
          {shown.map((w) => (
            <li key={w.id}>
              <button
                className={`dict-row ${picked.has(w.id) ? 'picked' : ''}`}
                onClick={() =>
                  selecting
                    ? setPicked((cur) => {
                        const next = new Set(cur);
                        if (next.has(w.id)) next.delete(w.id);
                        else next.add(w.id);
                        return next;
                      })
                    : setOpenId(w.id)
                }
              >
                {selecting && <span className={`check ${picked.has(w.id) ? 'on' : ''}`}>{picked.has(w.id) ? '✓' : ''}</span>}
                <span className={`art-bar ${articleClass(w.article)}`} />
                <span className="dict-main">
                  <span className="dict-de">
                    {w.article && <span className="a">{w.article} </span>}
                    {w.lemma}
                  </span>
                  <span className="dict-ru ellipsis" style={{ display: 'block' }}>
                    {shortTranslation(w)}
                  </span>
                </span>
                <span className="dict-side">
                  <Dots n={strength(w)} />
                  {w.status === 'learning' && w.card && w.card.due <= Date.now() ? (
                    <span className="due-label">повторить</span>
                  ) : isHard(w) ? (
                    <span className="due-label">трудное</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selecting && (
        <div className="select-bar">
          <button className="chip" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((w) => w.id)))}>
            {picked.size === shown.length ? 'Снять все' : 'Выбрать все'}
          </button>
          <button
            className="chunky c-pink"
            disabled={picked.size === 0}
            onClick={() => {
              if (!confirm(`Удалить ${picked.size} из словаря?`)) return;
              removeWords([...picked]);
              setPicked(new Set());
              setSelecting(false);
            }}
          >
            Удалить {picked.size || ''}
          </button>
        </div>
      )}
      {adding && <AddWordSheet onClose={() => setAdding(false)} />}
      {open && !open.deleted && <WordDetails w={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ChunksBody() {
  const data = useData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const chunks = useMemo(() => liveChunks(data), [data]);
  const endOfDay = new Date().setHours(23, 59, 59, 999);
  const due = chunks.filter((c) => c.status === 'learning' && c.card && c.card.due <= endOfDay).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chunks
      .filter((c) => {
        if (filter === 'learning' && c.status !== 'learning') return false;
        if (filter === 'known' && c.status !== 'known') return false;
        if (filter === 'hard' && !isHard(c)) return false;
        if (filter === 'soon' && !(c.status === 'learning' && c.card && c.card.due <= endOfDay)) return false;
        if (!q) return true;
        return `${c.text} ${c.translation}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (filter === 'soon' ? (a.card?.due ?? 0) - (b.card?.due ?? 0) : b.createdAt - a.createdAt));
  }, [chunks, query, filter, endOfDay]);

  const open = openId ? data.chunks[openId] : null;

  return (
    <>
      <div className="dict-stats">
        <div className="c-lav">
          <b>{chunks.length}</b>
          <span>всего</span>
        </div>
        <div className="c-mint">
          <b>{chunks.filter((c) => strength(c) >= 4).length}</b>
          <span>крепких</span>
        </div>
        <div className="c-butter">
          <b>{due}</b>
          <span>повтор</span>
        </div>
        <div className="c-pink">
          <b>{chunks.filter(isHard).length}</b>
          <span>трудных</span>
        </div>
      </div>

      <div className="dict-actions">
        <button className="chunky c-lav" onClick={() => setAdding(true)}>
          + Добавить
        </button>
      </div>

      <input className="dict-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕  Поиск по чанкам" />
      <div className="chips tight">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={filter === id ? 'chip on' : id === 'soon' && due ? 'chip accent c-peach' : 'chip'} onClick={() => setFilter(id)}>
            {label}
            {id === 'soon' && due > 0 && ` ${due}`}
          </button>
        ))}
      </div>

      {chunks.length === 0 ? (
        <div className="empty">
          <Mascot size={96} mood="wait" />
          <p>Чанков пока нет. В тексте нажми на слово (или выдели фразу долгим нажатием) и «🧩 Учить чанком» — приложение соберёт готовое словосочетание с примерами. Или добавь чанк вручную.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Ничего не нашлось.</p>
      ) : (
        <ul className="dict-list">
          {shown.map((c) => (
            <li key={c.id}>
              <button className="dict-row" onClick={() => setOpenId(c.id)}>
                <span className="art-bar chunk-bar" />
                <span className="dict-main">
                  <span className="dict-de">{c.text}</span>
                  <span className="dict-ru ellipsis" style={{ display: 'block' }}>
                    {c.translation}
                  </span>
                </span>
                <span className="dict-side">
                  <Dots n={strength(c)} />
                  {c.status === 'learning' && c.card && c.card.due <= Date.now() ? (
                    <span className="due-label">повторить</span>
                  ) : isHard(c) ? (
                    <span className="due-label">трудный</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddChunkSheet onClose={() => setAdding(false)} />}
      {open && !open.deleted && <ChunkDetails c={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ChunkDetails({ c, onClose }: { c: Chunk; onClose: () => void }) {
  return (
    <>
      <button className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={c.text}>
        <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="sheet-head">
          <span className="sheet-word phrase">{c.text}</span>
          <button className="speak" onClick={() => speak(c.text)} aria-label="Озвучить">
            🔊
          </button>
        </div>
        <p className="sheet-tr">{c.translation}</p>
        {c.note && <p className="muted small">{c.note}</p>}
        <ul className="chunk-examples">
          {c.examples.map((e, i) => (
            <li key={i}>
              <button className="speak" onClick={() => speak(e.de)} aria-label="Озвучить пример">
                🔊
              </button>
              <span>
                <span className="de">{e.de}</span>
                <span className="muted small">{e.ru}</span>
              </span>
            </li>
          ))}
        </ul>
        {c.source && <p className="muted small">из текста «{c.source}»</p>}

        <div className="word-stats">
          <span>
            Прочность <Dots n={strength(c)} />
          </span>
          <span>{nextReview(c)}</span>
          {c.card && (
            <span>
              повторений {c.card.reps}, ошибок {c.card.lapses}
            </span>
          )}
          <span>добавлено {new Date(c.createdAt).toLocaleDateString('ru-RU')}</span>
        </div>

        <div className="sheet-actions">
          {c.status === 'learning' ? (
            <button onClick={() => updateChunk(c.id, { status: 'known' })}>Знаю</button>
          ) : (
            <button onClick={() => updateChunk(c.id, { status: 'learning' })}>Учить снова</button>
          )}
          {c.card && (
            <button
              className="link"
              onClick={() => {
                if (confirm('Сбросить прогресс? Чанк начнётся заново как новый.')) resetChunkProgress(c.id);
              }}
            >
              Сбросить прогресс
            </button>
          )}
          <button
            className="link danger"
            onClick={() => {
              if (confirm(`Удалить «${c.text}»?`)) {
                removeChunks([c.id]);
                onClose();
              }
            }}
          >
            Удалить
          </button>
        </div>
      </div>
    </>
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
          {w.article && <span className={`pill art-pill ${articleClass(w.article)}`}>{w.article}</span>}
          <span className="sheet-word">{w.lemma}</span>
          <button className="speak" onClick={() => speak(fullGerman(w))} aria-label="Озвучить">
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
              <button className="chunky c-mint" onClick={save}>
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
