import { useEffect, useState } from 'react';
import { get, set } from 'idb-keyval';
import { Home } from './components/Home';
import { Library } from './components/Library';
import { AddText } from './components/AddText';
import { Reader } from './components/Reader';
import { Settings } from './components/Settings';
import { Setup } from './components/Setup';
import { Feed } from './components/Feed';
import { Dictionary } from './components/Dictionary';
import { ChestScreen } from './components/Rewards';
import type { Tab } from './components/TabBar';
import { useSync } from './lib/sync';
import { useApplyTheme } from './lib/theme';
import { useData, type GameId } from './lib/store';
import { KeyStep } from './components/KeyStep';
import { MascotStep } from './components/MascotStep';
import { MascotGallery } from './components/Mascot';
import { Game } from './components/Games';
import { hardReload, useUpdateAvailable } from './lib/update';
import { QuestChestScreen, RewardLayer } from './components/Quests';
import { Collection } from './components/Collection';
import { Chat, Lab } from './components/Chat';
import { LiveTest } from './components/LiveTest';

export type View =
  | { name: Tab }
  | { name: 'add' }
  | { name: 'reader'; id: string; from: Tab }
  | { name: 'feed'; from: Tab }
  | { name: 'key' }
  | { name: 'chest' }
  | { name: 'game'; game: GameId }
  | { name: 'questChest' }
  | { name: 'collection' }
  | { name: 'lab' }
  | { name: 'chat' }
  | { name: 'live' };

/** Top banner when a newer version is deployed than the one running (stuck service worker cache). */
function UpdateBanner() {
  const available = useUpdateAvailable();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!available || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <span>Вышла новая версия</span>
      <button
        className="chunky c-card"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void hardReload();
        }}
      >
        {busy ? 'Обновляю…' : 'Обновить'}
      </button>
      <button className="update-close" onClick={() => setHidden(true)} aria-label="Скрыть">
        ✕
      </button>
    </div>
  );
}

export function App() {
  return (
    <>
      <UpdateBanner />
      <Screens />
      <RewardLayer />
    </>
  );
}

function Screens() {
  const [view, setView] = useState<View>({ name: 'home' });
  const sync = useSync();
  const { geminiKey, mascot } = useData().settings;
  const hasKey = !!geminiKey;
  const [keySkipped, setKeySkipped] = useState(false);
  useApplyTheme();
  // Setup is shown until the device is connected or the user chose local-only mode
  const [setupDone, setSetupDone] = useState<boolean | null>(null);

  useEffect(() => {
    void get<boolean>('setupDone').then((v) => setSetupDone(!!v));
  }, []);

  // Each screen starts at the top
  useEffect(() => {
    if (view.name !== 'reader') window.scrollTo(0, 0);
  }, [view.name]);

  const finishSetup = () => {
    void set('setupDone', true);
    setSetupDone(true);
  };

  const onTab = (t: Tab) => setView({ name: t });
  const tab: Tab = view.name === 'home' || view.name === 'library' || view.name === 'words' || view.name === 'settings' ? view.name : 'home';
  const learn = () => setView({ name: 'feed', from: tab });
  const openText = (id: string) => setView({ name: 'reader', id, from: tab });

  if (location.search === '?mascots') return <MascotGallery />;
  if (setupDone === null) return null;
  if (!setupDone && sync.status === 'off') return <Setup onDone={finishSetup} />;
  if (!mascot && sync.status !== 'syncing' && view.name === 'home') return <MascotStep />;
  // Ask for the Gemini key right after setup (a synced device gets it from sync instead)
  if (!hasKey && !keySkipped && sync.status !== 'syncing' && sync.lastSync === 0 && view.name === 'home')
    return <KeyStep onDone={() => undefined} onSkip={() => setKeySkipped(true)} />;

  switch (view.name) {
    case 'add':
      return <AddText onBack={() => setView({ name: 'library' })} onSaved={(id) => setView({ name: 'reader', id, from: 'library' })} />;
    case 'reader':
      return <Reader id={view.id} onBack={() => setView({ name: view.from })} />;
    case 'feed':
      return <Feed onClose={() => setView({ name: view.from })} />;
    case 'key':
      return <KeyStep onDone={() => setView({ name: 'home' })} onSkip={() => setView({ name: 'home' })} />;
    case 'chest':
      return <ChestScreen onDone={() => setView({ name: 'home' })} />;
    case 'game':
      return <Game id={view.game} onClose={() => setView({ name: 'home' })} />;
    case 'questChest':
      return <QuestChestScreen onDone={() => setView({ name: 'home' })} />;
    case 'collection':
      return <Collection onBack={() => setView({ name: 'home' })} />;
    case 'lab':
      return <Lab onBack={() => setView({ name: 'home' })} onOpen={(id) => setView(id === 'live' ? { name: 'live' } : { name: 'chat' })} />;
    case 'chat':
      return <Chat onBack={() => setView({ name: 'lab' })} />;
    case 'live':
      return <LiveTest onBack={() => setView({ name: 'lab' })} />;
    case 'settings':
      return <Settings onTab={onTab} onLearn={learn} />;
    case 'words':
      return <Dictionary onTab={onTab} onLearn={learn} />;
    case 'library':
      return <Library onOpen={openText} onAdd={() => setView({ name: 'add' })} onLearn={learn} onTab={onTab} onAddKey={() => setView({ name: 'key' })} />;
    default:
      return <Home onTab={onTab} onLearn={learn} onOpenText={openText} onChest={() => setView({ name: 'chest' })} onAddKey={() => setView({ name: 'key' })} onGame={(game) => setView({ name: 'game', game })} onQuestChest={() => setView({ name: 'questChest' })} onCollection={() => setView({ name: 'collection' })} onLab={() => setView({ name: 'lab' })} />;
  }
}
