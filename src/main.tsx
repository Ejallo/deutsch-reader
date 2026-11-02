import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { loadStore } from './lib/store';
import { loadCache } from './lib/gemini';
import { initSync } from './lib/sync';
import { startGoalReporting } from './lib/push';
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
  // Ask iOS not to evict local data; sync is the backup if it does anyway
  void navigator.storage?.persist?.();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void initSync();
  startGoalReporting();
}

void start();
