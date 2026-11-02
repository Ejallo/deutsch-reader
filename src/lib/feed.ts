import { todayProgress, type AppData, type Word } from './store';
import type { Answer } from './srs';

export type Format = 'intro' | 'choose' | 'listen' | 'article' | 'write';

export interface FeedItem {
  key: number;
  wordId: string;
  format: Format;
  graded: boolean; // false = extra practice, doesn't move the FSRS schedule
  options: string[];
  answer: number;
}

export interface Session {
  seq: number;
  count: number; // answered cards in this session
  lastFormat?: Format;
  recent: string[];
  retry: { wordId: string; at: number }[];
  pending: FeedItem[];
  introduced: Set<string>;
  practiceCursor: number;
}

export const newSession = (): Session => ({ seq: 0, count: 0, recent: [], retry: [], pending: [], introduced: new Set(), practiceCursor: 0 });

export type NextResult = { item: FeedItem } | { item: null; reason: 'empty' | 'limit' };

const FALLBACK_DISTRACTORS = ['дом', 'вода', 'время', 'город', 'работа', 'друг', 'книга', 'машина', 'день', 'рука', 'говорить', 'идти', 'большой', 'новый', 'быстро', 'окно', 'дерево', 'спать'];

/** Short Russian label for a word: first dictionary meaning, else the in-context translation. */
export const shortTranslation = (w: Word) => (w.meanings.split(',')[0] || w.translation).trim();

export const fullGerman = (w: Word) => (w.article ? `${w.article} ${w.lemma}` : w.lemma);

const shuffle = <T,>(arr: T[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function translationOptions(d: AppData, w: Word): { options: string[]; answer: number } {
  const correct = shortTranslation(w);
  const others = shuffle(
    Object.values(d.words)
      .filter((o) => !o.deleted && o.id !== w.id)
      .map(shortTranslation)
      .filter((t) => t && t.toLowerCase() !== correct.toLowerCase()),
  );
  const pool = [...new Set([...others, ...shuffle(FALLBACK_DISTRACTORS).filter((t) => t !== correct)])];
  const options = shuffle([correct, ...pool.slice(0, 3)]);
  return { options, answer: options.indexOf(correct) };
}

// Harder formats unlock as the word settles in memory
function pickFormat(w: Word, last?: Format): Format {
  const reps = w.card?.reps ?? 0;
  const stability = w.card?.stability ?? 0;
  let formats: Format[] = ['choose', 'listen'];
  if (w.article && reps >= 1) formats.push('article');
  if (reps >= 2) formats.push('write');
  if (stability >= 7) formats = formats.filter((f) => f !== 'choose');
  const fresh = formats.filter((f) => f !== last);
  return shuffle(fresh.length ? fresh : formats)[0];
}

function makeItem(d: AppData, s: Session, w: Word, graded: boolean, format?: Format): FeedItem {
  const f = format ?? pickFormat(w, s.lastFormat);
  let options: string[] = [];
  let answer = -1;
  if (f === 'choose' || f === 'listen') ({ options, answer } = translationOptions(d, w));
  if (f === 'article') {
    options = ['der', 'die', 'das'];
    answer = options.indexOf(w.article);
  }
  return { key: ++s.seq, wordId: w.id, format: f, graded, options, answer };
}

export function nextItem(d: AppData, s: Session): NextResult {
  const now = Date.now();
  const words = Object.values(d.words).filter((w) => !w.deleted && w.status === 'learning');
  if (!words.length) return { item: null, reason: 'empty' };
  const byId = new Map(words.map((w) => [w.id, w]));

  const queued = s.pending.shift();
  if (queued && byId.has(queued.wordId)) return { item: queued };

  const notRecent = (w: Word) => !s.recent.includes(w.id);

  // 1. Words answered wrong a few cards ago
  const ri = s.retry.findIndex((r) => r.at <= s.count && byId.has(r.wordId));
  if (ri >= 0) {
    const [r] = s.retry.splice(ri, 1);
    return { item: makeItem(d, s, byId.get(r.wordId)!, false) };
  }

  // 2. Reviews due by the schedule
  const due = words.filter((w) => w.card && w.card.due <= now && notRecent(w)).sort((a, b) => a.card!.due - b.card!.due);
  if (due[0]) return { item: makeItem(d, s, due[0], true) };

  // 3. New words within the daily limit: an intro card, then a first quiz
  const fresh = words.filter((w) => !w.card && !s.introduced.has(w.id)).sort((a, b) => a.createdAt - b.createdAt);
  if (fresh[0] && todayProgress(d).newIntroduced < d.settings.newPerDay) {
    const w = fresh[0];
    s.introduced.add(w.id);
    s.pending.push(makeItem(d, s, w, true, 'choose'));
    return { item: { key: ++s.seq, wordId: w.id, format: 'intro', graded: false, options: [], answer: -1 } };
  }

  // 4. Endless practice over already seen words, today's first, weakest first
  const today = new Date().setHours(0, 0, 0, 0);
  const seen = words.filter((w) => w.card);
  const pool = (seen.filter(notRecent).length ? seen.filter(notRecent) : seen).sort((a, b) => {
    const at = (a.card!.last_review ?? 0) >= today ? 0 : 1;
    const bt = (b.card!.last_review ?? 0) >= today ? 0 : 1;
    return at - bt || a.card!.stability - b.card!.stability;
  });
  if (!pool.length) return { item: null, reason: 'limit' };
  return { item: makeItem(d, s, pool[s.practiceCursor++ % pool.length], false) };
}

/** Bookkeeping after a card was shown and answered. */
export function afterAnswer(s: Session, item: FeedItem, correct: boolean, totalWords: number) {
  if (item.format !== 'intro') s.count++;
  s.lastFormat = item.format;
  s.recent = [...s.recent, item.wordId].slice(-Math.min(3, Math.max(0, totalWords - 1)));
  if (!correct) s.retry.push({ wordId: item.wordId, at: s.count + 4 });
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** good = exact, hard = one typo ("almost"), again = wrong. A wrong or missing article is wrong. */
export function checkWritten(w: Word, input: string): Answer {
  const parts = input.trim().replace(/\s+/g, ' ').split(' ');
  let typedArticle = '';
  if (['der', 'die', 'das'].includes(parts[0]?.toLowerCase())) typedArticle = parts.shift()!.toLowerCase();
  if (w.article && typedArticle !== w.article) return 'again';
  const typed = parts.join(' ').toLowerCase();
  const target = w.lemma.toLowerCase();
  if (typed === target) return 'good';
  if (target.length >= 4 && distance(typed, target) === 1) return 'hard';
  return 'again';
}
