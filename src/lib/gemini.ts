import { get, set } from 'idb-keyval';
import { getData, updateSettings } from './store';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

// Device-local translation cache: repeated taps never spend quota
let cache: Record<string, unknown> = {};
let cacheSave: ReturnType<typeof setTimeout> | undefined;

export async function loadCache() {
  cache = (await get('cache')) ?? {};
}

function remember(key: string, value: unknown) {
  cache[key] = value;
  clearTimeout(cacheSave);
  cacheSave = setTimeout(() => void set('cache', cache), 500);
}

export interface ModelInfo {
  name: string; // "models/..."
  displayName: string;
}

export async function listModels(key: string): Promise<ModelInfo[]> {
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw new GeminiError(r.status === 400 || r.status === 403 ? 'Ключ Gemini не подходит' : `Gemini: ошибка ${r.status}`);
  const j = await r.json();
  return (j.models ?? [])
    .filter(
      (m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes('generateContent') &&
        m.name.includes('gemini') &&
        !/embedding|tts|image|live|audio|robotics|computer/.test(m.name),
    )
    .map((m: ModelInfo) => ({ name: m.name, displayName: m.displayName }));
}

export const versionOf = (name: string) => parseFloat(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');

/** Newest stable Flash-Lite: the cheapest on free-tier quota; falls back to Flash. */
export function pickDefaultModel(models: ModelInfo[]): string {
  const stable = models.filter((m) => !/preview|exp|latest/.test(m.name));
  const byVersion = (a: ModelInfo, b: ModelInfo) => versionOf(b.name) - versionOf(a.name);
  const lite = stable.filter((m) => m.name.includes('flash-lite')).sort(byVersion);
  const flash = stable.filter((m) => m.name.includes('flash')).sort(byVersion);
  return (lite[0] ?? flash[0] ?? models[0])?.name ?? '';
}

async function ensureModel(key: string): Promise<string> {
  const s = getData().settings;
  if (s.geminiModel) return s.geminiModel;
  const model = pickDefaultModel(await listModels(key));
  if (!model) throw new GeminiError('Не нашёл подходящую модель Gemini');
  updateSettings({ geminiModel: model });
  return model;
}

interface GenOptions {
  model?: string; // a specific model instead of the user's default
  temperature?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45000;

async function generate<T>(prompt: string, schema: object, opts: GenOptions = {}): Promise<T> {
  const key = getData().settings.geminiKey;
  if (!key) throw new GeminiError('Добавь ключ Gemini в настройках');
  if (!navigator.onLine) throw new GeminiError('Нет интернета');
  const model = opts.model ?? (await ensureModel(key));
  // Some models occasionally never answer; don't let the app hang on them
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(`${API}/${model}:generateContent`, {
    signal: ctrl.signal,
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: opts.temperature ?? 0.2 },
    }),
    });
  } catch {
    throw new GeminiError('Gemini не ответил вовремя — попробуй ещё раз', 408);
  } finally {
    clearTimeout(timer);
  }
  if (r.status === 429) throw new GeminiError('Лимит бесплатных запросов Gemini исчерпан — попробуй позже', 429);
  if (r.status === 400 || r.status === 403) {
    const msg = (await r.json().catch(() => null))?.error?.message ?? '';
    throw new GeminiError(/API key/i.test(msg) ? 'Ключ Gemini не подходит' : `Gemini: ${msg || r.status}`);
  }
  if (r.status === 404) {
    // Model was retired: forget it so the next call picks a fresh one
    if (!opts.model) updateSettings({ geminiModel: '' });
    throw new GeminiError('Модель Gemini недоступна — повтори, выберу другую', 404);
  }
  if (!r.ok) throw new GeminiError(`Gemini: ошибка ${r.status}`, r.status);
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError('Gemini вернул непонятный ответ — попробуй ещё раз');
  }
}

const S = (description: string) => ({ type: 'STRING', description });

export interface WordInfo {
  lemma: string;
  article: string;
  plural: string;
  pos: string;
  translation: string;
  lemmaTranslation: string;
  note: string;
}

const wordSchema = {
  type: 'OBJECT',
  properties: {
    lemma: S('Dictionary form without article. Separable verbs joined (fängt…an -> anfangen). Nouns capitalized.'),
    article: S('der, die or das for nouns; empty string otherwise'),
    plural: S('Plural form with article for nouns (die Hunde); empty string otherwise'),
    pos: S('Part of speech in Russian, short (сущ., глагол, прил., нареч., предлог, союз, местоим.)'),
    translation: S('Russian translation of the word as used in this sentence'),
    lemmaTranslation: S('Main Russian meanings of the dictionary form, comma-separated, max 3'),
    note: S('One short Russian hint if useful (separable verb, case, idiom); empty string otherwise'),
  },
  required: ['lemma', 'article', 'plural', 'pos', 'translation', 'lemmaTranslation', 'note'],
};

export async function translateWord(word: string, sentence: string): Promise<WordInfo> {
  const key = `w|${word}|${sentence}`;
  if (cache[key]) return cache[key] as WordInfo;
  const r = await generate<WordInfo>(
    `You help a Russian speaker read German. Analyze the German word "${word}" as it is used in this sentence:\n"${sentence}"\nAnswer in JSON.`,
    wordSchema,
  );
  const art = r.article.trim().toLowerCase();
  const info = { ...r, article: ['der', 'die', 'das'].includes(art) ? art : '' };
  remember(key, info);
  return info;
}

export interface PhraseInfo {
  translation: string;
  note: string;
}

export async function translatePhrase(phrase: string, sentence: string): Promise<PhraseInfo> {
  const key = `p|${phrase}|${sentence}`;
  if (cache[key]) return cache[key] as PhraseInfo;
  const r = await generate<PhraseInfo>(
    `You help a Russian speaker read German. Translate the German phrase "${phrase}" into natural Russian as used in this sentence:\n"${sentence}"\nAnswer in JSON.`,
    {
      type: 'OBJECT',
      properties: {
        translation: S('Natural Russian translation of the phrase in this context'),
        note: S('One short Russian hint about grammar or idiom if useful; empty string otherwise'),
      },
      required: ['translation', 'note'],
    },
  );
  remember(key, r);
  return r;
}

export async function translateParagraph(text: string): Promise<string> {
  const key = `para|${text}`;
  if (cache[key]) return cache[key] as string;
  const r = await generate<{ translation: string }>(
    `Translate this German text into natural Russian. Keep paragraph breaks.\n\n${text}`,
    { type: 'OBJECT', properties: { translation: S('Russian translation') }, required: ['translation'] },
  );
  remember(key, r.translation);
  return r.translation;
}

export interface SentenceCheck {
  ok: boolean;
  usesWord: boolean;
  corrected: string;
  issues: { wrong: string; right: string; explanation: string }[];
  comment: string;
}

export async function checkSentence(word: string, sentence: string): Promise<SentenceCheck> {
  return generate<SentenceCheck>(
    `A Russian speaker learning German wrote a sentence using the word "${word}":\n"${sentence}"\n` +
      'Check grammar, spelling (including capitalization and umlauts) and word usage. Ignore missing final punctuation. ' +
      'Explanations must be short, in Russian, and name the rule (e.g. "после mit — дательный падеж"). Answer in JSON.',
    {
      type: 'OBJECT',
      properties: {
        ok: { type: 'BOOLEAN', description: 'true if the sentence has no errors' },
        usesWord: { type: 'BOOLEAN', description: 'true if the target word (any form) is used' },
        corrected: S('The corrected sentence; same as input if ok'),
        issues: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { wrong: S('Wrong fragment as written'), right: S('Correct fragment'), explanation: S('Short rule in Russian') },
            required: ['wrong', 'right', 'explanation'],
          },
        },
        comment: S('One short encouraging remark in Russian'),
      },
      required: ['ok', 'usesWord', 'corrected', 'issues', 'comment'],
    },
  );
}

export async function generateText(level: string, topic: string, words: number, include: string[]): Promise<{ title: string; text: string }> {
  const weave = include.length
    ? `Naturally use these words (any grammatical form), each at least once: ${include.join(', ')}. `
    : '';
  return generate<{ title: string; text: string }>(
    `Write an original German text for a learner at CEFR level ${level}. Topic: ${topic || 'everyday life'}. ` +
      `About ${words} words, 2-4 paragraphs separated by blank lines, natural and interesting (a short story or a lively description). ` +
      `Use vocabulary and grammar appropriate for ${level}. ${weave}Answer in JSON.`,
    {
      type: 'OBJECT',
      properties: { title: S('Short German title'), text: S('The German text, paragraphs separated by \n\n') },
      required: ['title', 'text'],
    },
    { temperature: 0.8 },
  );
}

// --- Critic: a second, stricter pass over generated texts ---

const CRITIC_TIMEOUT_MS = 25000;
const BAD_KEY = 'criticBadModels';
const BAD_TTL = 7 * 24 * 3600 * 1000;

// Models that timed out or hit their quota are skipped for a week (per device)
function badModels(): Record<string, number> {
  try {
    const all = JSON.parse(localStorage.getItem(BAD_KEY) ?? '{}') as Record<string, number>;
    return Object.fromEntries(Object.entries(all).filter(([, t]) => Date.now() - t < BAD_TTL));
  } catch {
    return {};
  }
}

function markBad(model: string) {
  try {
    localStorage.setItem(BAD_KEY, JSON.stringify({ ...badModels(), [model]: Date.now() }));
  } catch {
    // storage unavailable: the model is simply retried next time
  }
}

let criticOk: string | null = null;

/** Critic candidates: the last model that worked, then newest stable non-lite Flash models, then the writer's model. */
async function criticCandidates(): Promise<string[]> {
  const key = getData().settings.geminiKey;
  const writer = await ensureModel(key);
  const bad = badModels();
  const flash = (await listModels(key))
    .filter((m) => !/preview|exp|latest/.test(m.name) && /gemini-\d/.test(m.name) && m.name.includes('flash') && !m.name.includes('lite'))
    .sort((a, b) => versionOf(b.name) - versionOf(a.name))
    .map((m) => m.name)
    .filter((m) => !bad[m]);
  return [...new Set([...(criticOk ? [criticOk] : []), ...flash.slice(0, 3), writer])];
}

export interface Review {
  title: string;
  text: string;
  changes: { before: string; after: string; reason: string }[];
  levelNote: string;
}

const reviewSchema = {
  type: 'OBJECT',
  properties: {
    title: S('Corrected German title'),
    text: S('The full corrected German text, paragraphs separated by \n\n'),
    changes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { before: S('Original fragment'), after: S('Corrected fragment'), reason: S('Short reason in Russian') },
        required: ['before', 'after', 'reason'],
      },
    },
    levelNote: S('One sentence in Russian: does the final text match the level'),
  },
  required: ['title', 'text', 'changes', 'levelNote'],
};

export async function reviewText(level: string, words: string[], title: string, text: string): Promise<Review> {
  const prompt =
    `You are a strict German editor and CEFR examiner. A text for a learner at level ${level} must be checked and corrected.
` +
    `Fix: grammar, spelling, capitalization (only nouns and sentence starts are capitalized), punctuation, unnatural or non-idiomatic phrasing, ` +
    `logic and coherence. Replace words and structures that are above ${level} with simpler ones; keep the text interesting. ` +
    (words.length ? `These words must appear (any form); add them naturally if missing: ${words.join(', ')}. ` : '') +
    `Keep the length and paragraph structure. Do not translate. If the text is already perfect, return it unchanged with an empty changes list. ` +
    `List every change.

Title: ${title}

${text}`;
  let last: unknown;
  for (const model of await criticCandidates()) {
    try {
      const review = await generate<Review>(prompt, reviewSchema, { model, temperature: 0.1, timeoutMs: CRITIC_TIMEOUT_MS });
      criticOk = model;
      return review;
    } catch (e) {
      last = e;
      // Slow, retired or out-of-quota model: remember it and try the next one
      const status = e instanceof GeminiError ? e.status : 0;
      if (![408, 404, 429, 500, 503].includes(status)) throw e;
      markBad(model);
      if (criticOk === model) criticOk = null;
    }
  }
  throw last;
}
