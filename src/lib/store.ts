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
  source?: string; // where the text came from (attribution for library texts)
  notes?: string[]; // e.g. corrections made by the AI critic
  createdAt: number;
}

export type WordStatus = 'learning' | 'known';

// FSRS card state with dates stored as epoch ms (JSON-friendly)
export interface SrsCard {
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  state: number;
  last_review?: number;
}

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
  card?: SrsCard; // absent until the word's first review
}

export interface FormLink extends Rec {
  lemmaKey: string;
}

export interface Settings extends Rec {
  geminiKey: string;
  geminiModel: string;
  newPerDay: number;
  sound: boolean;
  listening: boolean; // off = no listening cards and no automatic pronunciation
}

export interface Stats extends Rec {
  xp: number;
  streak: number;
  lastGoalDay: string; // last day the daily goal was met
  freezeUsedDay: string; // day a streak freeze covered
  milestones: number[]; // word-count milestones already celebrated
}

export const DAILY_GOAL = 20;

export interface Progress extends Rec {
  day: string; // local YYYY-MM-DD the counters belong to
  newIntroduced: number;
  reviewed: number;
}

export interface AppData {
  version: 1;
  texts: Record<string, TextDoc>;
  words: Record<string, Word>;
  forms: Record<string, FormLink>;
  settings: Settings;
  progress: Progress;
  stats: Stats;
}

export const DEFAULT_NEW_PER_DAY = 10;

export const emptyData = (): AppData => ({
  version: 1,
  texts: {},
  words: {},
  forms: {},
  settings: { geminiKey: '', geminiModel: '', newPerDay: DEFAULT_NEW_PER_DAY, sound: true, listening: true, updatedAt: 0 },
  progress: { day: '', newIntroduced: 0, reviewed: 0, updatedAt: 0 },
  stats: { xp: 0, streak: 0, lastGoalDay: '', freezeUsedDay: '', milestones: [], updatedAt: 0 },
});

const dayShift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayKey(d);
};

/** A freeze is available if none was used in the last 7 days. */
export function freezeAvailable(s: Stats): boolean {
  return !s.freezeUsedDay || s.freezeUsedDay < dayShift(-7);
}

/** Streak as shown today: still alive if yesterday (or the day before, with a freeze) met the goal. */
export function currentStreak(d: AppData): number {
  const s = d.stats;
  if (s.lastGoalDay === todayKey() || s.lastGoalDay === dayShift(-1)) return s.streak;
  if (s.lastGoalDay === dayShift(-2) && freezeAvailable(s)) return s.streak;
  return 0;
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's counters (zeroed when the stored ones belong to another day). */
export function todayProgress(d: AppData): Progress {
  const day = todayKey();
  return d.progress.day === day ? d.progress : { day, newIntroduced: 0, reviewed: 0, updatedAt: 0 };
}

function mergeMap<T extends Rec>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!out[k] || v.updatedAt > out[k].updatedAt) out[k] = v;
  }
  return out;
}

const newer = <T extends Rec>(a: T | undefined, b: T | undefined, fallback: T): T =>
  !a ? (b ?? fallback) : !b ? a : b.updatedAt > a.updatedAt ? b : a;

// Tolerates data written by older app versions (missing fields)
export function mergeData(a: AppData, b: AppData): AppData {
  const base = emptyData();
  const settings = newer(a.settings, b.settings, base.settings);
  return {
    version: 1,
    texts: mergeMap(a.texts ?? {}, b.texts ?? {}),
    words: mergeMap(a.words ?? {}, b.words ?? {}),
    forms: mergeMap(a.forms ?? {}, b.forms ?? {}),
    settings: { ...base.settings, ...settings },
    progress: newer(a.progress, b.progress, base.progress),
    stats: { ...base.stats, ...newer(a.stats, b.stats, base.stats) },
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

export function addText(title: string, content: string, source?: string, notes?: string[]): string {
  const id = crypto.randomUUID();
  const t = now();
  update((d) => ({ ...d, texts: { ...d.texts, [id]: { id, title, content, source, ...(notes?.length ? { notes } : {}), createdAt: t, updatedAt: t } } }));
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
    const alive = prev && !prev.deleted;
    const createdAt = alive ? prev.createdAt : t;
    // Re-saving (e.g. learning <-> known) keeps the review history
    const card = alive ? prev.card : undefined;
    return {
      ...d,
      words: { ...d.words, [key]: { ...w, id: key, createdAt, card, updatedAt: t } },
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

/** Stores a review result; counts it toward today's progress. */
export function saveReview(key: string, card: SrsCard, wasNew: boolean) {
  const t = now();
  update((d) => {
    const p = todayProgress(d);
    return {
      ...d,
      words: { ...d.words, [key]: { ...d.words[key], card, updatedAt: t } },
      progress: { ...p, newIntroduced: p.newIntroduced + (wasNew ? 1 : 0), reviewed: p.reviewed + 1, updatedAt: t },
    };
  });
}

/** Counts a practice answer that doesn't touch the schedule. */
export function countPractice() {
  const t = now();
  update((d) => {
    const p = todayProgress(d);
    return { ...d, progress: { ...p, reviewed: p.reviewed + 1, updatedAt: t } };
  });
}

export function addXp(amount: number) {
  if (amount <= 0) return;
  update((d) => ({ ...d, stats: { ...d.stats, xp: d.stats.xp + amount, updatedAt: now() } }));
}

/** Called once when today's goal is reached: extends or restarts the streak. */
export function recordGoal() {
  update((d) => {
    const s = d.stats;
    const today = todayKey();
    if (s.lastGoalDay === today) return d;
    let streak = 1;
    let freezeUsedDay = s.freezeUsedDay;
    if (s.lastGoalDay === dayShift(-1)) streak = s.streak + 1;
    else if (s.lastGoalDay === dayShift(-2) && freezeAvailable(s)) {
      streak = s.streak + 1;
      freezeUsedDay = dayShift(-1);
    }
    return { ...d, stats: { ...s, streak, freezeUsedDay, lastGoalDay: today, updatedAt: now() } };
  });
}

export function markMilestone(n: number) {
  update((d) => ({ ...d, stats: { ...d.stats, milestones: [...d.stats.milestones, n], updatedAt: now() } }));
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
