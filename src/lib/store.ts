import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';

// Every synced record carries updatedAt; merges keep the newest version.
// Deletions are tombstones (deleted: true) so they propagate between devices.
export interface Rec {
  updatedAt: number;
  deleted?: boolean;
}

export interface TextDoc extends Rec {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

export type WordStatus = 'learning' | 'known';

export interface Word extends Rec {
  id: string; // lemma key
  lemma: string;
  article: string;
  plural: string;
  pos: string;
  translation: string; // as used in the example sentence
  meanings: string; // main meanings of the dictionary form
  note: string;
  status: WordStatus;
  example: string;
  createdAt: number;
}

export interface FormLink extends Rec {
  lemmaKey: string;
}

export interface Settings extends Rec {
  geminiKey: string;
  geminiModel: string;
}

export interface AppData {
  version: 1;
  texts: Record<string, TextDoc>;
  words: Record<string, Word>;
  forms: Record<string, FormLink>;
  settings: Settings;
}

export const emptyData = (): AppData => ({
  version: 1,
  texts: {},
  words: {},
  forms: {},
  settings: { geminiKey: '', geminiModel: '', updatedAt: 0 },
});

function mergeMap<T extends Rec>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!out[k] || v.updatedAt > out[k].updatedAt) out[k] = v;
  }
  return out;
}

export function mergeData(a: AppData, b: AppData): AppData {
  return {
    version: 1,
    texts: mergeMap(a.texts, b.texts),
    words: mergeMap(a.words, b.words),
    forms: mergeMap(a.forms, b.forms),
    settings: b.settings.updatedAt > a.settings.updatedAt ? b.settings : a.settings,
  };
}

let data: AppData = emptyData();
const uiListeners = new Set<() => void>();
const localChangeListeners = new Set<() => void>();

function emit(local: boolean) {
  uiListeners.forEach((l) => l());
  if (local) localChangeListeners.forEach((l) => l());
  void set('data', data);
}

export async function loadStore() {
  const saved = await get<AppData>('data');
  if (saved) data = mergeData(emptyData(), saved);
  uiListeners.forEach((l) => l());
}

export const getData = () => data;

export function useData(): AppData {
  return useSyncExternalStore(
    (l) => {
      uiListeners.add(l);
      return () => uiListeners.delete(l);
    },
    () => data,
  );
}

/** Fires only for changes made on this device (not ones pulled from sync). */
export function onLocalChange(l: () => void) {
  localChangeListeners.add(l);
  return () => localChangeListeners.delete(l);
}

/** Merges data pulled from another device without triggering a push. */
export function applyRemote(remote: AppData) {
  data = mergeData(data, remote);
  emit(false);
}

function update(fn: (d: AppData) => AppData) {
  data = fn(data);
  emit(true);
}

const now = () => Date.now();
export const lemmaKey = (lemma: string) => lemma.trim().toLowerCase();

export function addText(title: string, content: string): string {
  const id = crypto.randomUUID();
  const t = now();
  update((d) => ({ ...d, texts: { ...d.texts, [id]: { id, title, content, createdAt: t, updatedAt: t } } }));
  return id;
}

export function deleteText(id: string) {
  update((d) => ({ ...d, texts: { ...d.texts, [id]: { ...d.texts[id], content: '', deleted: true, updatedAt: now() } } }));
}

export function saveWord(form: string, w: Omit<Word, 'id' | 'createdAt' | 'updatedAt'>) {
  const key = lemmaKey(w.lemma);
  const t = now();
  update((d) => {
    const prev = d.words[key];
    const createdAt = prev && !prev.deleted ? prev.createdAt : t;
    return {
      ...d,
      words: { ...d.words, [key]: { ...w, id: key, createdAt, updatedAt: t } },
      forms: { ...d.forms, [form]: { lemmaKey: key, updatedAt: t } },
    };
  });
}

export function linkForm(form: string, key: string) {
  const cur = data.forms[form];
  if (cur && !cur.deleted && cur.lemmaKey === key) return;
  update((d) => ({ ...d, forms: { ...d.forms, [form]: { lemmaKey: key, updatedAt: now() } } }));
}

export function removeWord(key: string) {
  const t = now();
  update((d) => {
    const forms = { ...d.forms };
    for (const [f, link] of Object.entries(forms)) {
      if (link.lemmaKey === key && !link.deleted) forms[f] = { ...link, deleted: true, updatedAt: t };
    }
    return { ...d, forms, words: { ...d.words, [key]: { ...d.words[key], deleted: true, updatedAt: t } } };
  });
}

export function updateSettings(patch: Partial<Omit<Settings, 'updatedAt'>>) {
  update((d) => ({ ...d, settings: { ...d.settings, ...patch, updatedAt: now() } }));
}

export function importData(incoming: AppData) {
  update((d) => mergeData(d, incoming));
}

export type FormStatus = 'new' | WordStatus;

export function wordForForm(d: AppData, form: string): Word | null {
  const link = d.forms[form];
  if (!link || link.deleted) return null;
  const w = d.words[link.lemmaKey];
  return w && !w.deleted ? w : null;
}

export const statusOf = (d: AppData, form: string): FormStatus => wordForForm(d, form)?.status ?? 'new';

export const liveTexts = (d: AppData) =>
  Object.values(d.texts)
    .filter((t) => !t.deleted)
    .sort((a, b) => b.createdAt - a.createdAt);
