import { useEffect, useState } from 'react';
import { addText } from '../lib/store';
import {
  generate,
  grimmTales,
  importFromUrl,
  klexikonArticle,
  klexikonRandom,
  klexikonSearch,
  LEVELS,
  readingMinutes,
  wordsToWeave,
  type FoundText,
  type GenStage,
  type Length,
  type Level,
  type Tale,
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
      <header className="bar">
        <button className="link" onClick={onBack}>
          ‹ Назад
        </button>
        <h1>Новый текст</h1>
        <span />
      </header>
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
      <button className="primary wide" onClick={save}>
        Сохранить и читать
      </button>
    </>
  );
}

const TOPICS = ['Кафе', 'Путешествие', 'Работа', 'Спорт', 'Покупки', 'Квартира', 'Здоровье', 'Детектив'];

function GenerateTab({ onSave }: SaveProps) {
  const [level, setLevel] = useState<Level>('A2');
  const [topic, setTopic] = useState('');
  const [length, setLength] = useState<Length>('medium');
  const [weave, setWeave] = useState(true);
  const { busy, error, run } = useTask();
  const [stage, setStage] = useState<GenStage>('writing');
  const myWords = wordsToWeave();

  return (
    <>
      <div className="field">
        <span>Уровень</span>
        <div className="chips">
          {LEVELS.map((l) => (
            <button key={l} className={level === l ? 'chip on' : 'chip'} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Тема</span>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="о чём угодно: футбол, Берлин, кофе" />
      </label>
      <div className="chips">
        {TOPICS.map((t) => (
          <button key={t} className={topic === t ? 'chip on' : 'chip'} onClick={() => setTopic(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="field">
        <span>Длина</span>
        <div className="chips">
          {(
            [
              ['short', 'Короткий'],
              ['medium', 'Средний'],
              ['long', 'Длинный'],
            ] as [Length, string][]
          ).map(([id, label]) => (
            <button key={id} className={length === id ? 'chip on' : 'chip'} onClick={() => setLength(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {myWords.length > 0 && (
        <label className="toggle">
          <input type="checkbox" checked={weave} onChange={(e) => setWeave(e.target.checked)} />
          <span>Вплести мои слова ({myWords.length}): {myWords.slice(0, 4).join(', ')}{myWords.length > 4 ? '…' : ''}</span>
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary wide" disabled={busy} onClick={() => void run(async () => onSave(await generate(level, topic, length, weave, setStage)))}>
        {!busy ? 'Создать текст' : stage === 'writing' ? 'Автор пишет текст…' : 'Критик проверяет…'}
      </button>
      <p className="muted small">Один ИИ пишет текст, второй — строгий редактор — проверяет грамматику, естественность и уровень и исправляет ошибки.</p>
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
      <p className="muted small">Подойдут новости, блоги, Википедия. Страница читается через сервис Jina Reader — ссылка уходит ему.</p>
      {error && <p className="error">{error}</p>}
      <button
        className="primary wide"
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

function LibraryTab({ onSave }: SaveProps) {
  const [shelf, setShelf] = useState<'klexikon' | 'grimm'>('klexikon');
  return (
    <>
      <div className="chips">
        <button className={shelf === 'klexikon' ? 'chip on' : 'chip'} onClick={() => setShelf('klexikon')}>
          Klexikon · A2–B1
        </button>
        <button className={shelf === 'grimm' ? 'chip on' : 'chip'} onClick={() => setShelf('grimm')}>
          Сказки Гримм · B2+
        </button>
      </div>
      {shelf === 'klexikon' ? <KlexikonShelf onSave={onSave} /> : <GrimmShelf onSave={onSave} />}
    </>
  );
}

function KlexikonShelf({ onSave }: SaveProps) {
  const [query, setQuery] = useState('');
  const [titles, setTitles] = useState<string[]>([]);
  const { busy, error, run } = useTask();

  const random = () => run(async () => setTitles(await klexikonRandom()));
  useEffect(() => {
    void random();
  }, []);

  return (
    <>
      <p className="muted small">Детская энциклопедия на простом немецком: короткие предложения, понятные слова.</p>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) void run(async () => setTitles(await klexikonSearch(query.trim())));
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hund, Berlin, Fußball…" />
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
            <button className="list-item" disabled={busy} onClick={() => void run(async () => onSave(await klexikonArticle(t)))}>
              <span className="list-title">{t}</span>
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
