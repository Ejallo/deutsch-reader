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

export const CHEST_REWARDS = [20, 20, 30, 30, 30, 50, 50, 100];

/** Rolls the daily chest's contents. */
export function rollChest(): { gems: number; freeze: boolean; bonusXp: number; boostMinutes: number } {
  const gems = 20 + 10 * Math.floor(Math.random() * 5);
  const freeze = Math.random() < 0.3;
  return { gems, freeze, bonusXp: freeze ? 0 : 50, boostMinutes: 15 };
}

export const MILESTONES = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000];
