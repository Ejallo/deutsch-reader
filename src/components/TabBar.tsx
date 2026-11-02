import { todayProgress, updateSettings, useData } from '../lib/store';

export type Tab = 'library' | 'words';

interface Props {
  active: Tab;
  onTab: (t: Tab) => void;
  onLearn: () => void;
}

/** Bottom bar on the main screens; the badge counts cards waiting today. */
export function TabBar({ active, onTab, onLearn }: Props) {
  const data = useData();
  const now = Date.now();
  const learning = Object.values(data.words).filter((w) => !w.deleted && w.status === 'learning');
  const due = learning.filter((w) => w.card && w.card.due <= now).length;
  const newLeft = Math.max(0, data.settings.newPerDay - todayProgress(data).newIntroduced);
  const fresh = Math.min(newLeft, learning.filter((w) => !w.card).length);
  const waiting = due + fresh;

  return (
    <nav className="tabbar">
      <button className={`tab nav ${active === 'library' ? 'active' : ''}`} onClick={() => onTab('library')}>
        Тексты
      </button>
      <button className={`tab nav ${active === 'words' ? 'active' : ''}`} onClick={() => onTab('words')}>
        Словарь
      </button>
      <button
        className={`tab listen-toggle ${data.settings.listening ? 'on' : ''}`}
        onClick={() => updateSettings({ listening: !data.settings.listening })}
        aria-label={data.settings.listening ? 'Аудирование включено' : 'Аудирование выключено'}
        title="Аудирование"
      >
        {data.settings.listening ? '🎧' : '🔇'}
      </button>
      <button className="tab learn" onClick={onLearn}>
        Учить
        {waiting > 0 && <span className="badge">{waiting}</span>}
      </button>
    </nav>
  );
}
