import { addXp, getData, liveChunks, onStoreEvent, todayKey, updateData, type AppData, type QuestItem, type Quests } from './store';
import { RARITY, rollRange, rollRarity, type Rarity } from './gamify';

// Daily quests send the learner around the app: feed volume and quality, formats, chunks, games, dictionary.
// Every quest is earned by doing, never by luck (no "catch a golden card").

export type Metric =
  | 'correct' // correct feed answers ("almost" counts)
  | 'combo' // best combo (max)
  | 'cleanRun' // perfect answers in a row, no "almost" (max)
  | 'goal' // daily goal reached
  | 'accurateGoal' // daily goal with 90%+ accuracy
  | 'bonusRound'
  | 'dueClear' // nothing left waiting today
  | 'fixMistake' // a card missed earlier in the session answered right
  | 'listen'
  | 'articleRun' // article cards right in a row (max)
  | 'writePerfect' // written word without a typo
  | 'sentence' // sentence written and checked by Gemini
  | 'newWord' // new word or chunk introduced
  | 'chunk' // correct chunk answers
  | 'tiles'
  | 'gap'
  | 'chunkAdd'
  | 'fast' // correct in under 3 seconds
  | 'chestFeed' // surprise chest opened in the feed
  | 'xp'
  | 'blitz' // article blitz hits (max)
  | 'game'
  | 'speedScore' // (max)
  | 'survivalScore' // (max)
  | 'pairsFast' // pairs finished in 40 s or less
  | 'bossWin'
  | 'medal'
  | 'record'
  | 'wordAdd'
  | 'markKnown'
  | 'callMinutes'; // minutes spoken in voice role-play calls

const MAX_METRICS: Metric[] = ['combo', 'cleanRun', 'articleRun', 'blitz', 'speedScore', 'survivalScore'];

type Cat = 'volume' | 'quality' | 'formats' | 'chunks' | 'speed' | 'games' | 'dict' | 'talk';

export interface QuestDef {
  id: string;
  cat: Cat;
  tier: 1 | 2 | 3;
  metric: Metric;
  target: number;
  title: string;
  needs?: (d: AppData) => boolean;
}

const words = (d: AppData) => Object.values(d.words).filter((w) => !w.deleted);
const hasChunks = (d: AppData) => liveChunks(d).some((c) => c.status === 'learning' && c.examples.length);
const hasNouns = (d: AppData) => d.settings.learnMode !== 'chunks' && words(d).filter((w) => w.article && w.status === 'learning').length >= 3;
const hasWords = (n: number) => (d: AppData) => words(d).filter((w) => w.meanings || w.translation).length >= n;
const feedWords = (d: AppData) => d.settings.learnMode !== 'chunks' && words(d).some((w) => w.status === 'learning');
const hasNew = (d: AppData) => words(d).some((w) => w.status === 'learning' && !w.card) || liveChunks(d).some((c) => c.status === 'learning' && !c.card);

export const QUESTS: QuestDef[] = [
  // Feed: volume
  { id: 'correct10', cat: 'volume', tier: 1, metric: 'correct', target: 10, title: 'Ответь верно на 10 карточек' },
  { id: 'correct20', cat: 'volume', tier: 2, metric: 'correct', target: 20, title: 'Ответь верно на 20 карточек' },
  { id: 'correct30', cat: 'volume', tier: 3, metric: 'correct', target: 30, title: 'Ответь верно на 30 карточек' },
  { id: 'goal', cat: 'volume', tier: 2, metric: 'goal', target: 1, title: 'Выполни цель дня' },
  { id: 'bonusRound', cat: 'volume', tier: 3, metric: 'bonusRound', target: 1, title: 'Пройди бонусный раунд после цели' },
  { id: 'dueClear', cat: 'volume', tier: 3, metric: 'dueClear', target: 1, title: 'Повтори все карточки, которые ждут сегодня' },
  // Feed: quality
  { id: 'combo5', cat: 'quality', tier: 1, metric: 'combo', target: 5, title: 'Собери серию ×5' },
  { id: 'combo10', cat: 'quality', tier: 2, metric: 'combo', target: 10, title: 'Собери серию ×10' },
  { id: 'combo15', cat: 'quality', tier: 3, metric: 'combo', target: 15, title: 'Собери серию ×15' },
  { id: 'cleanRun10', cat: 'quality', tier: 3, metric: 'cleanRun', target: 10, title: '10 карточек подряд без «почти»' },
  { id: 'accurateGoal', cat: 'quality', tier: 3, metric: 'accurateGoal', target: 1, title: 'Цель дня с точностью от 90%' },
  { id: 'fixMistake2', cat: 'quality', tier: 2, metric: 'fixMistake', target: 2, title: 'Исправь 2 ошибки: ответь верно на вернувшиеся карточки' },
  // Feed: formats
  { id: 'listen5', cat: 'formats', tier: 2, metric: 'listen', target: 5, title: '5 верных ответов на слух', needs: (d) => d.settings.listening && feedWords(d) },
  { id: 'articleRun5', cat: 'formats', tier: 2, metric: 'articleRun', target: 5, title: '5 артиклей подряд без ошибок', needs: hasNouns },
  { id: 'write3', cat: 'formats', tier: 2, metric: 'writePerfect', target: 3, title: 'Напиши 3 слова по-немецки без опечаток', needs: feedWords },
  { id: 'sentence1', cat: 'formats', tier: 2, metric: 'sentence', target: 1, title: 'Составь предложение со словом', needs: (d) => !!d.settings.geminiKey && feedWords(d) },
  { id: 'newWord3', cat: 'formats', tier: 1, metric: 'newWord', target: 3, title: 'Узнай 3 новых слова', needs: hasNew },
  // Chunks
  { id: 'chunk5', cat: 'chunks', tier: 1, metric: 'chunk', target: 5, title: 'Ответь верно на 5 чанков', needs: hasChunks },
  { id: 'tiles3', cat: 'chunks', tier: 2, metric: 'tiles', target: 3, title: 'Собери 3 предложения из плиток', needs: hasChunks },
  { id: 'gap3', cat: 'chunks', tier: 2, metric: 'gap', target: 3, title: 'Впиши 3 пропуска в чанках', needs: hasChunks },
  { id: 'chunkAdd1', cat: 'chunks', tier: 2, metric: 'chunkAdd', target: 1, title: 'Добавь новый чанк' },
  // Speed and thrill
  { id: 'fast5', cat: 'speed', tier: 2, metric: 'fast', target: 5, title: '5 верных ответов быстрее 3 секунд' },
  { id: 'chestFeed', cat: 'speed', tier: 1, metric: 'chestFeed', target: 1, title: 'Открой сундук-сюрприз в ленте' },
  { id: 'xp100', cat: 'speed', tier: 2, metric: 'xp', target: 100, title: 'Набери 100 XP за день' },
  { id: 'xp250', cat: 'speed', tier: 3, metric: 'xp', target: 250, title: 'Набери 250 XP за день' },
  { id: 'blitz5', cat: 'speed', tier: 2, metric: 'blitz', target: 5, title: 'Попади 5 раз в блице артиклей', needs: hasNouns },
  // Games
  { id: 'game1', cat: 'games', tier: 1, metric: 'game', target: 1, title: 'Сыграй в любой аттракцион', needs: hasWords(6) },
  { id: 'speed15', cat: 'games', tier: 2, metric: 'speedScore', target: 15, title: 'Набери 15 в «Скорости»', needs: hasWords(6) },
  { id: 'survival10', cat: 'games', tier: 3, metric: 'survivalScore', target: 10, title: 'Продержись 10 вопросов в «Выживании»', needs: hasWords(20) },
  { id: 'pairs40', cat: 'games', tier: 2, metric: 'pairsFast', target: 1, title: 'Собери «Пары» быстрее 40 секунд', needs: hasWords(6) },
  { id: 'bossWin', cat: 'games', tier: 3, metric: 'bossWin', target: 1, title: 'Победи босса', needs: (d) => hasWords(6)(d) && d.stats.bossWonDay !== todayKey() },
  { id: 'medal1', cat: 'games', tier: 2, metric: 'medal', target: 1, title: 'Получи медаль в любой игре', needs: hasWords(6) },
  { id: 'record1', cat: 'games', tier: 3, metric: 'record', target: 1, title: 'Побей свой рекорд в игре', needs: (d) => hasWords(6)(d) && Object.values(d.stats.records).some((r) => r > 0) },
  // Speaking
  { id: 'call3', cat: 'talk', tier: 2, metric: 'callMinutes', target: 3, title: 'Поговори голосом 3 минуты', needs: (d) => !!d.settings.geminiKey },
  // Dictionary
  { id: 'wordAdd3', cat: 'dict', tier: 2, metric: 'wordAdd', target: 3, title: 'Добавь 3 новых слова в словарь' },
  { id: 'markKnown1', cat: 'dict', tier: 1, metric: 'markKnown', target: 1, title: 'Отметь слово как «знаю»', needs: (d) => words(d).some((w) => w.status === 'learning') },
];

export const WEEKLY: QuestDef[] = [
  { id: 'w-correct150', cat: 'volume', tier: 3, metric: 'correct', target: 150, title: '150 верных карточек за неделю' },
  { id: 'w-goal5', cat: 'volume', tier: 3, metric: 'goal', target: 5, title: 'Цель дня 5 дней из 7' },
  { id: 'w-game10', cat: 'games', tier: 3, metric: 'game', target: 10, title: '10 аттракционов за неделю', needs: hasWords(6) },
  { id: 'w-chunk50', cat: 'chunks', tier: 3, metric: 'chunk', target: 50, title: '50 верных чанков за неделю', needs: hasChunks },
  { id: 'w-xp1000', cat: 'speed', tier: 3, metric: 'xp', target: 1000, title: '1000 XP за неделю' },
];

const BY_ID = new Map([...QUESTS, ...WEEKLY].map((q) => [q.id, q]));
export const questDef = (id: string) => BY_ID.get(id);

export const QUEST_XP: Record<1 | 2 | 3, number> = { 1: 20, 2: 30, 3: 40 };
export const QUEST_GEMS = 10;
export const WEEKLY_XP = 150;
export const WEEKLY_GEMS = 50;
export const REROLL_GEMS = 20;
const STREAK_EPIC_EVERY = 7; // every 7th day in a row with all quests done, the chest is epic

// Same seed on every device, so a synced phone and PC get the same quests
function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffleWith<T>(arr: T[], rnd: () => number) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One easy, one medium and one hard quest, each from a different category. */
function pickDaily(d: AppData, day: string): QuestItem[] {
  const rnd = seeded(`q:${day}`);
  const usable = shuffleWith(
    QUESTS.filter((q) => !q.needs || q.needs(d)),
    rnd,
  );
  const out: QuestDef[] = [];
  for (const tier of [1, 2, 3] as const) {
    const q = usable.find((x) => x.tier === tier && !out.some((o) => o.cat === x.cat)) ?? usable.find((x) => x.tier === tier && !out.includes(x));
    if (q) out.push(q);
  }
  return out.map((q) => ({ id: q.id, progress: 0, done: false }));
}

export function weekKey(date = new Date()) {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return todayKey(monday);
}
const monthKey = () => todayKey().slice(0, 7);
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
};

/** Rolls today's quests, the week's challenge and the month counter over when their period changes. */
export function ensureQuests() {
  const d = getData();
  const q = d.quests;
  const day = todayKey();
  const week = weekKey();
  const month = monthKey();
  if (q.day === day && q.week === week && q.month === month && q.items.length) return;
  updateData((data) => {
    const cur = data.quests;
    const next: Quests = { ...cur, updatedAt: Date.now() };
    if (cur.day !== day || !cur.items.length) Object.assign(next, { day, items: pickDaily(data, day), rerolled: false, chest: 'none' });
    if (cur.week !== week) {
      const pool = WEEKLY.filter((w) => !w.needs || w.needs(data));
      const w = shuffleWith(pool, seeded(`w:${week}`))[0];
      Object.assign(next, { week, weekly: w ? { id: w.id, progress: 0, done: false } : null });
    }
    if (cur.month !== month) Object.assign(next, { month, monthCount: 0 });
    return { ...data, quests: next };
  });
}

export type RewardNote =
  | { kind: 'quest'; title: string; xp: number; gems: number; allDone: boolean }
  | { kind: 'weekly'; title: string; xp: number; gems: number }
  | { kind: 'badge'; id: string; emoji: string; title: string; desc: string };

const rewardListeners = new Set<(n: RewardNote) => void>();
export function onReward(l: (n: RewardNote) => void) {
  rewardListeners.add(l);
  return () => rewardListeners.delete(l);
}
export const notifyReward = (n: RewardNote) => rewardListeners.forEach((l) => l(n));

function advance(item: QuestItem, def: QuestDef, metric: Metric, amount: number): QuestItem {
  if (item.done || def.metric !== metric) return item;
  const progress = MAX_METRICS.includes(metric) ? Math.max(item.progress, amount) : item.progress + amount;
  return { ...item, progress: Math.min(progress, def.target), done: progress >= def.target };
}

/** Counts something the learner did toward today's quests and the weekly challenge; pays out what it completes. */
export function questEvent(metric: Metric, amount = 1) {
  if (amount <= 0) return;
  ensureQuests();
  const q = getData().quests;
  const items = q.items.map((it) => {
    const def = questDef(it.id);
    return def ? advance(it, def, metric, amount) : it;
  });
  const weeklyDef = q.weekly && questDef(q.weekly.id);
  const weekly = q.weekly && weeklyDef ? advance(q.weekly, weeklyDef, metric, amount) : q.weekly;
  const newlyDone = items.filter((it, i) => it.done && !q.items[i].done);
  const weeklyDone = !!weekly?.done && !q.weekly?.done;
  const changed = items.some((it, i) => it.progress !== q.items[i].progress) || weekly?.progress !== q.weekly?.progress;
  if (!changed) return;

  const allDone = newlyDone.length > 0 && items.every((it) => it.done);
  const day = todayKey();
  let xp = 0;
  let gems = 0;
  for (const it of newlyDone) {
    xp += QUEST_XP[questDef(it.id)!.tier];
    gems += QUEST_GEMS;
  }
  if (weeklyDone) {
    xp += WEEKLY_XP;
    gems += WEEKLY_GEMS;
  }
  updateData((data) => {
    const cur = data.quests;
    const streak = allDone ? (cur.lastAllDoneDay === yesterday() ? cur.allDoneStreak + 1 : cur.lastAllDoneDay === day ? cur.allDoneStreak : 1) : cur.allDoneStreak;
    const monthCount = cur.monthCount + newlyDone.length;
    return {
      ...data,
      quests: {
        ...cur,
        items,
        weekly,
        monthCount,
        chest: allDone ? 'ready' : cur.chest,
        allDoneStreak: streak,
        lastAllDoneDay: allDone ? day : cur.lastAllDoneDay,
        updatedAt: Date.now(),
      },
      stats: {
        ...data.stats,
        gems: data.stats.gems + gems,
        questsDone: data.stats.questsDone + newlyDone.length,
        bestMonthQuests: Math.max(data.stats.bestMonthQuests, monthCount),
        updatedAt: Date.now(),
      },
    };
  });
  // Quest XP isn't fed back into the 'xp' metric, so payouts can't complete each other in a loop
  if (xp) addXp(xp);
  for (const it of newlyDone) {
    const def = questDef(it.id)!;
    notifyReward({ kind: 'quest', title: def.title, xp: QUEST_XP[def.tier], gems: QUEST_GEMS, allDone: allDone && it === newlyDone[newlyDone.length - 1] });
  }
  if (weeklyDone && weeklyDef) notifyReward({ kind: 'weekly', title: weeklyDef.title, xp: WEEKLY_XP, gems: WEEKLY_GEMS });
}

/** Swaps one unfinished quest for another of the same difficulty, once a day, for gems. */
export function rerollQuest(id: string): boolean {
  const d = getData();
  const q = d.quests;
  const def = questDef(id);
  if (q.rerolled || d.stats.gems < REROLL_GEMS || !def) return false;
  const taken = new Set(q.items.map((it) => it.id));
  const cats = new Set(q.items.filter((it) => it.id !== id).map((it) => questDef(it.id)?.cat));
  const pool = QUESTS.filter((x) => x.tier === def.tier && !taken.has(x.id) && (!x.needs || x.needs(d)));
  const otherCat = pool.filter((x) => !cats.has(x.cat));
  const choice = shuffleWith(otherCat.length ? otherCat : pool, Math.random)[0];
  if (!choice) return false;
  updateData((data) => ({
    ...data,
    quests: { ...data.quests, rerolled: true, items: data.quests.items.map((it) => (it.id === id ? { id: choice.id, progress: 0, done: false } : it)), updatedAt: Date.now() },
    stats: { ...data.stats, gems: data.stats.gems - REROLL_GEMS, updatedAt: Date.now() },
  }));
  return true;
}

/** Rarity of today's quest chest: epic on every 7th day in a row, otherwise a normal roll. */
export const questChestRarity = (): Rarity => (getData().quests.allDoneStreak % STREAK_EPIC_EVERY === 0 ? 'epic' : rollRarity());

export function claimQuestChest(rarity: Rarity): { xp: number; gems: number } {
  const xp = rollRange(RARITY[rarity].xp);
  const gems = rollRange(RARITY[rarity].gems);
  if (getData().quests.chest !== 'ready') return { xp: 0, gems: 0 };
  updateData((data) => ({
    ...data,
    quests: { ...data.quests, chest: 'claimed', updatedAt: Date.now() },
    stats: { ...data.stats, gems: data.stats.gems + gems, updatedAt: Date.now() },
  }));
  addXp(xp);
  return { xp, gems };
}

/** How many more of `metric` the closest unfinished quest needs, for the "ещё N до…" hint. */
export function closestQuest(metrics: Metric[]): { left: number; title: string } | null {
  let best: { left: number; title: string } | null = null;
  for (const it of getData().quests.items) {
    const def = questDef(it.id);
    if (!def || it.done || !metrics.includes(def.metric)) continue;
    const left = def.target - it.progress;
    if (!best || left < best.left) best = { left, title: def.title };
  }
  return best;
}

export function startQuests() {
  ensureQuests();
  onStoreEvent((e) => questEvent(e));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureQuests();
  });
}
