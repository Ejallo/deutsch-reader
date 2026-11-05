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
  maxTokens?: number; // cuts off a model that starts repeating itself
  images?: { mimeType: string; data: string }[]; // base64 images sent along with the prompt
}

const DEFAULT_TIMEOUT_MS = 20000;
const FALLBACK_TIMEOUT_MS = 15000;
const MAX_FALLBACKS = 2;

// Statuses where another model may well succeed: hung, retired, out of quota, overloaded
const TRANSIENT = [408, 404, 429, 500, 503];
const isTransient = (e: unknown) => e instanceof GeminiError && TRANSIENT.includes(e.status);

/** Other stable models to try when the default one fails: Flash-Lite first (cheapest quota), newest first. */
async function fallbackModels(key: string, current: string): Promise<string[]> {
  const bad = badModels();
  const byVersion = (a: ModelInfo, b: ModelInfo) => versionOf(b.name) - versionOf(a.name);
  const stable = (await listModels(key)).filter((m) => !/preview|exp|latest/.test(m.name) && /gemini-\d/.test(m.name) && m.name.includes('flash'));
  const lite = stable.filter((m) => m.name.includes('lite')).sort(byVersion);
  const flash = stable.filter((m) => !m.name.includes('lite')).sort(byVersion);
  return [...lite, ...flash]
    .map((m) => m.name)
    .filter((m) => m !== current && !bad[m])
    .slice(0, MAX_FALLBACKS);
}

/** Calls the user's model; if it hangs or fails transiently, tries other models and keeps the one that works. */
async function generate<T>(prompt: string, schema: object, opts: GenOptions = {}): Promise<T> {
  const key = getData().settings.geminiKey;
  if (!key) throw new GeminiError('Добавь ключ Gemini в настройках');
  if (!navigator.onLine) throw new GeminiError('Нет интернета');
  if (opts.model) return callModel<T>(key, opts.model, prompt, schema, opts);
  const first = await ensureModel(key);
  try {
    return await callModel<T>(key, first, prompt, schema, opts);
  } catch (e) {
    if (!isTransient(e)) throw e;
    markBad(first);
    let others: string[] = [];
    try {
      others = await fallbackModels(key, first);
    } catch {
      throw e;
    }
    for (const model of others) {
      try {
        const r = await callModel<T>(key, model, prompt, schema, { ...opts, timeoutMs: opts.timeoutMs ?? FALLBACK_TIMEOUT_MS });
        updateSettings({ geminiModel: model });
        return r;
      } catch (e2) {
        if (!isTransient(e2)) throw e2;
        markBad(model);
      }
    }
    throw e;
  }
}

async function callModel<T>(key: string, model: string, prompt: string, schema: object, opts: GenOptions): Promise<T> {
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
      contents: [{ role: 'user', parts: [...(opts.images ?? []).map((inlineData) => ({ inlineData })), { text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: opts.temperature ?? 0.2,
        ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      },
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
  if (r.status === 404) throw new GeminiError('Модель Gemini недоступна', 404);
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

export interface ChunkInfo {
  text: string;
  translation: string;
  note: string;
  examples: { de: string; ru: string; gap: string; wrong: string[] }[];
}

const exampleSchema = {
  type: 'OBJECT',
  properties: {
    de: S('German sentence containing the chunk'),
    ru: S('Natural Russian translation of the sentence'),
    gap: S('The key word of the chunk exactly as it is spelled in this sentence (inflected form), copied verbatim from "de"'),
    wrong: { type: 'ARRAY', items: S('A plausible but wrong word for the gap, same grammatical form'), description: 'Exactly 3 distinct wrong fillers' },
  },
  required: ['de', 'ru', 'gap', 'wrong'],
};

/**
 * Turns a tapped word or selected phrase into a lexical chunk with practice sentences.
 * `avoid` is the previous result when the learner asks for another variant.
 */
export async function makeChunk(hint: string, sentence: string, avoid?: ChunkInfo): Promise<ChunkInfo> {
  const key = `c|${hint}|${sentence}`;
  if (!avoid && cache[key]) return cache[key] as ChunkInfo;
  // Without a sentence the learner typed the chunk by hand: normalize it and invent all examples
  const source = sentence
    ? `Sentence: "${sentence}"\nThe learner selected: "${hint}"\n\n` +
      `1. Find the natural chunk of 2-5 words in the sentence that contains the selection (e.g. "einen Termin vereinbaren", "Muskelkater haben", "Ist das Gerät frei?"). `
    : `The learner wants to learn this chunk: "${hint}" (it may contain mistakes or be in Russian - then use the natural German chunk).\n\n` +
      `1. Correct the chunk if needed. `;
  const examplesRule = sentence
    ? `3. Examples: first the original sentence (shorten it to the clause with the chunk if it is longer than 14 words), then 2 new short everyday sentences (A2-B1) using the chunk in different forms. `
    : `3. Examples: 3 short everyday sentences (A2-B1) using the chunk in different forms. `;
  const r = await generate<ChunkInfo>(
    `You help a Russian speaker learn German with the lexical approach: learning ready-made chunks (collocations, fixed phrases) instead of single words.\n` +
      source +
      `Give it in dictionary form: verb as infinitive at the end, separable verbs joined, keep the article with nouns. A short fixed question or expression stays as it is.\n` +
      `2. The key word is the part of the chunk a learner is most likely to get wrong: usually the verb or preposition that goes with the noun, not the selected noun itself.\n` +
      examplesRule +
      `For each example give "gap" = the key word exactly as spelled there and 3 wrong fillers that do not fit this chunk.\n` +
      // Variety comes from the prompt, not a high temperature: hot JSON output tends to loop on small models
      (avoid ? `The learner did not like this variant, give another one with different new example sentences: ${JSON.stringify({ text: avoid.text, examples: avoid.examples.map((e) => e.de) })}\n` : '') +
      `Answer in JSON.`,
    {
      type: 'OBJECT',
      properties: {
        text: S('The chunk in dictionary form'),
        translation: S('Natural Russian translation of the chunk'),
        note: S('One short Russian hint (case, preposition, register) if useful; empty string otherwise'),
        examples: { type: 'ARRAY', items: exampleSchema, description: '3 examples, the original sentence first' },
      },
      required: ['text', 'translation', 'note', 'examples'],
    },
    { temperature: avoid ? 0.5 : 0.4, timeoutMs: 25000, maxTokens: 2000 },
  );
  // Keep only examples whose gap really occurs in the sentence: cloze cards depend on it
  const examples = (r.examples ?? [])
    .map((e) => ({ ...e, gap: e.gap.trim(), wrong: [...new Set((e.wrong ?? []).map((w) => w.trim()))].filter((w) => w && w.toLowerCase() !== e.gap.trim().toLowerCase()).slice(0, 3) }))
    .filter((e) => e.gap && e.de.includes(e.gap) && e.wrong.length === 3);
  if (!r.text?.trim() || !examples.length) throw new GeminiError('Не получилось собрать чанк — попробуй ещё раз или выдели фразу целиком');
  const info = { ...r, text: r.text.trim(), examples };
  remember(key, info);
  return info;
}

/** Russian versions of headlines, one request for all that aren't cached yet. */
export async function translateTitles(titles: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = titles.filter((t) => {
    const hit = cache[`t|${t}`];
    if (hit) out[t] = hit as string;
    return !hit;
  });
  if (!missing.length) return out;
  const r = await generate<{ translations: string[] }>(
    `Translate these German news headlines into short natural Russian, in the same order, one translation per headline:\n` +
      missing.map((t, i) => `${i + 1}. ${t}`).join('\n'),
    {
      type: 'OBJECT',
      properties: { translations: { type: 'ARRAY', items: S('Russian translation of one headline'), description: `Exactly ${missing.length} items` } },
      required: ['translations'],
    },
  );
  // A count mismatch would pair headlines with the wrong translations
  if (r.translations?.length !== missing.length) return out;
  missing.forEach((t, i) => {
    out[t] = r.translations[i];
    remember(`t|${t}`, r.translations[i]);
  });
  return out;
}

export async function translateParagraph(text: string): Promise<string> {
  const key = `para|${text}`;
  if (cache[key]) return cache[key] as string;
  const r = await generate<{ translation: string }>(
    `Translate this German text into natural Russian. Keep paragraph breaks.\n\n${text}`,
    { type: 'OBJECT', properties: { translation: S('Russian translation') }, required: ['translation'] },
    { timeoutMs: 30000 }, // long paragraphs take a while
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
    { temperature: 0.8, timeoutMs: 45000 }, // a whole text: slower than a word lookup
  );
}

// --- Critic: a second, stricter pass over generated texts ---

const CRITIC_TIMEOUT_MS = 25000;
const BAD_KEY = 'criticBadModels';
const BAD_TTL = 7 * 24 * 3600 * 1000;

// Models that timed out or hit their quota are skipped for a week (per device), by the critic and by fallbacks
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

/** Runs a strict task (editing, correcting) on the strongest Flash that answers, skipping slow or out-of-quota ones. */
async function strictGenerate<T>(prompt: string, schema: object, maxTokens?: number): Promise<T> {
  let last: unknown;
  for (const model of await criticCandidates()) {
    try {
      const r = await generate<T>(prompt, schema, { model, temperature: 0.1, timeoutMs: CRITIC_TIMEOUT_MS, ...(maxTokens ? { maxTokens } : {}) });
      criticOk = model;
      return r;
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
  return strictGenerate<Review>(prompt, reviewSchema);
}

// --- Role-play conversation: a fast partner (default Flash-Lite) and a strict corrector (stronger Flash) ---

export interface ChatLine {
  role: 'ai' | 'me';
  de: string;
}

export interface ChatReply {
  reply: string;
  translation: string;
  hints: string[];
}

/** The partner's next line in the scene; with an empty history it opens the conversation. */
export async function chatReply(scene: string, level: string, words: string[], history: ChatLine[]): Promise<ChatReply> {
  const transcript = history.map((l) => `${l.role === 'ai' ? 'You' : 'Learner'}: ${l.de}`).join('\n');
  return generate<ChatReply>(
    `You are role-playing with a Russian speaker learning German. Scene: ${scene}\n` +
      `Stay in your role and speak only German at CEFR level ${level}: short natural replies of 1-3 sentences, ask a question to keep the conversation going. ` +
      `Do not correct the learner - a separate teacher does that; just react naturally, as a patient native speaker would. ` +
      (words.length ? `When it fits naturally, use some of these words the learner is studying (any form): ${words.join(', ')}. ` : '') +
      (transcript ? `\nConversation so far:\n${transcript}\n\nWrite your next line.` : `\nOpen the conversation with your first line.`) +
      ` Answer in JSON.`,
    {
      type: 'OBJECT',
      properties: {
        reply: S('Your next line in German'),
        translation: S('Natural Russian translation of your line'),
        hints: { type: 'ARRAY', items: S('A short possible answer the learner could give, in German at their level'), description: 'Exactly 2 different possible answers' },
      },
      required: ['reply', 'translation', 'hints'],
    },
    { temperature: 0.7, timeoutMs: 20000, maxTokens: 800 },
  );
}

/** Two short things the learner could say next, for when they are stuck mid-conversation. */
export async function chatHints(scene: string, level: string, history: ChatLine[]): Promise<string[]> {
  const transcript = history.map((l) => `${l.role === 'ai' ? 'Partner' : 'Learner'}: ${l.de}`).join('\n');
  const r = await generate<{ hints: string[] }>(
    `A Russian speaker (CEFR ${level}) is in a German role-play. Scene: ${scene}\nConversation:\n${transcript}\n\n` +
      `Suggest 2 different short answers the learner could say next, in simple German at their level. Answer in JSON.`,
    {
      type: 'OBJECT',
      properties: { hints: { type: 'ARRAY', items: S('A short possible answer in German'), description: 'Exactly 2 items' } },
      required: ['hints'],
    },
    { temperature: 0.6, timeoutMs: 15000, maxTokens: 400 },
  );
  return (r.hints ?? []).slice(0, 2);
}

export interface ChatCheck {
  ok: boolean;
  corrected: string;
  issues: { wrong: string; right: string; explanation: string }[];
}

/** Checks one learner line in the context of the partner's last line; strict, so it runs on the stronger model. */
export async function chatCheck(partnerLine: string, line: string, level: string, spoken = false): Promise<ChatCheck> {
  return strictGenerate<ChatCheck>(
    `You are a careful German teacher. A Russian speaker (CEFR ${level}) is in a role-play conversation.\n` +
      `Partner said: "${partnerLine}"\nLearner answered: "${line}"\n\n` +
      `Check the learner's answer: grammar, word order, cases, articles, verb forms, spelling with umlauts, noun capitalization, and whether the words fit. ` +
      (spoken
        ? `The answer was SPOKEN and written down by speech recognition: ignore all capitalization and punctuation, and do not count a word that is ` +
          `most likely a recognition slip (a similar-sounding word that makes no sense here) - judge only real grammar and vocabulary mistakes. `
        : `Ignore missing final punctuation and a lowercase first letter. `) +
      `Do not rewrite a correct answer just to make it more elegant - only real mistakes count. ` +
      `If it is correct, ok = true, corrected = the answer unchanged, issues = []. ` +
      `Otherwise give the minimally corrected answer and each mistake with a short Russian explanation that names the rule (e.g. "после mit — дательный падеж"). Answer in JSON.`,
    {
      type: 'OBJECT',
      properties: {
        ok: { type: 'BOOLEAN', description: 'true if the answer has no real mistakes' },
        corrected: S('The minimally corrected answer; unchanged if ok'),
        issues: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { wrong: S('Wrong fragment as written'), right: S('Correct fragment'), explanation: S('Short rule in Russian') },
            required: ['wrong', 'right', 'explanation'],
          },
        },
      },
      required: ['ok', 'corrected', 'issues'],
    },
    1500,
  );
}

// --- Scan: German text from photos of pages ---

const SCAN_TIMEOUT_MS = 60000;

export async function scanText(images: { mimeType: string; data: string }[]): Promise<{ title: string; text: string; ok: boolean }> {
  const prompt =
    `These are ${images.length > 1 ? `${images.length} photos of consecutive pages` : 'a photo of a page'} with German text. ` +
    `Transcribe the main German text exactly as printed, character by character: keep the original spelling, umlauts, ß and punctuation, do not correct, ` +
    `translate, summarize or invent anything. Join words hyphenated across line breaks, join lines into normal paragraphs, separate paragraphs with a blank line. ` +
    `Skip page numbers, running headers/footers, captions and marginal notes. If a word is unreadable, write [?]. ` +
    `If several pages are given, continue the text in page order. Answer in JSON.`;
  const schema = {
    type: 'OBJECT',
    properties: {
      ok: { type: 'BOOLEAN', description: 'false if the photos contain no readable German text' },
      title: S('The heading of the text if there is one, otherwise a short German title (max 5 words) based on the content'),
      text: S('The transcribed German text, paragraphs separated by \n\n'),
    },
    required: ['ok', 'title', 'text'],
  };
  let last: unknown;
  // Non-lite Flash reads photos noticeably better; same candidates and fallbacks as the critic
  for (const model of await criticCandidates()) {
    try {
      const r = await generate<{ title: string; text: string; ok: boolean }>(prompt, schema, { model, images, temperature: 0, timeoutMs: SCAN_TIMEOUT_MS });
      criticOk = model;
      return r;
    } catch (e) {
      last = e;
      const status = e instanceof GeminiError ? e.status : 0;
      if (![408, 404, 429, 500, 503].includes(status)) throw e;
      markBad(model);
      if (criticOk === model) criticOk = null;
    }
  }
  throw last;
}
