// Service worker: offline cache for the app, cached reader fonts and daily reminder notifications
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';
import { get } from 'idb-keyval';

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
  new CacheFirst({ cacheName: 'google-fonts', plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 3600 })] }),
);

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Pushes carry no payload: the text is built from the learner's own local data
async function reminderText() {
  try {
    const data = await get('data');
    const s = data?.stats;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (s?.streak && s.lastGoalDay === dayKey(yesterday)) {
      return { title: `🔥 Серия ${s.streak} дн. под угрозой`, body: '20 карточек — и день засчитан. Пара минут!' };
    }
  } catch {
    // fall through to the generic text
  }
  return { title: 'Время немецкого', body: 'Слова ждут в ленте — пара минут, и они не забудутся.' };
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    reminderText().then(({ title, body }) =>
      self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'daily-reminder' }),
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow(self.registration.scope))),
  );
});
