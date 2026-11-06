import { inPlay, liveChunks, todayProgress, type AppData, type Chunk, type ChunkExample, type Word } from './store';
import { MILESTONES } from './gamify';
import type { Answer } from './srs';

export type Format =
  | 'intro'
  | 'choose'
  | 'listen'
  | 'article'
  | 'write'
  | 'sentence'
  | 'c-intro' // chunk formats: intro, cloze choice, word-order tiles, typed cloze, Russian -> German
  | 'c-choose'
  | 'c-tiles'
  | 'c-write'
  | 'c-ru'
  | 'more' // offer to go past today's new-card limit
  | 'chest'
  | 'blitz'
  | 'milestone'
  | 'goal';

const SPECIAL: Format[] = ['more', 'chest', 'blitz', 'milestone', 'goal'];
export const isSpecial = (f: Format) => SPECIAL.includes(f);

export interface FeedItem {
  key: number;
  wordId: string;
  chunkId?: string; // set for chunk cards (wordId is then empty)
  ex?: number; // which chunk example the card uses
  format: Format;
  graded: boolean; // false = extra practice, doesn't move the FSRS schedule
  options: string[];
  answer: number;
  tiles?: string[]; // shuffled words of the sentence for c-tiles
  blitz?: string[]; // noun ids for the article blitz
  milestone?: number;
  left?: number; // new cards still waiting, for the 'more' offer
  golden?: boolean; // bonus card: a correct answer pays GOLDEN_MULT × XP
}

export interface Session {
  seq: number;
  count: number; // answered cards in this session
  lastFormat?: Format;
  recent: string[];
  retry: { wordId: string; at: number }[]; // wordId holds itemKey (chunks are prefixed c:)
  pending: FeedItem[];
  introduced: Set<string>;
  practiceCursor: number;
  combo: number;
  nextSurpriseAt: number;
  nextSentenceAt: number;
  celebrateGoal: boolean;
  extraNew: number; // new cards allowed today on top of the limit (asked for in this session)
  offeredMore: boolean;
}

const between = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

export const newSession = (): Session => ({
  seq: 0,
  count: 0,
  recent: [],
  retry: [],
  pending: [],
  introduced: new Set(),
  practiceCursor: 0,
  combo: 0,
  nextSurpriseAt: between(8, 12),
  nextSentenceAt: between(10, 15),
  celebrateGoal: false,
  extraNew: 0,
  offeredMore: false,
});

export const EXTRA_NEW_STEP = 5;

export type NextResult = { item: FeedItem } | { item: null; reason: 'empty' | 'limit' };

const FALLBACK_DISTRACTORS = ['дом', 'вода', 'время', 'город', 'работа', 'друг', 'книга', 'машина', 'день', 'рука', 'говорить', 'идти', 'большой', 'новый', 'быстро', 'окно', 'дерево', 'спать'];

/** Short Russian label for a word: first dictionary meaning, else the in-context translation. */
export const shortTranslation = (w: Word) => (w.meanings.split(',')[0] || w.translation).trim();

export const fullGerman = (w: Word) => (w.article ? `${w.article} ${w.lemma}` : w.lemma);

export const shuffle = <T,>(arr: T[]) => {
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
function pickFormat(w: Word, listening: boolean, last?: Format): Format {
  const reps = w.card?.reps ?? 0;
  const stability = w.card?.stability ?? 0;
  let formats: Format[] = listening ? ['choose', 'listen'] : ['choose'];
  if (w.article && reps >= 1) formats.push('article');
  if (reps >= 2) formats.push('write');
  if (stability >= 7) formats = formats.filter((f) => f !== 'choose');
  const fresh = formats.filter((f) => f !== last);
  return shuffle(fresh.length ? fresh : formats)[0];
}

function makeItem(d: AppData, s: Session, w: Word, graded: boolean, format?: Format): FeedItem {
  const f = format ?? pickFormat(w, d.settings.listening, s.lastFormat);
  let options: string[] = [];
  let answer = -1;
  if (f === 'choose' || f === 'listen') ({ options, answer } = translationOptions(d, w));
  if (f === 'article') {
    options = ['der', 'die', 'das'];
    answer = options.indexOf(w.article);
  }
  return { key: ++s.seq, wordId: w.id, format: f, graded, options, answer };
}

/** German words of a sentence, punctuation stripped (tiles and their check use the same split). */
export const sentenceWords = (de: string) =>
  de
    .split(/\s+/)
    .map((t) => t.replace(/^[„“"«»(]+|[.,!?;:„“"«»)]+$/g, ''))
    .filter(Boolean);

// Chunk cards get harder as the phrase settles: pick the gap -> order the words -> type the gap or the whole chunk
function pickChunkFormat(c: Chunk, last?: Format): Format {
  const reps = c.card?.reps ?? 0;
  const stability = c.card?.stability ?? 0;
  let formats: Format[] = ['c-choose'];
  if (reps >= 1) formats.push('c-tiles');
  if (reps >= 2) formats.push('c-write');
  if (stability >= 7) formats = ['c-tiles', 'c-write', 'c-ru'];
  const fresh = formats.filter((f) => f !== last);
  return shuffle(fresh.length ? fresh : formats)[0];
}

function makeChunkItem(s: Session, c: Chunk, graded: boolean, format?: Format): FeedItem {
  const f = format ?? pickChunkFormat(c, s.lastFormat);
  // A different sentence each time so the chunk, not one sentence, gets remembered
  const ex = Math.floor(Math.random() * c.examples.length);
  const e = c.examples[ex];
  const item: FeedItem = { key: ++s.seq, wordId: '', chunkId: c.id, ex, format: f, graded, options: [], answer: -1 };
  if (f === 'c-choose') {
    item.options = shuffle([e.gap, ...e.wrong]);
    item.answer = item.options.indexOf(e.gap);
  }
  if (f === 'c-tiles') {
    const words = sentenceWords(e.de);
    let tiles = shuffle(words);
    for (let i = 0; i < 5 && words.length > 1 && tiles.join(' ') === words.join(' '); i++) tiles = shuffle(words);
    item.tiles = tiles;
  }
  return item;
}

/** A word or a chunk as the scheduler sees it; key is unique across both. */
interface Unit {
  key: string;
  card?: Word['card'];
  createdAt: number;
  word?: Word;
  chunk?: Chunk;
}

export const itemKey = (item: FeedItem) => (item.chunkId ? `c:${item.chunkId}` : item.wordId);

function makeUnitItem(d: AppData, s: Session, u: Unit, graded: boolean, format?: Format): FeedItem {
  return u.chunk ? makeChunkItem(s, u.chunk, graded, format) : makeItem(d, s, u.word!, graded, format);
}

const specialItem = (s: Session, format: Format, extra: Partial<FeedItem> = {}): FeedItem => ({
  key: ++s.seq,
  wordId: '',
  format,
  graded: false,
  options: [],
  answer: -1,
  ...extra,
});

// Celebrations and surprises break the rhythm every few cards so the feed never gets monotonous
function nextSpecial(d: AppData, s: Session, learning: Word[]): FeedItem | null {
  if (s.celebrateGoal) {
    s.celebrateGoal = false;
    return specialItem(s, 'goal');
  }

  const total = Object.values(d.words).filter((w) => !w.deleted).length;
  const milestone = MILESTONES.find((m) => total >= m && !d.stats.milestones.includes(m));
  if (milestone) return specialItem(s, 'milestone', { milestone });

  if (s.count >= s.nextSurpriseAt) {
    s.nextSurpriseAt = s.count + between(8, 12);
    const nouns = d.settings.learnMode === 'chunks' ? [] : Object.values(d.words).filter((w) => !w.deleted && w.article && inPlay(d, w));
    if (nouns.length >= 3 && Math.random() < 0.5) return specialItem(s, 'blitz', { blitz: shuffle(nouns.map((w) => w.id)) });
    return specialItem(s, 'chest');
  }

  if (s.count >= s.nextSentenceAt && d.settings.geminiKey) {
    const ready = learning.filter((w) => (w.card?.reps ?? 0) >= 2 && !s.recent.includes(w.id));
    if (ready.length) {
      s.nextSentenceAt = s.count + between(10, 15);
      return { ...specialItem(s, 'sentence'), wordId: shuffle(ready)[0].id };
    }
  }
  return null;
}

export function nextItem(d: AppData, s: Session): NextResult {
  const now = Date.now();
  const mode = d.settings.learnMode;
  const words = mode === 'chunks' ? [] : Object.values(d.words).filter((w) => !w.deleted && w.status === 'learning' && inPlay(d, w));
  const chunks = mode === 'words' ? [] : liveChunks(d).filter((c) => c.status === 'learning' && c.examples.length);
  const units: Unit[] = [
    ...words.map((w) => ({ key: w.id, card: w.card, createdAt: w.createdAt, word: w })),
    ...chunks.map((c) => ({ key: `c:${c.id}`, card: c.card, createdAt: c.createdAt, chunk: c })),
  ];
  if (!units.length) return { item: null, reason: 'empty' };
  const byKey = new Map(units.map((u) => [u.key, u]));

  const queued = s.pending.shift();
  if (queued && byKey.has(itemKey(queued))) return { item: queued };

  const special = nextSpecial(d, s, words);
  if (special) return { item: special };

  const notRecent = (u: Unit) => !s.recent.includes(u.key);

  // 1. Cards answered wrong a few cards ago
  const ri = s.retry.findIndex((r) => r.at <= s.count && byKey.has(r.wordId));
  if (ri >= 0) {
    const [r] = s.retry.splice(ri, 1);
    return { item: makeUnitItem(d, s, byKey.get(r.wordId)!, false) };
  }

  // 2. Reviews due by the schedule
  const due = units.filter((u) => u.card && u.card.due <= now && notRecent(u)).sort((a, b) => a.card!.due - b.card!.due);
  if (due[0]) return { item: makeUnitItem(d, s, due[0], true) };

  // 3. New cards within the daily limit (chunks first): an intro card, then a first quiz
  const fresh = units
    .filter((u) => !u.card && !s.introduced.has(u.key))
    .sort((a, b) => Number(!a.chunk) - Number(!b.chunk) || a.createdAt - b.createdAt);
  if (fresh[0] && todayProgress(d).newIntroduced < d.settings.newPerDay + s.extraNew) {
    const u = fresh[0];
    s.introduced.add(u.key);
    s.pending.push(makeUnitItem(d, s, u, true, u.chunk ? 'c-choose' : 'choose'));
    const intro: FeedItem = { key: ++s.seq, wordId: u.word?.id ?? '', format: u.chunk ? 'c-intro' : 'intro', graded: false, options: [], answer: -1 };
    if (u.chunk) Object.assign(intro, { chunkId: u.chunk.id, ex: 0 });
    return { item: intro };
  }
  // Limit reached but more is waiting: ask once instead of silently switching to practice
  if (fresh[0] && !s.offeredMore) {
    s.offeredMore = true;
    return { item: specialItem(s, 'more', { left: fresh.length }) };
  }

  // 4. Endless practice over already seen cards, today's first, weakest first
  const today = new Date().setHours(0, 0, 0, 0);
  const seen = units.filter((u) => u.card);
  const pool = (seen.filter(notRecent).length ? seen.filter(notRecent) : seen).sort((a, b) => {
    const at = (a.card!.last_review ?? 0) >= today ? 0 : 1;
    const bt = (b.card!.last_review ?? 0) >= today ? 0 : 1;
    return at - bt || a.card!.stability - b.card!.stability;
  });
  if (!pool.length) return { item: null, reason: 'limit' };
  return { item: makeUnitItem(d, s, pool[s.practiceCursor++ % pool.length], false) };
}

/** Bookkeeping after a card was shown and answered. */
export function afterAnswer(s: Session, item: FeedItem, correct: boolean, totalWords: number) {
  if (isSpecial(item.format)) return;
  if (item.format !== 'intro' && item.format !== 'c-intro') s.count++;
  s.lastFormat = item.format;
  s.recent = [...s.recent, itemKey(item)].slice(-Math.min(3, Math.max(0, totalWords - 1)));
  if (!correct && item.format !== 'sentence') s.retry.push({ wordId: itemKey(item), at: s.count + 4 });
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
const normalize = (s: string) => s.replace(/[.,!?;:„“"«»()]/g, '').trim().replace(/\s+/g, ' ');

export function checkWritten(w: Word, input: string): Answer {
  const parts = normalize(input).split(' ');
  let typedArticle = '';
  if (['der', 'die', 'das'].includes(parts[0]?.toLowerCase())) typedArticle = parts.shift()!.toLowerCase();
  if (w.article && typedArticle !== w.article) return 'again';
  const typed = parts.join(' ').toLowerCase();
  const target = normalize(w.lemma).toLowerCase();
  if (typed === target) return 'good';
  if (target.length >= 4 && distance(typed, target) === 1) return 'hard';
  return 'again';
}

const fold = (s: string) => normalize(s).toLowerCase();

/** Typed cloze gap: exact = good, one typo in a longer word = hard. */
export function checkGap(e: ChunkExample, input: string): Answer {
  const typed = fold(input);
  const target = fold(e.gap);
  if (typed === target) return 'good';
  if (target.length >= 4 && distance(typed, target) === 1) return 'hard';
  return 'again';
}

/** Whole chunk typed from its Russian meaning: small slips are "almost". */
export function checkChunk(c: Chunk, input: string): Answer {
  const typed = fold(input);
  const target = fold(c.text);
  if (typed === target) return 'good';
  if (distance(typed, target) <= Math.max(1, Math.floor(target.length / 12))) return 'hard';
  return 'again';
}

/** Tiles are right when the words come out in the sentence's order (case-insensitive). */
export const checkTiles = (e: ChunkExample, order: string[]): Answer =>
  order.join(' ').toLowerCase() === sentenceWords(e.de).join(' ').toLowerCase() ? 'good' : 'again';
