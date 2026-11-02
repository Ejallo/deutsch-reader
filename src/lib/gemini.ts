import { get, set } from 'idb-keyval';
import { getData, updateSettings } from './store';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {}

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

const versionOf = (name: string) => parseFloat(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');

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

async function generate<T>(prompt: string, schema: object): Promise<T> {
  const key = getData().settings.geminiKey;
  if (!key) throw new GeminiError('Добавь ключ Gemini в настройках');
  if (!navigator.onLine) throw new GeminiError('Нет интернета');
  const model = await ensureModel(key);
  const r = await fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
    }),
  });
  if (r.status === 429) throw new GeminiError('Лимит бесплатных запросов Gemini исчерпан — попробуй позже');
  if (r.status === 400 || r.status === 403) {
    const msg = (await r.json().catch(() => null))?.error?.message ?? '';
    throw new GeminiError(/API key/i.test(msg) ? 'Ключ Gemini не подходит' : `Gemini: ${msg || r.status}`);
  }
  if (r.status === 404) {
    // Model was retired: forget it so the next call picks a fresh one
    updateSettings({ geminiModel: '' });
    throw new GeminiError('Модель Gemini недоступна — повтори, выберу другую');
  }
  if (!r.ok) throw new GeminiError(`Gemini: ошибка ${r.status}`);
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
