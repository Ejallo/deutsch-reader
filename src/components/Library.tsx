import { useMemo, useState } from 'react';
import { liveTexts, statusOf, useData } from '../lib/store';
import { uniqueForms } from '../lib/text';
import { levelAccent, PBar, readProgress, StatStrip, textLevel, TopBar } from './ui';
import { TabBar, type Tab } from './TabBar';

interface Props {
  onOpen: (id: string) => void;
  onAdd: () => void;
  onLearn: () => void;
  onTab: (t: Tab) => void;
  onAddKey: () => void;
}

type Filter = 'all' | 'reading' | 'done';

const DONE_AT = 0.95;

function ago(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/** Short origin label for a text card. */
function origin(source?: string): string {
  if (!source) return 'Вставлено';
  if (source.startsWith('Сгенерировано')) return 'Сгенерировано';
  if (source.startsWith('Klexikon')) return 'Klexikon';
  if (source.includes('Гримм')) return 'Сказки Гримм';
  return `Ссылка · ${source}`;
}

export function Library({ onOpen, onAdd, onLearn, onTab, onAddKey }: Props) {
  const data = useData();
  const texts = liveTexts(data);
  const [filter, setFilter] = useState<Filter>('all');

  const info = useMemo(() => {
    const out: Record<string, { fresh: number; progress: number }> = {};
    for (const t of texts) {
      out[t.id] = { fresh: uniqueForms(t.content).filter((f) => statusOf(data, f) === 'new').length, progress: readProgress(t.id) };
    }
    return out;
  }, [data, texts]);

  const shown = texts.filter((t) => {
    const p = info[t.id].progress;
    return filter === 'all' || (filter === 'done' ? p >= DONE_AT : p < DONE_AT && p > 0.02);
  });

  return (
    <div className="screen">
      <TopBar title="Тексты" right={<StatStrip />} />

      {!data.settings.geminiKey && (
        <button className="key-banner" onClick={onAddKey}>
          <b>Добавь ключ Gemini</b>
          <span>Без него не работают перевод и создание текстов. Это бесплатно — займёт минуту.</span>
        </button>
      )}

      {texts.length === 0 ? (
        <div className="empty">
          <p>Вставь, создай или найди первый немецкий текст.</p>
          <button className="chunky c-peach" onClick={onAdd}>
            + Новый текст
          </button>
        </div>
      ) : (
        <>
          <div className="chips">
            {(
              [
                ['all', `Все ${texts.length}`],
                ['reading', 'Читаю'],
                ['done', 'Прочитано'],
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button key={id} className={filter === id ? 'chip on' : 'chip'} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <ul className="list">
            {shown.map((t) => {
              const { fresh, progress } = info[t.id];
              const done = progress >= DONE_AT;
              const lvl = textLevel(t);
              const accent = done ? 'butter' : levelAccent(lvl);
              return (
                <li key={t.id}>
                  <button className="text-card" onClick={() => onOpen(t.id)}>
                    <div className={`lvl c-${accent}`}>
                      {lvl}
                      {done && <span style={{ fontSize: 16, marginTop: 2 }}>✓</span>}
                    </div>
                    <div className="body">
                      <div className="t">{t.title}</div>
                      <div className="meta">
                        {origin(t.source)} · {ago(t.createdAt)}
                      </div>
                      <div className="prog">
                        <PBar value={progress} accent={accent} h={8} />
                        <span>{Math.round(progress * 100)}%</span>
                      </div>
                      {fresh > 0 && <div className="new">{fresh} новых слов</div>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && <p className="muted">Здесь пока пусто.</p>}
        </>
      )}

      <button className="fab" onClick={onAdd} aria-label="Добавить текст">
        +
      </button>
      <TabBar active="library" onTab={onTab} onLearn={onLearn} />
    </div>
  );
}
