// Reader typefaces. System ones need no download; web fonts load from Google Fonts on first use
// and are cached by the service worker for offline reading.

export type ReaderFont = 'onest' | 'serif' | 'sans' | 'literata' | 'nunito' | 'lexend';

export const READER_FONTS: { id: ReaderFont; label: string; family: string; google?: string }[] = [
  { id: 'onest', label: 'Обычный', family: "'Onest', system-ui, sans-serif" },
  { id: 'serif', label: 'Книжный', family: "ui-serif, 'New York', Georgia, serif" },
  { id: 'sans', label: 'Строгий', family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: 'literata', label: 'Литературный', family: "'Literata', Georgia, serif", google: 'Literata:opsz,wght@7..72,400;7..72,600' },
  { id: 'nunito', label: 'Мягкий', family: "'Nunito', system-ui, sans-serif", google: 'Nunito:wght@400;600' },
  { id: 'lexend', label: 'Для лёгкого чтения', family: "'Lexend', system-ui, sans-serif", google: 'Lexend:wght@400;600' },
];

export const READER_SIZES = { min: 15, max: 28, default: 19 };

const loaded = new Set<string>();

export function fontFamily(id: ReaderFont): string {
  const f = READER_FONTS.find((x) => x.id === id) ?? READER_FONTS[0];
  if (f.google && !loaded.has(f.id)) {
    loaded.add(f.id);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
  }
  return f.family;
}
