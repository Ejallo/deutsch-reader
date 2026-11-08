import { useEffect, useRef, useState } from 'react';
import { addText, useData } from '../lib/store';
import { scanText, translateTitles } from '../lib/gemini';
import { TopBar, type Accent } from './ui';
import { TOPICS as GRAMMAR_TOPICS, topicById } from '../lib/grammar';
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
  tagesschauSearch,
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

type Tab = 'paste' | 'scan' | 'generate' | 'link' | 'library';

const TABS: [Tab, string][] = [
  ['paste', 'Вставить'],
  ['scan', 'Фото'],
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
      {tab === 'scan' && <ScanTab onSave={save} />}
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

const MAX_PAGES = 6;
const MAX_SIDE = 2048; // enough for small print, keeps the request light

interface Page {
  url: string; // preview (object URL of the downscaled image)
  data: string; // base64 JPEG for Gemini
}

/** Downscales a photo on the device (EXIF rotation applied by the browser) and returns it as JPEG. */
async function preparePhoto(file: File): Promise<Page> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => {
      throw new Error('Не получилось открыть фото — попробуй другое');
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((ok, fail) =>
      canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Не получилось обработать фото'))), 'image/jpeg', 0.85),
    );
    const data = await new Promise<string>((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1]);
      fr.readAsDataURL(blob);
    });
    return { url: URL.createObjectURL(blob), data };
  } finally {
    URL.revokeObjectURL(src);
  }
}

function ScanTab({ onSave }: SaveProps) {
  const [pages, setPages] = useState<Page[]>([]);
  const [result, setResult] = useState<{ title: string; text: string } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const hasKey = !!useData().settings.geminiKey;
  const { busy, error, setError, run } = useTask();

  const addFiles = (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])].slice(0, MAX_PAGES - pages.length);
    input.value = ''; // the same photo can be picked again
    if (!list.length) return;
    void run(async () => {
      const ready: Page[] = [];
      for (const f of list) ready.push(await preparePhoto(f));
      setPages((cur) => [...cur, ...ready].slice(0, MAX_PAGES));
    });
  };

  const recognize = () =>
    run(async () => {
      const r = await scanText(pages.map((p) => ({ mimeType: 'image/jpeg', data: p.data })));
      if (!r.ok || !r.text.trim()) throw new Error('Не нашёл на фото немецкого текста. Сними поближе и ровнее, при хорошем свете.');
      setResult({ title: r.title.trim(), text: r.text.trim() });
    });

  if (result)
    return (
      <>
        <p className="muted small">Сверь текст с фото и поправь, если что-то распозналось неверно. Нечитаемые места отмечены [?].</p>
        <div className="scan-pages">
          {pages.map((p, i) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
              <img src={p.url} alt={`Страница ${i + 1}`} />
            </a>
          ))}
        </div>
        <label className="field">
          <span>Название</span>
          <input value={result.title} onChange={(e) => setResult({ ...result, title: e.target.value })} />
        </label>
        <label className="field">
          <span>Распознанный текст</span>
          <textarea value={result.text} onChange={(e) => setResult({ ...result, text: e.target.value })} rows={14} />
        </label>
        {error && <p className="error">{error}</p>}
        <button
          className="chunky c-peach wide"
          onClick={() => {
            const text = result.text.trim();
            if (!text) return setError('Текст пустой');
            onSave({ title: result.title || text.split(/\s+/).slice(0, 5).join(' ') + '…', content: text, source: 'Скан с фото' });
          }}
        >
          Сохранить и читать
        </button>
        <button className="link" onClick={() => setResult(null)}>
          ← Назад к фото
        </button>
      </>
    );

  return (
    <>
      <p className="muted small">
        Сфотографируй страницу книги, учебника или журнала — текст распознается и станет обычным текстом: перевод по тапу, слова в словарь. До {MAX_PAGES} страниц подряд.
      </p>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addFiles(e.target)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target)} />
      {pages.length > 0 && (
        <div className="scan-pages">
          {pages.map((p, i) => (
            <div key={p.url} className="scan-page">
              <img src={p.url} alt={`Страница ${i + 1}`} />
              <span className="scan-num">{i + 1}</span>
              <button
                className="scan-del"
                aria-label="Убрать фото"
                disabled={busy}
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  setPages((cur) => cur.filter((x) => x !== p));
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {pages.length < MAX_PAGES && (
        <div className="row scan-buttons">
          <button className="chunky c-sky" disabled={busy} onClick={() => cameraRef.current?.click()}>
            📷 {pages.length ? 'Ещё фото' : 'Камера'}
          </button>
          <button className="chunky c-lav" disabled={busy} onClick={() => galleryRef.current?.click()}>
            🖼 Галерея
          </button>
        </div>
      )}
      <p className="muted small">Совет: страница целиком в кадре, ровно, без бликов и тени от телефона.</p>
      {!hasKey && <p className="error">Для распознавания нужен ключ Gemini в настройках.</p>}
      {error && <p className="error">{error}</p>}
      {pages.length > 0 && (
        <button className="chunky c-peach wide" disabled={busy || !hasKey} onClick={() => void recognize()}>
          {busy ? 'Распознаю текст…' : `Распознать ${pages.length > 1 ? `${pages.length} стр.` : 'текст'}`}
        </button>
      )}
      {busy && pages.length > 0 && <p className="muted small">Обычно 10–40 секунд.</p>}
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
  const [grammar, setGrammar] = useState('');

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
      <div className="overline section-label">Грамматика в тексте</div>
      <div className="chips">
        {GRAMMAR_TOPICS.map((t) => (
          <button key={t.id} className={`chip ${grammar === t.id ? 'on' : ''}`} onClick={() => setGrammar((g) => (g === t.id ? '' : t.id))}>
            {t.emoji} {t.title}
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
      <button className="chunky c-peach wide" disabled={busy} onClick={() => void run(async () => onSave(await generate(level, topic, length, weave ? pickedLabels : [], setStage, topicById(grammar))))}>
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
  const [ressort, setRessort] = useState<string | null>(''); // null while showing search results
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [ru, setRu] = useState<Record<string, string>>({});
  const hasKey = !!useData().settings.geminiKey;
  const { busy, error, run } = useTask();

  useEffect(() => {
    if (ressort !== null) void run(async () => setItems(await tagesschauNews(ressort)));
  }, [ressort]);

  // Russian headlines help pick a story; fetched in the background, the list works without them
  useEffect(() => {
    if (!hasKey || !items.length) return;
    let live = true;
    translateTitles(items.map((n) => n.title))
      .then((map) => live && setRu((cur) => ({ ...cur, ...map })))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [items, hasKey]);

  const search = () => {
    const q = query.trim();
    if (!q) return;
    setRessort(null);
    void run(async () => {
      const found = await tagesschauSearch(q);
      setItems(found);
      if (!found.length) throw new Error(`По запросу «${q}» статей не нашлось`);
    });
  };

  return (
    <>
      <p className="muted small">Свежие новости ARD, обновляются каждый час. Обычный газетный язык — сложнее Klexikon. Только для личного чтения.</p>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Fußball, Wetter, Bahn…" />
        <button type="submit">Найти</button>
      </form>
      <div className="chips tight">
        {RESSORTS.map(([id, label]) => (
          <button
            key={id || 'all'}
            className={ressort === id ? 'chip on' : 'chip'}
            onClick={() => {
              setQuery('');
              setRessort(id);
            }}
          >
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
              {ru[n.title] && <span className="small muted">({ru[n.title]})</span>}
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
