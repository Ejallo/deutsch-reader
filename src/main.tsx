import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { loadStore } from './lib/store';
import { loadCache } from './lib/gemini';
import { set } from 'idb-keyval';
import { initSync, takeLoginFromUrl } from './lib/sync';
import { startGoalReporting } from './lib/push';
import { installAudioUnlock } from './lib/sfx';
import { startUpdateChecks } from './lib/update';
import { startQuests } from './lib/quests';
import './styles.css';

// iOS only re-checks the service worker on a cold start, so ask for updates
// whenever the app comes to the foreground; autoUpdate then reloads into the new version
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => void reg.update().catch(() => undefined);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 30 * 60 * 1000);
  },
});

async function start() {
  await Promise.all([loadStore(), loadCache()]);
  // Back from Google sign-in: the server put a session into the URL fragment
  const login = await takeLoginFromUrl();
  if (login === 'ok') await set('setupDone', true);
  if (login === 'error') sessionStorage.setItem('loginError', '1');
  // Ask iOS not to evict local data; sync is the backup if it does anyway
  void navigator.storage?.persist?.();
  installAudioUnlock();
  startUpdateChecks();
  startQuests();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void initSync();
  startGoalReporting();
}

void start();
