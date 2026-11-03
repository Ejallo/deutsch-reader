// Level n starts at 50 * n * (n - 1) XP: 0, 100, 300, 600, 1000…
export function levelOf(xp: number) {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level++;
  const start = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  return { level, into: xp - start, need: next - start };
}

/** x1 for the first 2 correct in a row, then +1 every 3, capped at x5. */
export const comboMultiplier = (combo: number) => Math.min(5, 1 + Math.floor(combo / 3));

export const XP = {
  good: 10,
  hard: 5,
  intro: 2,
  blitzHit: 5,
  sentenceOk: 30,
  sentenceFixed: 15,
};

/** Combo look: 0 none, 1 ⚡ (3+), 2 🔥 (5+), 3 🔥🔥 with a burning card (10+). */
export const comboTier = (combo: number) => (combo >= 10 ? 3 : combo >= 5 ? 2 : combo >= 3 ? 1 : 0);

/** Combos worth a big celebration: 5, 10, 20, 30… */
export const comboMilestone = (combo: number) => combo === 5 || (combo >= 10 && combo % 10 === 0);

// Variable rewards: an unpredictable bonus keeps every answer a little exciting
export const GOLDEN_MULT = 5;
export const GOLDEN_CHANCE = 1 / 12;
export const GOLDEN_GAP = 8; // at least this many cards between golden cards

/** Rolls a critical hit for a correct answer: ×3 rarely, ×2 sometimes, else ×1. */
export function rollCrit() {
  const r = Math.random();
  return r < 0.03 ? 3 : r < 0.13 ? 2 : 1;
}

export type Rarity = 'common' | 'rare' | 'epic';

export const RARITY: Record<Rarity, { label: string; xp: [number, number]; gems: [number, number] }> = {
  common: { label: 'Обычный сундук', xp: [20, 30], gems: [20, 40] },
  rare: { label: 'Редкий сундук', xp: [50, 70], gems: [50, 80] },
  epic: { label: 'Эпический сундук', xp: [100, 150], gems: [100, 150] },
};

export function rollRarity(): Rarity {
  const r = Math.random();
  return r < 0.06 ? 'epic' : r < 0.3 ? 'rare' : 'common';
}

/** While opening, a chest may jump one rarity up. */
export function rollUpgrade(r: Rarity): Rarity {
  if (r === 'common' && Math.random() < 0.2) return 'rare';
  if (r === 'rare' && Math.random() < 0.15) return 'epic';
  return r;
}

/** A random amount from the range, in steps of 10. */
export const rollRange = ([lo, hi]: [number, number]) => lo + 10 * Math.floor(Math.random() * ((hi - lo) / 10 + 1));

/** Rolls the daily chest's contents; an epic chest always holds a streak freeze. */
export function rollChest(): { rarity: Rarity; gems: number; freeze: boolean; bonusXp: number; boostMinutes: number } {
  const rarity = rollRarity();
  const freeze = rarity === 'epic' || Math.random() < 0.3;
  return { rarity, gems: rollRange(RARITY[rarity].gems), freeze, bonusXp: freeze ? 0 : rollRange(RARITY[rarity].xp), boostMinutes: rarity === 'epic' ? 30 : 15 };
}

export const MILESTONES = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000];
