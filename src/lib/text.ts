export interface Token {
  text: string;
  start: number;
  end: number;
  word: boolean;
  form: string; // lowercase key for words, '' otherwise
}

export interface Paragraph {
  text: string;
  tokens: Token[];
  sentences: [number, number][];
}

const TOKEN_RE = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu;
const SENTENCE_RE = /[^.!?…]+(?:[.!?…]+["»“”)]*\s*|$)/g;

export const formKey = (word: string) => word.toLowerCase();

export function parseText(content: string): Paragraph[] {
  return content
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => {
      const tokens: Token[] = [];
      for (const m of text.matchAll(TOKEN_RE)) {
        const word = /\p{L}/u.test(m[0]);
        tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length, word, form: word ? formKey(m[0]) : '' });
      }
      const sentences: [number, number][] = [];
      for (const m of text.matchAll(SENTENCE_RE)) if (m[0]) sentences.push([m.index, m.index + m[0].length]);
      return { text, tokens, sentences };
    });
}

export function sentenceAt(p: Paragraph, pos: number): string {
  const s = p.sentences.find(([a, b]) => pos >= a && pos < b);
  return (s ? p.text.slice(s[0], s[1]) : p.text).trim();
}

export function uniqueForms(content: string): string[] {
  const set = new Set<string>();
  for (const m of content.matchAll(TOKEN_RE)) if (/\p{L}/u.test(m[0])) set.add(formKey(m[0]));
  return [...set];
}
