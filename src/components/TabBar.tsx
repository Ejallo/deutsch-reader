import { learningCards, todayProgress, useData, type AppData, type LearnMode } from '../lib/store';

export type Tab = 'home' | 'library' | 'words' | 'settings';

interface Props {
  active: Tab;
  onTab: (t: Tab) => void;
  onLearn: () => void;
}

/** Cards waiting today: reviews due now plus new words and chunks still allowed today. */
export function waitingCards(d: AppData, mode?: LearnMode): number {
  const now = Date.now();
  const learning = learningCards(d, mode);
  const due = learning.filter((w) => w.card && w.card.due <= now).length;
  const newLeft = Math.max(0, d.settings.newPerDay - todayProgress(d).newIntroduced);
  return due + Math.min(newLeft, learning.filter((w) => !w.card).length);
}

const TABS: [Tab, string, string][] = [
  ['home', 'Главная', '◉'],
  ['library', 'Тексты', '▤'],
  ['words', 'Словарь', '◈'],
  ['settings', 'Настройки', '⚙︎'],
];

export function TabBar({ active, onTab, onLearn }: Props) {
  const waiting = waitingCards(useData());
  const tab = ([id, label, ic]: [Tab, string, string]) => (
    <button key={id} className={`tab ${active === id ? 'active' : ''}`} onClick={() => onTab(id)}>
      <span className="ic" aria-hidden="true">
        {ic}
      </span>
      {label}
    </button>
  );

  return (
    <nav className="tabbar">
      {TABS.slice(0, 2).map(tab)}
      <button className="tab-learn" onClick={onLearn}>
        {waiting > 0 ? 'Учить' : '✓'}
        {waiting > 0 && <span className="badge">{waiting}</span>}
      </button>
      {TABS.slice(2).map(tab)}
    </nav>
  );
}
