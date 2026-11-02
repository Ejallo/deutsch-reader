import { todayProgress, updateSettings, useData } from '../lib/store';

interface Props {
  onLearn: () => void;
}

/** Bottom bar on the library screen; the badge counts cards waiting today. */
export function TabBar({ onLearn }: Props) {
  const data = useData();
  const now = Date.now();
  const learning = Object.values(data.words).filter((w) => !w.deleted && w.status === 'learning');
  const due = learning.filter((w) => w.card && w.card.due <= now).length;
  const newLeft = Math.max(0, data.settings.newPerDay - todayProgress(data).newIntroduced);
  const fresh = Math.min(newLeft, learning.filter((w) => !w.card).length);
  const waiting = due + fresh;

  return (
    <nav className="tabbar">
      <span className="tab active">Тексты</span>
      <button
        className={`tab listen-toggle ${data.settings.listening ? 'on' : ''}`}
        onClick={() => updateSettings({ listening: !data.settings.listening })}
        aria-label={data.settings.listening ? 'Аудирование включено' : 'Аудирование выключено'}
        title="Аудирование"
      >
        {data.settings.listening ? '🎧' : '🔇'}
      </button>
      <button className="tab learn" onClick={onLearn}>
        Учить слова
        {waiting > 0 && <span className="badge">{waiting}</span>}
      </button>
    </nav>
  );
}
