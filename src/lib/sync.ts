import { del, get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { applyRemote, getData, mergeData, onLocalChange, type AppData } from './store';

// Device-local connection. Never synced and never part of the public code.
// Either your own private GitHub repo, or a friend's account on the app server (Google sign-in).
export interface GithubConnection {
  kind?: 'github'; // older saved connections have no kind
  token: string;
  owner: string;
  repo: string;
}

export interface CloudConnection {
  kind: 'cloud';
  session: string;
  name: string;
  email: string;
}

export type Connection = GithubConnection | CloudConnection;

export const ACCOUNT_API = 'https://deutsch-reader-push.vetervlad94.workers.dev';

export type SyncState = { status: 'off' | 'idle' | 'syncing' | 'error'; lastSync: number; error: string };

const API = 'https://api.github.com';
const FILE = 'data.json';
const PUSH_DELAY = 2500;

let conn: Connection | null = null;
let state: SyncState = { status: 'off', lastSync: 0, error: '' };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSync() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const getConnection = () => conn;

class GhError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function gh(c: GithubConnection, path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return r;
}

function ghMessage(status: number): string {
  if (status === 401) return 'Токен GitHub недействителен или истёк';
  if (status === 403) return 'У токена нет доступа к репозиторию (нужны права Contents: Read and write)';
  if (status === 404) return 'Репозиторий не найден или токен не видит его';
  return `GitHub ответил ошибкой ${status}`;
}

const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

// Key-order-independent JSON, so equal data compares equal
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

async function cloud(c: CloudConnection, method: string, body?: object) {
  const r = await fetch(`${ACCOUNT_API}/data`, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${c.session}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw new GhError(401, 'Вход истёк — выйди и войди через Google снова');
  return r;
}

async function fetchRemote(c: Connection): Promise<{ data: AppData | null; sha: string | null }> {
  if (c.kind === 'cloud') {
    const r = await cloud(c, 'GET');
    if (!r.ok) throw new GhError(r.status, `Сервер ответил ошибкой ${r.status}`);
    const j = await r.json();
    return { data: j.data, sha: String(j.version) };
  }
  const r = await gh(c, `/repos/${c.owner}/${c.repo}/contents/${FILE}`);
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new GhError(r.status, ghMessage(r.status));
  const j = await r.json();
  let b64: string = j.content;
  // Files over 1 MB come without inline content; read them as a blob
  if (!b64 || j.encoding === 'none') {
    const b = await gh(c, `/repos/${c.owner}/${c.repo}/git/blobs/${j.sha}`);
    if (!b.ok) throw new GhError(b.status, ghMessage(b.status));
    b64 = (await b.json()).content;
  }
  return { data: JSON.parse(fromB64(b64)), sha: j.sha };
}

async function putRemote(c: Connection, data: AppData, sha: string | null) {
  if (c.kind === 'cloud') {
    const r = await cloud(c, 'PUT', { data, version: Number(sha ?? 0) });
    if (r.status === 409) return false; // another device saved in between
    if (r.status === 413) throw new GhError(413, 'Слишком много данных для сервера — удали старые длинные тексты');
    if (!r.ok) throw new GhError(r.status, `Сервер ответил ошибкой ${r.status}`);
    return true;
  }
  const r = await gh(c, `/repos/${c.owner}/${c.repo}/contents/${FILE}`, {
    method: 'PUT',
    body: JSON.stringify({ message: 'sync', content: toB64(JSON.stringify(data)), ...(sha ? { sha } : {}) }),
  });
  if (r.status === 409 || r.status === 422) return false; // someone pushed in between
  if (!r.ok) throw new GhError(r.status, ghMessage(r.status));
  return true;
}

export async function syncNow(): Promise<void> {
  const c = conn;
  if (!c) return;
  if (running) {
    again = true;
    return;
  }
  if (!navigator.onLine) {
    setState({ status: 'error', error: 'Нет интернета — синхронизирую, когда появится' });
    return;
  }
  running = true;
  setState({ status: 'syncing', error: '' });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await fetchRemote(c);
      if (remote.data) applyRemote(remote.data);
      const merged = remote.data ? mergeData(getData(), remote.data) : getData();
      if (remote.data && stable(merged) === stable(remote.data)) break;
      if (await putRemote(c, merged, remote.sha)) break;
    }
    setState({ status: 'idle', lastSync: Date.now() });
  } catch (e) {
    setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncNow();
    }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), PUSH_DELAY);
}

/** Checks the token and repo, then stores the connection on this device. */
export async function connect(token: string, repo: string, owner?: string): Promise<void> {
  let login = owner?.trim();
  if (!login) {
    const u = await fetch(`${API}/user`, { headers: { Authorization: `Bearer ${token}` } });
    if (!u.ok) throw new Error(u.status === 401 ? ghMessage(401) : 'Не удалось определить логин — впиши его вручную');
    login = (await u.json()).login as string;
  }
  const c: GithubConnection = { token: token.trim(), owner: login, repo: repo.trim() };
  const r = await gh(c, `/repos/${c.owner}/${c.repo}`);
  if (!r.ok) throw new Error(ghMessage(r.status));
  if (!(await r.json()).private) throw new Error('Репозиторий публичный — сделай его приватным, там будет твой ключ Gemini');
  await set('connection', c);
  conn = c;
  setState({ status: 'idle', error: '' });
  attachListeners();
  await syncNow();
}

async function useConnection(c: Connection) {
  await set('connection', c);
  conn = c;
  setState({ status: 'idle', error: '' });
  attachListeners();
  await syncNow();
}

/** Picks up a session handed back by the server after Google sign-in (URL fragment). */
export async function takeLoginFromUrl(): Promise<'ok' | 'error' | null> {
  const hash = new URLSearchParams(location.hash.slice(1));
  const clean = () => history.replaceState(null, '', location.pathname + location.search);
  if (location.hash === '#login-error') {
    clean();
    return 'error';
  }
  const session = hash.get('login');
  if (!session) return null;
  clean();
  await useConnection({ kind: 'cloud', session, name: hash.get('name') ?? '', email: hash.get('email') ?? '' });
  return 'ok';
}

export async function disconnect() {
  const c = conn;
  if (c?.kind === 'cloud') {
    await fetch(`${ACCOUNT_API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${c.session}` } }).catch(() => undefined);
  }
  await del('connection');
  conn = null;
  setState({ status: 'off', error: '', lastSync: 0 });
}

const CODE_PREFIX = 'DR1:';

export function connectionCode(c: GithubConnection): string {
  return CODE_PREFIX + toB64(JSON.stringify({ t: c.token, o: c.owner, r: c.repo }));
}

export async function connectWithCode(code: string): Promise<void> {
  const raw = code.trim();
  if (!raw.startsWith(CODE_PREFIX)) throw new Error('Это не код подключения Deutsch Reader');
  const { t, o, r } = JSON.parse(fromB64(raw.slice(CODE_PREFIX.length)));
  await connect(t, r, o);
}

let attached = false;

function attachListeners() {
  if (attached) return;
  attached = true;
  onLocalChange(() => {
    if (conn) schedule();
  });
  // iOS may suspend a hidden app at any moment, so push right away;
  // on return, pull what other devices changed
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
}

export async function initSync() {
  conn = (await get<Connection>('connection')) ?? null;
  if (!conn) return;
  setState({ status: 'idle' });
  attachListeners();
  await syncNow();
}
