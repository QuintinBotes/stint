import { useEffect, useState } from 'react';

/** Pit wall is dark and the default; the timing sheet is light, as printed; stage is high contrast for a projector. */
export const THEMES = ['pitwall', 'sheet', 'stage'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_NAMES: Record<Theme, string> = { pitwall: 'Pit wall', sheet: 'Timing sheet', stage: 'Stage' };

const KEY = 'stint.theme';
const EVENT = 'stint:theme';

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return (THEMES as readonly string[]).includes(saved ?? '') ? (saved as Theme) : 'pitwall';
  } catch {
    return 'pitwall';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // the browser chrome on a phone follows the page
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'pitwall' ? '#17191c' : '#ffffff');
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private window: the theme lasts for this tab only */
  }
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] as Theme;

/** The theme in force, following a switch made anywhere on the page (the header button or the palette). */
export function useTheme(): Theme {
  const [theme, set] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme | undefined) ?? readTheme());
  useEffect(() => {
    const on = () => set(document.documentElement.dataset.theme as Theme);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return theme;
}
