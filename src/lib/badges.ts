import { getData, liveChunks, updateData, type AppData, type Word } from './store';
import { levelOf } from './gamify';
import { notifyReward } from './quests';

export interface BadgeDef {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  /** Current value and the target; the badge is earned at cur >= target. */
  progress: (d: AppData) => [number, number];
}

const wordCount = (d: AppData) => Object.values(d.words).filter((w) => !w.deleted).length;
const maxMedal = (d: AppData) => Math.max(...Object.values(d.stats.medals));

const ladder = (prefix: string, emoji: string, steps: [number, string, string][], value: (d: AppData) => number): BadgeDef[] =>
  steps.map(([n, title, desc]) => ({ id: `${prefix}${n}`, emoji, title, desc, progress: (d) => [value(d), n] }));

export const BADGES: BadgeDef[] = [
  ...ladder('words', '📚', [
    [10, 'Первые шаги', '10 слов в словаре'],
    [50, 'Собиратель', '50 слов в словаре'],
    [100, 'Сотня', '100 слов в словаре'],
    [250, 'Словарный запас', '250 слов в словаре'],
    [500, 'Ходячий словарь', '500 слов в словаре'],
  ], wordCount),
  ...ladder('streak', '🔥', [
    [3, 'Разогрев', 'Серия 3 дня'],
    [7, 'Неделя огня', 'Серия 7 дней'],
    [30, 'Месяц без пропусков', 'Серия 30 дней'],
    [100, 'Легенда', 'Серия 100 дней'],
  ], (d) => d.stats.streak),
  ...ladder('level', '⭐', [
    [5, 'Уровень 5', 'Дойди до 5 уровня'],
    [10, 'Уровень 10', 'Дойди до 10 уровня'],
    [20, 'Уровень 20', 'Дойди до 20 уровня'],
  ], (d) => levelOf(d.stats.xp).level),
  ...ladder('combo', '⚡', [
    [10, 'В ударе', 'Серия ×10 в ленте'],
    [25, 'Неудержимый', 'Серия ×25 в ленте'],
  ], (d) => d.stats.bestCombo),
  { id: 'gold', emoji: '🥇', title: 'Золотой игрок', desc: 'Золотая медаль в любом аттракционе', progress: (d) => [maxMedal(d) >= 3 ? 1 : 0, 1] },
  ...ladder('boss', '👹', [
    [1, 'Охотник на чертей', 'Победи босса'],
    [10, 'Гроза Fehlerteufel', 'Победи босса 10 раз'],
  ], (d) => d.stats.bossWins),
  ...ladder('quests', '🎯', [
    [10, 'Исполнитель', '10 выполненных заданий'],
    [50, 'Мастер заданий', '50 выполненных заданий'],
  ], (d) => d.stats.questsDone),
  ...ladder('month', '📅', [
    [30, 'Месяц заданий', '30 заданий за месяц'],
    [60, 'Трудоголик', '60 заданий за месяц'],
    [90, 'Все задания месяца', '90 заданий за месяц'],
  ], (d) => d.stats.bestMonthQuests),
  { id: 'perfect', emoji: '💎', title: 'Идеальный день', desc: 'Цель дня без единой ошибки', progress: (d) => [Math.min(d.stats.perfectDays, 1), 1] },
  ...ladder('chunks', '🧩', [[10, 'Мастер фраз', '10 чанков в колоде']], (d) => liveChunks(d).length),
];

const earned = (d: AppData, b: BadgeDef) => {
  const [cur, target] = b.progress(d);
  return cur >= target;
};

/**
 * Awards badges whose goal is reached. The first run gives the ones already reached silently,
 * so an existing learner isn't buried under a dozen celebrations.
 */
export function checkBadges() {
  const d = getData();
  const fresh = BADGES.filter((b) => !d.stats.badges[b.id] && earned(d, b));
  if (!fresh.length && d.stats.badgesSeeded) return;
  const t = Date.now();
  updateData((data) => ({
    ...data,
    stats: { ...data.stats, badges: { ...data.stats.badges, ...Object.fromEntries(fresh.map((b) => [b.id, t])) }, badgesSeeded: true, updatedAt: t },
  }));
  if (!d.stats.badgesSeeded) return;
  for (const b of fresh) notifyReward({ kind: 'badge', id: b.id, emoji: b.emoji, title: b.title, desc: b.desc });
}

// Album ranks follow how long a word is remembered (FSRS stability, in days)
export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAME = ['Новое', 'Бронза', 'Серебро', 'Золото'];
export const TIER_ICON = ['', '🥉', '🥈', '🥇'];

export function wordTier(w: Word): Tier {
  if (w.status === 'known') return 3;
  const s = w.card?.stability ?? 0;
  return s >= 90 ? 3 : s >= 21 ? 2 : s >= 3 ? 1 : 0;
}
