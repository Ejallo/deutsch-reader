import { useMemo } from 'react';
import { currentStreak, liveTexts, statusOf, useData } from '../lib/store';
import { levelOf } from '../lib/gamify';
import { effectiveTheme, toggleTheme } from '../lib/theme';
import { uniqueForms } from '../lib/text';
import { SyncBadge } from './SyncBadge';
import { TabBar, type Tab } from './TabBar';

interface Props {
  onOpen: (id: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  onLearn: () => void;
  onTab: (t: Tab) => void;
  onAddKey: () => void;
}

export function Library({ onOpen, onAdd, onSettings, onLearn, onTab, onAddKey }: Props) {
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
  const streak = currentStreak(data);
  const lvl = levelOf(data.stats.xp);

  return (
    <div className="screen">
      <header className="bar">
        <h1>Тексты</h1>
        <div className="bar-actions">
          <SyncBadge />
          <button className="icon-btn" onClick={() => toggleTheme(data.settings.theme)} aria-label="Сменить тему">
            {effectiveTheme(data.settings.theme) === 'dark' ? '☀︎' : '☾'}
          </button>
          <button className="icon-btn" onClick={onSettings} aria-label="Настройки">
            ⚙︎
          </button>
        </div>
      </header>

      {!data.settings.geminiKey && (
        <button className="key-banner" onClick={onAddKey}>
          <b>Добавь ключ Gemini</b>
          <span>Без него не работают перевод и создание текстов. Это бесплатно — займёт минуту.</span>
        </button>
      )}

      <div className="stats-row">
        <span title="Серия дней">🔥 {streak}</span>
        <span>Ур. {lvl.level}</span>
        <span className="level-bar" title={`${lvl.into}/${lvl.need} XP`}>
          <i style={{ width: `${(lvl.into / lvl.need) * 100}%` }} />
        </span>
        <span className="muted small">Учишь: {learning}</span>
      </div>

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
      <TabBar active="library" onTab={onTab} onLearn={onLearn} />
    </div>
  );
}
