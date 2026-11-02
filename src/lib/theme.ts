import { useEffect } from 'react';
import { updateSettings, useData } from './store';

export type Theme = 'auto' | 'light' | 'dark';

const BG = { light: '#faf6ee', dark: '#1b1916' };

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** The theme actually on screen right now. */
export const effectiveTheme = (t: Theme): 'light' | 'dark' => (t === 'auto' ? (darkQuery().matches ? 'dark' : 'light') : t);

/** Applies the chosen theme to the page and the iOS status bar color. */
export function useApplyTheme() {
  const theme = useData().settings.theme;
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      if (theme === 'auto') delete root.dataset.theme;
      else root.dataset.theme = theme;
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
        m.removeAttribute('media');
        m.setAttribute('content', BG[effectiveTheme(theme)]);
      });
    };
    apply();
    // In auto mode follow the phone when it switches day/night
    const q = darkQuery();
    q.addEventListener('change', apply);
    return () => q.removeEventListener('change', apply);
  }, [theme]);
}

/** One tap flips between light and dark (leaving "auto" mode). */
export function toggleTheme(current: Theme) {
  updateSettings({ theme: effectiveTheme(current) === 'dark' ? 'light' : 'dark' });
}
