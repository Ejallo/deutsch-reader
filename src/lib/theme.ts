import { useEffect } from 'react';
import { updateSettings, useData } from './store';

export type Theme = 'time' | 'auto' | 'light' | 'dark';

// "time": paper (C1) by day, night paper (C2) in the evening, whatever the phone's setting
const DAY_START = 7;
const NIGHT_START = 20;
const isNightNow = () => {
  const h = new Date().getHours();
  return h < DAY_START || h >= NIGHT_START;
};

const BG = { light: '#faf6ee', dark: '#1b1916' };

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** The theme actually on screen right now. */
export const effectiveTheme = (t: Theme): 'light' | 'dark' =>
  t === 'time' ? (isNightNow() ? 'dark' : 'light') : t === 'auto' ? (darkQuery().matches ? 'dark' : 'light') : t;

/** Applies the chosen theme to the page and the iOS status bar color. */
export function useApplyTheme() {
  const theme = useData().settings.theme;
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      if (theme === 'auto') delete root.dataset.theme;
      else root.dataset.theme = effectiveTheme(theme);
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
        m.removeAttribute('media');
        m.setAttribute('content', BG[effectiveTheme(theme)]);
      });
    };
    apply();
    // In auto mode follow the phone when it switches day/night
    const q = darkQuery();
    q.addEventListener('change', apply);
    // In "time" mode re-check every minute so evening switches the theme on its own
    const timer = setInterval(apply, 60000);
    document.addEventListener('visibilitychange', apply);
    return () => {
      q.removeEventListener('change', apply);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', apply);
    };
  }, [theme]);
}

/** One tap flips between light and dark (leaving "auto" mode). */
export function toggleTheme(current: Theme) {
  updateSettings({ theme: effectiveTheme(current) === 'dark' ? 'light' : 'dark' });
}
