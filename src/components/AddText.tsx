import { useEffect, useState } from 'react';
import { addText } from '../lib/store';
import { TopBar, type Accent } from './ui';
import {
  generate,
  grimmTales,
  importFromUrl,
  KLEXIKON,
  LEVELS,
  MINIKLEXIKON,
  WIKINEWS,
  wikiArticle,
  wikiRandom,
  wikiSearch,
  readingMinutes,
  RESSORTS,
  tagesschauArticle,
  tagesschauNews,
  learningWordsByWeakness,
  MAX_WOVEN_WORDS,
  type FoundText,
  type GenStage,
  type Length,
  type Level,
  type NewsItem,
  type Tale,
  type Wiki,
} from '../lib/sources';

interface Props {
  onBack: () => void;
  onSaved: (id: string) => void;
}

type Tab = 'paste' | 'generate' | 'link' | 'library';

const TABS: [Tab, string][] = [
  ['paste', 'Вставить'],
  ['generate', 'Создать'],
  ['link', 'Ссылка'],
  ['library', 'Библиотека'],
];

export function AddText({ onBack, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('paste');
  const save = (t: FoundText) => onSaved(addText(t.title, t.content, t.source, t.notes));

  return (
    <div className="screen">
      <TopBar title="Новый текст" back="Тексты" onBack={onBack} />
      <div className="segmented" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'paste' && <PasteTab onSave={save} />}
      {tab === 'generate' && <GenerateTab onSave={save} />}
      {tab === 'link' && <LinkTab onSave={save} />}
      {tab === 'library' && <LibraryTab onSave={save} />}
    </div>
  );
}

type SaveProps = { onSave: (t: FoundText) => void };

function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function PasteTab({ onSave }: SaveProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const text = content.trim();
    if (!text) return setError('Вставь текст');
    onSave({ title: title.trim() || text.split(/\s+/).slice(0, 5).join(' ') + '…', content: text });
  };

  return (
    <>
      <label className="field">
        <span>Название (необязательно)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kapitel 1" />
      </label>
      <label className="field">
        <span>Текст на немецком</span>
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setError('');
          }}
          rows={14}
          placeholder="Es war einmal…"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="chunky c-peach wide" onClick={save}>
        Сохранить и читать
      </button>
    </>
  );
}

const TOPICS: [string, Accent][] = [
  ['Кафе', 'butter'],
  ['Путешествия', 'sky'],
  ['Работа', 'lav'],
  ['Спорт', 'mint'],
  ['Квартира', 'peach'],
  ['Детектив', 'pink'],
  ['Покупки', 'sky'],
  ['Здоровье', 'mint'],
];

const LEVEL_ACCENT: Record<Level, Accent> = { A1: 'mint', A2: 'mint', B1: 'sky', B2: 'sky', C1: 'lav' };

const LENGTH_OPTIONS: [Length, string, string][] = [
  ['short', 'Короткий', '~1 мин'],
  ['medium', 'Средний', '~3 мин'],
  ['long', 'Длинный', '~6 мин'],
];

function GenerateTab({ onSave }: SaveProps) {
  const [level, setLevel] = useState<Level>('A2');
  const [topic, setTopic] = useState('');
  const [length, setLength] = useState<Length>('medium');
  const [weave, setWeave] = useState(true);
  const [allWords] = useState(learningWordsByWeakness);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(learningWordsByWeakness().slice(0, 8).map((w) => w.id)));
  const [showAll, setShowAll] = useState(false);
  const { busy, error, run } = useTask();
  const [stage, setStage] = useState<GenStage>('writing');
  const pickedLabels = allWords.filter((w) => picked.has(w.id)).map((w) => w.label);

  return (
    <>
      <div className="overline section-label">Уровень</div>
      <div className="levels">
        {LEVELS.map((l) => (
          <button key={l} className={`c-${LEVEL_ACCENT[l]} ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
            {l}
          </button>
        ))}
      </div>
      <div className="overline section-label">Тема</div>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="о чём угодно: футбол, Берлин, кофе…" />
      <div className="chips">
        {TOPICS.map(([t, accent]) => (
          <button key={t} className={`chip topic c-${accent} ${topic === t ? 'on' : ''}`} onClick={() => setTopic(t)}>
            <span className="dot" />
            {t}
          </button>
        ))}
      </div>
      <div className="overline section-label">Длина</div>
      <div className="lengths">
        {LENGTH_OPTIONS.map(([id, label, time]) => (
          <button key={id} className={length === id ? 'on' : ''} onClick={() => setLength(id)}>
            {label}
            <small>{time}</small>
          </button>
        ))}
      </div>
      {allWords.length > 0 && (
        <div className="weave">
          <button className="weave-toggle" onClick={() => setWeave((v) => !v)} aria-pressed={weave}>
            <span className={`switch ${weave ? 'on' : ''}`} />
            <span>
              <b>Добавить изучаемые слова{weave ? ` (${picked.size})` : ''}</b>
              {weave && pickedLabels.length > 0 && (
                <>
                  <br />
                  <span style={{ opacity: 0.7 }}>
                    {pickedLabels.slice(0, 3).join(', ')}
                    {pickedLabels.length > 3 ? '…' : ''}
                  </span>
                </>
              )}
            </span>
          </button>
          {weave && (
            <>
              <div className="weave-list">
                {(showAll ? allWords : allWords.slice(0, 12)).map((w) => {
                  const on = picked.has(w.id);
                  return (
                    <label key={w.id} className={`weave-item ${on ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && picked.size >= MAX_WOVEN_WORDS}
                        onChange={() =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (next.has(w.id)) next.delete(w.id);
                            else next.add(w.id);
                            return next;
                          })
                        }
                      />
                      <span className="weave-de">{w.label}</span>
                      <span className="weave-ru">{w.translation}</span>
                    </label>
                  );
                })}
              </div>
              <div className="row">
                {allWords.length > 12 && (
                  <button className="link" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Свернуть' : `Показать все (${allWords.length})`}
                  </button>
                )}
                {picked.size > 0 && (
                  <button className="link" onClick={() => setPicked(new Set())}>
                    Снять все
                  </button>
                )}
              </div>
              {picked.size >= MAX_WOVEN_WORDS && <p className="muted small">Не больше {MAX_WOVEN_WORDS} слов — иначе текст получится натянутым.</p>}
            </>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="chunky c-peach wide" disabled={busy} onClick={() => void run(async () => onSave(await generate(level, topic, length, weave ? pickedLabels : [], setStage)))}>
        {!busy ? '✦ Создать текст' : stage === 'writing' ? 'Пишем текст…' : 'Редактор проверяет…'}
      </button>
      {busy && <p className="muted small">Обычно это занимает 15–50 секунд.</p>}
    </>
  );
}

function LinkTab({ onSave }: SaveProps) {
  const [url, setUrl] = useState('');
  const { busy, error, setError, run } = useTask();

  return (
    <>
      <label className="field">
        <span>Ссылка на статью</span>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError('');
          }}
          placeholder="https://www.dw.com/de/…"
          inputMode="url"
          autoCapitalize="off"
        />
      </label>
      <p className="muted small">Подойдут новости, блоги, Википедия.</p>
      {error && <p className="error">{error}</p>}
      <button
        className="chunky c-peach wide"
        disabled={busy}
        onClick={() => {
          if (!url.trim()) return setError('Вставь ссылку');
          void run(async () => onSave(await importFromUrl(url)));
        }}
      >
        {busy ? 'Загружаю…' : 'Загрузить текст'}
      </button>
    </>
  );
}

type Shelf = 'mini' | 'klexikon' | 'news' | 'tagesschau' | 'grimm';

// Ordered from easiest to hardest
const SHELVES: [Shelf, string][] = [
  ['mini', 'MiniKlexikon · A1–A2'],
  ['klexikon', 'Klexikon · A2–B1'],
  ['news', 'Wikinews (архив) · B1–B2'],
  ['tagesschau', 'Новости tagesschau · B2'],
  ['grimm', 'Сказки Гримм · B2+'],
];

const WIKI_SHELVES: Record<Exclude<Shelf, 'grimm' | 'tagesschau'>, { wiki: Wiki; hint: string; placeholder: string }> = {
  mini: { wiki: MINIKLEXIKON, hint: 'Самые простые статьи: очень короткие предложения, базовые слова.', placeholder: 'Katze, Sonne, Schule…' },
  klexikon: { wiki: KLEXIKON, hint: 'Детская энциклопедия на простом немецком: короткие предложения, понятные слова.', placeholder: 'Hund, Berlin, Fußball…' },
  news: {
    wiki: WIKINEWS,
    hint: 'Wikinews закрывается и тут только старые новости, но это настоящий газетный язык прошлых лет. Свежие новости — на полке tagesschau.',
    placeholder: 'Wahl, Fußball, Wetter…',
  },
};

function LibraryTab({ onSave }: SaveProps) {
  const [shelf, setShelf] = useState<Shelf>('mini');
  return (
    <>
      <div className="chips">
        {SHELVES.map(([id, label]) => (
          <button key={id} className={shelf === id ? 'chip on' : 'chip'} onClick={() => setShelf(id)}>
            {label}
          </button>
        ))}
      </div>
      {shelf === 'grimm' ? (
        <GrimmShelf onSave={onSave} />
      ) : shelf === 'tagesschau' ? (
        <TagesschauShelf onSave={onSave} />
      ) : (
        <WikiShelf key={shelf} {...WIKI_SHELVES[shelf]} onSave={onSave} />
      )}
    </>
  );
}

function WikiShelf({ wiki, hint, placeholder, onSave }: SaveProps & { wiki: Wiki; hint: string; placeholder: string }) {
  const [query, setQuery] = useState('');
  const [titles, setTitles] = useState<string[]>([]);
  const { busy, error, run } = useTask();

  const random = () => run(async () => setTitles(await wikiRandom(wiki)));
  useEffect(() => {
    void random();
  }, []);

  return (
    <>
      <p className="muted small">{hint}</p>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) void run(async () => setTitles(await wikiSearch(wiki, query.trim())));
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} />
        <button type="submit">Найти</button>
      </form>
      <button className="link" onClick={() => void random()}>
        Случайные статьи
      </button>
      {error && <p className="error">{error}</p>}
      {busy && <p className="muted">Загружаю…</p>}
      <ul className="list">
        {titles.map((t) => (
          <li key={t}>
            <button className="list-item" disabled={busy} onClick={() => void run(async () => onSave(await wikiArticle(wiki, t)))}>
              <span className="list-title">{t}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function TagesschauShelf({ onSave }: SaveProps) {
  const [ressort, setRessort] = useState('');
  const [items, setItems] = useState<NewsItem[]>([]);
  const { busy, error, run } = useTask();

  useEffect(() => {
    void run(async () => setItems(await tagesschauNews(ressort)));
  }, [ressort]);

  return (
    <>
      <p className="muted small">Свежие новости ARD, обновляются каждый час. Обычный газетный язык — сложнее Klexikon. Только для личного чтения.</p>
      <div className="chips tight">
        {RESSORTS.map(([id, label]) => (
          <button key={id || 'all'} className={ressort === id ? 'chip on' : 'chip'} onClick={() => setRessort(id)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {busy && <p className="muted">Загружаю…</p>}
      <ul className="list">
        {items.map((n) => (
          <li key={n.details}>
            <button className="list-item" disabled={busy} onClick={() => void run(async () => onSave(await tagesschauArticle(n)))}>
              {n.topline && <span className="muted small">{n.topline}</span>}
              <span className="list-title">{n.title}</span>
              <span className="muted small">{n.date}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function GrimmShelf({ onSave }: SaveProps) {
  const [tales, setTales] = useState<Tale[]>([]);
  const { error, run } = useTask();

  useEffect(() => {
    void run(async () => setTales(await grimmTales()));
  }, []);

  return (
    <>
      <p className="muted small">Оригинальные тексты 1911 года: живой язык сказок и старая орфография (daß вместо dass).</p>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {[...tales]
          .sort((a, b) => a.text.length - b.text.length)
          .map((t) => (
            <li key={t.title}>
              <button className="list-item" onClick={() => onSave({ title: t.title, content: t.text, source: 'Братья Гримм · общественное достояние' })}>
                <span className="list-title">{t.title}</span>
                <span className="muted small">≈ {readingMinutes(t.text)} мин</span>
              </button>
            </li>
          ))}
      </ul>
    </>
  );
}
