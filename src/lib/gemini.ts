import { get, set } from 'idb-keyval';
import { getData, updateSettings, type ChunkExample } from './store';
import { cleanExample, topicReference, topicTags, type GrammarItem, type GrammarTopic } from './grammar';

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
  video?: string; // public YouTube URL sent along with the prompt
  clip?: { start: number; end: number }; // only this part of the video, seconds
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
      contents: [
        {
          role: 'user',
          parts: [
            ...(opts.video
              ? [
                  {
                    fileData: { fileUri: opts.video },
                    ...(opts.clip ? { videoMetadata: { startOffset: `${Math.floor(opts.clip.start)}s`, endOffset: `${Math.ceil(opts.clip.end)}s` } } : {}),
                  },
                ]
              : []),
            ...(opts.images ?? []).map((inlineData) => ({ inlineData })),
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        // Speech is what matters in a video; low resolution frames cost ~3x fewer tokens
        ...(opts.video ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}),
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
  const reason = j.promptFeedback?.blockReason ?? j.candidates?.[0]?.finishReason;
  // An empty answer with a block reason (e.g. RECITATION for copyrighted speech) — say why instead of "unclear answer"
  if (!text && reason && reason !== 'STOP') throw new GeminiError(`Gemini отказался отвечать (${reason})`, 451);
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

const TITLES_PER_REQUEST = 12; // long lists made small models skip or merge lines

/**
 * Russian versions of headlines, in small numbered batches. Each translation comes back with its
 * headline number, so a skipped or merged line costs only that line instead of the whole list.
 */
export async function translateTitles(titles: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = titles.filter((t) => {
    const hit = cache[`t|${t}`];
    if (hit) out[t] = hit as string;
    return !hit;
  });
  for (let k = 0; k < missing.length; k += TITLES_PER_REQUEST) {
    const batch = missing.slice(k, k + TITLES_PER_REQUEST);
    const r = await generate<{ items: { n: number; ru: string }[] }>(
      `Translate these German news headlines into short natural Russian. For each one return its number and the translation.\n` +
        batch.map((t, i) => `${i + 1}. ${t}`).join('\n'),
      {
        type: 'OBJECT',
        properties: {
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { n: { type: 'INTEGER', description: 'Headline number from the list' }, ru: S('Russian translation of that headline') },
              required: ['n', 'ru'],
            },
          },
        },
        required: ['items'],
      },
      { maxTokens: 2000 },
    );
    for (const { n, ru } of r.items ?? []) {
      const t = batch[n - 1];
      if (!t || !ru?.trim() || out[t]) continue;
      out[t] = ru.trim();
      remember(`t|${t}`, out[t]);
    }
  }
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
  issues: { wrong: string; right: string; explanation: string; topic?: string }[];
  comment: string;
}

const TOPIC_FIELD = () => S(`Grammar topic of this mistake, exactly one of these ids: ${topicTags()}. Empty string if none fits (spelling, wrong word)`);

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
            properties: { wrong: S('Wrong fragment as written'), right: S('Correct fragment'), explanation: S('Short rule in Russian'), topic: TOPIC_FIELD() },
            required: ['wrong', 'right', 'explanation', 'topic'],
          },
        },
        comment: S('One short encouraging remark in Russian'),
      },
      required: ['ok', 'usesWord', 'corrected', 'issues', 'comment'],
    },
  );
}

export async function generateText(level: string, topic: string, words: number, include: string[], grammar?: GrammarTopic): Promise<{ title: string; text: string }> {
  const weave = include.length
    ? `Naturally use these words (any grammatical form), each at least once: ${include.join(', ')}. `
    : '';
  const practise = grammar ? `Use this grammar often, correctly and in natural sentences:\n${topicReference(grammar)}\n` : '';
  return generate<{ title: string; text: string }>(
    `Write an original German text for a learner at CEFR level ${level}. Topic: ${topic || 'everyday life'}. ` +
      `About ${words} words, 2-4 paragraphs separated by blank lines, natural and interesting (a short story or a lively description). ` +
      `Use vocabulary and grammar appropriate for ${level}. ${weave}${practise}Answer in JSON.`,
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
async function strictGenerate<T>(prompt: string, schema: object, maxTokens?: number, timeoutMs = CRITIC_TIMEOUT_MS): Promise<T> {
  let last: unknown;
  for (const model of await criticCandidates()) {
    try {
      const r = await generate<T>(prompt, schema, { model, temperature: 0.1, timeoutMs, ...(maxTokens ? { maxTokens } : {}) });
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

export async function reviewText(level: string, words: string[], title: string, text: string, grammar?: GrammarTopic): Promise<Review> {
  const prompt =
    `You are a strict German editor and CEFR examiner. A text for a learner at level ${level} must be checked and corrected.
` +
    `Fix: grammar, spelling, capitalization (only nouns and sentence starts are capitalized), punctuation, unnatural or non-idiomatic phrasing, ` +
    `logic and coherence. Replace words and structures that are above ${level} with simpler ones; keep the text interesting. ` +
    (words.length ? `These words must appear (any form); add them naturally if missing: ${words.join(', ')}. ` : '') +
    (grammar ? `The text practises this grammar, keep these structures and make sure they are correct:\n${topicReference(grammar)}\n` : '') +
    `Keep the length and paragraph structure. Do not translate. If the text is already perfect, return it unchanged with an empty changes list. ` +
    `List every change.

Title: ${title}

${text}`;
  return strictGenerate<Review>(prompt, reviewSchema);
}

// --- Voice dialog: hints during the call and one strict review of the transcript after it ---

export interface ChatLine {
  role: 'ai' | 'me';
  de: string;
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

export interface DialogWord {
  lemma: string;
  article: string;
  plural: string;
  pos: string;
  translation: string;
  meanings: string;
  example: string;
}

export interface DialogFix {
  said: string;
  phrase: string;
  translation: string;
  explanation: string;
  topic?: string; // grammar topic id, '' when none fits
}

export interface DialogReview {
  words: DialogWord[];
  fixes: DialogFix[];
}

const REVIEW_TIMEOUT_MS = 60000;
const REVIEW_MAX_TOKENS = 8000;

/** Reads a finished voice dialog once: words the learner lacked and the real mistakes they made. */
export async function reviewDialog(level: string, history: ChatLine[]): Promise<DialogReview> {
  const transcript = history.map((l) => `${l.role === 'ai' ? 'Partner' : 'Learner'}: ${l.de}`).join('\n');
  const r = await strictGenerate<Partial<DialogReview>>(
    `You are a careful German teacher. A Russian speaker (CEFR ${level}) just had a voice conversation in German. ` +
      `Both sides were written down by speech recognition, so ignore capitalization and punctuation. ` +
      `Russian speech may appear in Cyrillic, in Latin letters or distorted.\n\nTranscript:\n${transcript}\n\n` +
      `Find two things.\n` +
      `1. words: German words the learner did not know. Include one ONLY if the learner said it in Russian instead of German, ` +
      `or asked how to say something in German, or asked what a German word means. Use the German word the partner gave; ` +
      `if the partner did not give one, use the natural German equivalent. Do not include words the learner used on their own, and do not invent anything. ` +
      `Give the dictionary form; for a fixed expression use pos "фраза". Example = one short German sentence with the word, from the conversation if possible.\n` +
      `2. fixes: real mistakes in the learner's German: grammar, word order, cases, articles, verb forms, wrong word. ` +
      `Do not count a word that is most likely a recognition slip (a similar-sounding word that makes no sense here), and do not rewrite correct German to make it more elegant. ` +
      `Merge repeats of the same mistake into one item. Answer in JSON.`,
    {
      type: 'OBJECT',
      properties: {
        words: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              lemma: S('Dictionary form without article. Nouns capitalized.'),
              article: S('der, die or das for nouns; empty string otherwise'),
              plural: S('Plural form with article for nouns; empty string otherwise'),
              pos: S('Part of speech in Russian, short (сущ., глагол, прил., нареч., фраза)'),
              translation: S('Russian translation as meant in the conversation'),
              meanings: S('Main Russian meanings, comma-separated, max 3'),
              example: S('One short German sentence with this word'),
            },
            required: ['lemma', 'article', 'plural', 'pos', 'translation', 'meanings', 'example'],
          },
        },
        fixes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              said: S('The wrong fragment as the learner said it'),
              phrase: S('The shortest natural correct German phrase with the fix, 2-8 words'),
              translation: S('Russian translation of the phrase'),
              explanation: S('Short rule in Russian, e.g. "после mit — дательный падеж"'),
              topic: TOPIC_FIELD(),
            },
            required: ['said', 'phrase', 'translation', 'explanation', 'topic'],
          },
        },
      },
      required: ['words', 'fixes'],
    },
    REVIEW_MAX_TOKENS,
    REVIEW_TIMEOUT_MS,
  );
  return { words: r.words ?? [], fixes: r.fixes ?? [] };
}

// --- Grammar: lessons written by the model and checked against the hand-written reference ---

export type GrammarStage = 'writing' | 'checking';

export interface GrammarDraft {
  intro: string;
  ruNote: string;
  cards: { item: string; examples: ChunkExample[] }[];
}

const LESSON_TIMEOUT_MS = 60000;
const LESSON_MAX_TOKENS = 12000;
const MIN_ITEM_SHARE = 0.5; // a lesson where most items came back empty is not worth saving

const grammarSchema = {
  type: 'OBJECT',
  properties: {
    intro: S('The rule in simple Russian, 2-3 short sentences'),
    ruNote: S('One short Russian sentence comparing this with Russian, where that helps; empty string otherwise'),
    cards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item: S('The item key, copied exactly'),
          examples: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                de: S('Short natural German sentence, at most 12 words'),
                ru: S('Natural Russian translation'),
                gap: S('The word that tests this grammar point, copied verbatim from "de", a single whole word or form'),
                wrong: { type: 'ARRAY', items: S('A filler that is definitely wrong in this sentence'), description: 'Exactly 3 items' },
                alt: { type: 'ARRAY', items: S('The same words in another correct order'), description: 'Other correct word orders of exactly the same words; often empty' },
              },
              required: ['de', 'ru', 'gap', 'wrong', 'alt'],
            },
          },
        },
        required: ['item', 'examples'],
      },
    },
  },
  required: ['intro', 'ruNote', 'cards'],
};

/** Writer drafts the lesson, the critic checks it against the reference. Nothing unchecked is ever returned. */
export async function makeGrammarLesson(t: GrammarTopic, onStage?: (s: GrammarStage) => void): Promise<GrammarDraft> {
  const reference = topicReference(t);
  onStage?.('writing');
  const draft = await generate<GrammarDraft>(
    `You teach German grammar to a Russian speaker (A2-B1). Topic: ${t.title}.\n\nReference, which is correct and must be followed:\n${reference}\n\n` +
      `Write the lesson in Russian, then for EVERY item give 3 varied everyday example sentences that clearly practise that item. ` +
      `"gap" hides the word that tests the point. Each "wrong" filler must be definitely incorrect in that sentence (wrong word order, wrong form or wrong meaning), never a second correct answer. Answer in JSON.`,
    grammarSchema,
    { temperature: 0.6, timeoutMs: LESSON_TIMEOUT_MS, maxTokens: LESSON_MAX_TOKENS },
  );
  onStage?.('checking');
  const r = await strictGenerate<GrammarDraft>(
    `You are a strict German grammar examiner. Below is a lesson for a Russian speaker and the reference it must agree with.\n\nReference:\n${reference}\n\n` +
      `Lesson as JSON:\n${JSON.stringify(draft)}\n\n` +
      `Check every statement against the reference and every sentence for correctness and naturalness. Correct whatever is wrong. ` +
      `For each example make sure "gap" is copied verbatim from "de", that no "wrong" filler could also be correct there, and that "alt" lists only truly correct orders. ` +
      `Remove any example you cannot make correct. Return the corrected lesson in the same JSON format.`,
    grammarSchema,
    LESSON_MAX_TOKENS,
    LESSON_TIMEOUT_MS,
  );
  const usable = t.items.filter((i) => r.cards?.find((c) => c.item === i.key)?.examples?.some((e) => cleanExample(e))).length;
  if (!r.intro?.trim() || usable < t.items.length * MIN_ITEM_SHARE) throw new GeminiError('Не получилось проверить урок — попробуй ещё раз');
  return { intro: r.intro.trim(), ruNote: (r.ruNote ?? '').trim(), cards: r.cards };
}

export interface GrammarCheck {
  ok: boolean; // no mistakes at all
  usesTarget: boolean; // the sentence uses the grammar point
  ruleOk: boolean; // the grammar point itself is right
  corrected: string;
  issues: { wrong: string; right: string; explanation: string; topic?: string }[];
  comment: string;
}

/** Strict check of a sentence the learner wrote to practise one grammar point. */
export async function checkGrammarSentence(t: GrammarTopic, item: GrammarItem, sentence: string): Promise<GrammarCheck> {
  return strictGenerate<GrammarCheck>(
    `A Russian speaker wrote a German sentence to practise "${item.label}" (${item.ru}) from the topic ${t.title}.\n` +
      `Sentence: "${sentence}"\n\nReference, which is correct:\n${topicReference(t)}\nThe point being practised: ${item.rule}\n\n` +
      `Check grammar, spelling and word usage; ignore missing final punctuation. Explanations are short, in Russian, and name the rule. Answer in JSON.`,
    {
      type: 'OBJECT',
      properties: {
        ok: { type: 'BOOLEAN', description: 'true if the sentence has no mistakes' },
        usesTarget: { type: 'BOOLEAN', description: 'true if the sentence actually uses the point being practised' },
        ruleOk: { type: 'BOOLEAN', description: 'true if the point being practised is applied correctly' },
        corrected: S('The corrected sentence; same as the input if ok'),
        issues: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { wrong: S('Wrong fragment as written'), right: S('Correct fragment'), explanation: S('Short rule in Russian'), topic: TOPIC_FIELD() },
            required: ['wrong', 'right', 'explanation', 'topic'],
          },
        },
        comment: S('One short encouraging remark in Russian'),
      },
      required: ['ok', 'usesTarget', 'ruleOk', 'corrected', 'issues', 'comment'],
    },
  );
}

/** Explains the structure of one sentence from a text, around the grammar point the learner tapped. */
export async function explainSentence(t: GrammarTopic, item: GrammarItem, sentence: string): Promise<string> {
  const key = `gx|${item.key}|${sentence}`;
  if (cache[key]) return cache[key] as string;
  const r = await generate<{ explanation: string }>(
    `Explain to a Russian speaker (A2-B1) how this German sentence is built, focusing on "${item.label}":\n"${sentence}"\n\n` +
      `Reference, which is correct:\n${topicReference(t)}\n\nIn Russian, 2-4 short sentences, naming where the verb stands and why. Answer in JSON.`,
    { type: 'OBJECT', properties: { explanation: S('The explanation in Russian') }, required: ['explanation'] },
  );
  remember(key, r.explanation);
  return r.explanation;
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

// --- Video: timed German transcript of a YouTube video ---

const VIDEO_TIMEOUT_MS = 180000;
const CLIP_TIMEOUT_MS = 90000;

export interface VideoLine {
  t: number; // start, seconds
  de: string;
}

const toSeconds = (ts: string) =>
  ts
    .trim()
    .split(':')
    .map(Number)
    .reduce((acc, n) => acc * 60 + (Number.isFinite(n) ? n : 0), 0);

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Subtitles for a whole video, or for one clip of it (times in the returned lines are always from the video start). */
export async function transcribeVideo(url: string, clip?: { start: number; end: number }): Promise<{ title: string; lines: VideoLine[] }> {
  const prompt =
    (clip ? `This is the part of the video from ${mmss(clip.start)} to ${mmss(clip.end)}. ` : '') +
    `Transcribe the German speech ${clip ? 'in this part' : 'in this video'} as subtitles. Write exactly what is said, in German, with correct spelling, ` +
    `umlauts, ß, capitalization and punctuation; do not translate, summarize or skip parts. ` +
    `Split it into subtitle lines of one short sentence or clause each (max ~12 words), in order, covering ${clip ? 'the whole part' : 'the whole video'}. ` +
    `For each line give the time it starts being spoken as MM:SS (or H:MM:SS for long videos)${clip ? ', counted from the start of the full video' : ''}. ` +
    `Ignore music and sounds. If nobody speaks German${clip ? ' in this part' : ''}, set ok to false and return no lines. Answer in JSON.`;
  const schema = {
    type: 'OBJECT',
    properties: {
      ok: { type: 'BOOLEAN', description: 'false if there is no German speech' },
      title: S('Short German title of the video (max 6 words)'),
      lines: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { start: S('Start time, MM:SS or H:MM:SS'), de: S('The German subtitle line') },
          required: ['start', 'de'],
        },
      },
    },
    required: ['ok', 'title', 'lines'],
  };
  type Raw = { ok: boolean; title: string; lines: { start: string; de: string }[] };
  let last: unknown;
  for (const model of await criticCandidates()) {
    try {
      const r = await generate<Raw>(prompt, schema, {
        model,
        video: url,
        clip,
        temperature: 0,
        timeoutMs: clip ? CLIP_TIMEOUT_MS : VIDEO_TIMEOUT_MS,
      });
      criticOk = model;
      // A quiet clip (intro music, pause) is fine; a whole video without speech is not
      if (!clip && (!r.ok || !r.lines?.length)) throw new GeminiError('Не нашёл немецкой речи в этом видео');
      let lines = (r.lines ?? []).map((l) => ({ t: toSeconds(l.start), de: l.de.trim() })).filter((l) => l.de);
      // Models count clip times either from the video start (as asked) or from the clip start: tell them apart
      if (clip && clip.start > 0 && lines.length) {
        const sorted = lines.map((l) => l.t).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (median < clip.start - 5) lines = lines.map((l) => ({ ...l, t: l.t + clip.start }));
      }
      return { title: r.title, lines: lines.sort((a, b) => a.t - b.t) };
    } catch (e) {
      last = e;
      const status = e instanceof GeminiError ? e.status : 0;
      if (![408, 404, 500, 503].includes(status)) throw e;
    }
  }
  throw last;
}
