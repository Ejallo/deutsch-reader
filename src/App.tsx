import { useEffect, useState } from 'react';
import { get, set } from 'idb-keyval';
import { Library } from './components/Library';
import { AddText } from './components/AddText';
import { Reader } from './components/Reader';
import { Settings } from './components/Settings';
import { Setup } from './components/Setup';
import { Feed } from './components/Feed';
import { Dictionary } from './components/Dictionary';
import type { Tab } from './components/TabBar';
import { useSync } from './lib/sync';
import { useApplyTheme } from './lib/theme';
import { useData } from './lib/store';
import { KeyStep } from './components/KeyStep';

export type View = { name: 'library' } | { name: 'add' } | { name: 'reader'; id: string } | { name: 'settings' } | { name: 'feed' } | { name: 'words' } | { name: 'key' };

export function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const sync = useSync();
  const hasKey = !!useData().settings.geminiKey;
  const [keySkipped, setKeySkipped] = useState(false);
  useApplyTheme();
  // Setup is shown until the device is connected or the user chose local-only mode
  const [setupDone, setSetupDone] = useState<boolean | null>(null);

  useEffect(() => {
    void get<boolean>('setupDone').then((v) => setSetupDone(!!v));
  }, []);

  const finishSetup = () => {
    void set('setupDone', true);
    setSetupDone(true);
  };

  const onTab = (t: Tab) => setView(t === 'words' ? { name: 'words' } : { name: 'library' });

  if (setupDone === null) return null;
  if (!setupDone && sync.status === 'off') return <Setup onDone={finishSetup} />;
  // Ask for the Gemini key right after setup (a synced device gets it from sync instead)
  if (!hasKey && !keySkipped && sync.status !== 'syncing' && sync.lastSync === 0 && view.name === 'library')
    return <KeyStep onDone={() => undefined} onSkip={() => setKeySkipped(true)} />;

  switch (view.name) {
    case 'add':
      return <AddText onBack={() => setView({ name: 'library' })} onSaved={(id) => setView({ name: 'reader', id })} />;
    case 'reader':
      return <Reader id={view.id} onBack={() => setView({ name: 'library' })} />;
    case 'settings':
      return <Settings onBack={() => setView({ name: 'library' })} />;
    case 'feed':
      return <Feed onClose={() => setView({ name: 'library' })} />;
    case 'key':
      return <KeyStep onDone={() => setView({ name: 'library' })} onSkip={() => setView({ name: 'library' })} />;
    case 'words':
      return <Dictionary onTab={onTab} onLearn={() => setView({ name: 'feed' })} onSettings={() => setView({ name: 'settings' })} />;
    default:
      return (
        <Library
          onOpen={(id) => setView({ name: 'reader', id })}
          onAdd={() => setView({ name: 'add' })}
          onSettings={() => setView({ name: 'settings' })}
          onLearn={() => setView({ name: 'feed' })}
          onTab={onTab}
          onAddKey={() => setView({ name: 'key' })}
        />
      );
  }
}
