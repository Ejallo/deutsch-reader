import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { loadStore } from './lib/store';
import { loadCache } from './lib/gemini';
import { initSync } from './lib/sync';
import './styles.css';

registerSW({ immediate: true });

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
}

void start();
