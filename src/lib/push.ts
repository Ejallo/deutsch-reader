import { getData, subscribeData } from './store';

// Reminder server (Cloudflare Worker in push-worker/)
export const PUSH_URL = 'https://deutsch-reader-push.vetervlad94.workers.dev';
const VAPID_PUBLIC = 'BOfLPCjXylsvmyx0FXbtuajbnS1XobXkBbWL0r0ln5JTJqfGEjiUED3TWilSzxJ3QK9QB-GKJGjlDVJKtWqlh7E';

export interface ReminderPrefs {
  enabled: boolean;
  hour: number;
}

const PREFS_KEY = 'reminder';
const ID_KEY = 'deviceId';

// Reminders are per device: each phone or computer subscribes on its own
export function reminderPrefs(): ReminderPrefs {
  try {
    return { enabled: false, hour: 20, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { enabled: false, hour: 20 };
  }
}

function savePrefs(p: ReminderPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // without storage the toggle just won't be remembered
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!PUSH_URL;

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function post(path: string, body: object) {
  const r = await fetch(`${PUSH_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deviceId(), ...body }) });
  if (!r.ok) throw new Error(`Сервер напоминаний ответил ошибкой ${r.status}`);
  return r.json();
}

const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Rejects with a named step if it takes too long, so a stuck step is visible instead of a silent hang. */
function step<T>(name: string, p: Promise<T>, ms = 15000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Шаг «${name}» не ответил за ${ms / 1000} с`)), ms))]);
}

/** One line of facts that explains most push problems on iPhone. */
export function pushDiagnostics(): string {
  const ios = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  return [
    ios ? `iOS ${ios[1]}.${ios[2]}` : navigator.platform,
    isStandalone() ? 'с экрана «Домой»' : 'в браузере',
    'Notification' in window ? `разрешение: ${Notification.permission}` : 'нет Notification',
    'PushManager' in window ? 'push есть' : 'push нет',
    navigator.serviceWorker?.controller ? 'SW активен' : 'SW не активен',
  ].join(' · ');
}

export async function enableReminders(hour: number, onStep: (s: string) => void = () => undefined): Promise<void> {
  onStep('Запрашиваю разрешение…');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(`Уведомления не разрешены (${permission}). Разреши их: Настройки iPhone → Уведомления → Deutsch.`);
  onStep('Жду сервис-воркер…');
  const reg = await step('сервис-воркер', navigator.serviceWorker.ready);
  onStep('Подписываюсь на уведомления…');
  const sub = await step(
    'подписка',
    (async () => (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) })))(),
  );
  onStep('Отправляю на сервер…');
  await post('/subscribe', {
    subscription: sub.toJSON(),
    hour,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lastGoalDay: getData().stats.lastGoalDay,
  });
  savePrefs({ enabled: true, hour });
}

export async function disableReminders(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  await post('/unsubscribe', {}).catch(() => undefined);
  savePrefs({ ...reminderPrefs(), enabled: false });
}

/** Asks the server to push now; returns the push service's HTTP status (201 = accepted). */
export const sendTestReminder = async (): Promise<number> => (await post('/test', {})).status;

/** Tells the server when today's goal is met (here or on another device) so it skips the reminder. */
export function startGoalReporting() {
  let last = getData().stats.lastGoalDay;
  subscribeData(() => {
    const day = getData().stats.lastGoalDay;
    if (day === last) return;
    last = day;
    if (pushSupported() && reminderPrefs().enabled) void post('/state', { lastGoalDay: day }).catch(() => undefined);
  });
}
