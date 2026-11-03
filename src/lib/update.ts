import { useSyncExternalStore } from 'react';

// The service worker normally updates the app on its own, but iOS can keep an old version cached for days.
// version.json is never cached, so comparing it with the running build tells a stuck app that it is outdated.
const CHECK_EVERY_MS = 30 * 60 * 1000;

let available = false;
const listeners = new Set<() => void>();

/** Fetches the deployed build stamp; resolves to true when it differs from the running one. */
export async function checkForUpdate(): Promise<boolean> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return false; // dev server, offline page
    const { build } = (await r.json()) as { build?: string };
    available = !!build && build !== __BUILD__;
  } catch {
    return false; // offline: keep the last answer
  }
  listeners.forEach((l) => l());
  return available;
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => available,
  );
}

/**
 * Drops this app's service worker and caches, then reloads from the network.
 * Only cache storage is cleared: words, progress and login live in IndexedDB/localStorage and stay.
 * Other apps on the same github.io origin keep their workers and caches.
 */
export async function hardReload() {
  const scope = new URL(import.meta.env.BASE_URL, location.origin).href;
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.filter((r) => r.scope.startsWith(scope)).map((r) => r.unregister()));
  } catch {
    // no service worker support: a plain reload is all we can do
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.includes(scope)).map((k) => caches.delete(k)));
  } catch {
    // cache storage unavailable
  }
  location.reload();
}

export function startUpdateChecks() {
  void checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}
