import { useMemo } from 'react';
import { liveTexts, statusOf, useData } from '../lib/store';
import { uniqueForms } from '../lib/text';
import { SyncBadge } from './SyncBadge';
import { TabBar } from './TabBar';

interface Props {
  onOpen: (id: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  onLearn: () => void;
}

export function Library({ onOpen, onAdd, onSettings, onLearn }: Props) {
  const data = useData();
  const texts = liveTexts(data);

  const known = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of texts) {
      const forms = uniqueForms(t.content);
      out[t.id] = forms.length ? Math.round((forms.filter((f) => statusOf(data, f) === 'known').length / forms.length) * 100) : 0;
    }
    return out;
  }, [data, texts]);

  const learning = Object.values(data.words).filter((w) => !w.deleted && w.status === 'learning').length;

  return (
    <div className="screen">
      <header className="bar">
        <h1>Тексты</h1>
        <div className="bar-actions">
          <SyncBadge />
          <button className="icon-btn" onClick={onSettings} aria-label="Настройки">
            ⚙︎
          </button>
        </div>
      </header>

      <p className="muted small">Учишь слов: {learning}</p>

      {texts.length === 0 ? (
        <div className="empty">
          <p>Вставь первый немецкий текст: статью, пост, главу книги.</p>
          <button className="primary" onClick={onAdd}>
            Добавить текст
          </button>
        </div>
      ) : (
        <ul className="list">
          {texts.map((t) => (
            <li key={t.id}>
              <button className="list-item" onClick={() => onOpen(t.id)}>
                <span className="list-title">{t.title}</span>
                <span className="muted small">
                  Знаешь {known[t.id]}% слов · {new Date(t.createdAt).toLocaleDateString('ru-RU')}
                </span>
                <span className="progress">
                  <i style={{ width: `${known[t.id]}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {texts.length > 0 && (
        <button className="fab" onClick={onAdd} aria-label="Добавить текст">
          +
        </button>
      )}
      <TabBar onLearn={onLearn} />
    </div>
  );
}
