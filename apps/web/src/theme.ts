import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'stage' | 'system';
export const THEMES: ThemeChoice[] = ['dark', 'light', 'stage', 'system'];
const KEY = 'stint.theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v && (THEMES as string[]).includes(v) ? (v as ThemeChoice) : 'dark';
  } catch {
    return 'dark';
  }
}

/** Dark is the default; "system" follows prefers-color-scheme only when the person chose it. */
export function applyTheme(choice: ThemeChoice): void {
  const resolved = choice === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = resolved;
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setThemeState] = useState<ThemeChoice>(read);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  const setTheme = useCallback((t: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* not persisted in a private window */
    }
    setThemeState(t);
  }, []);
  return [theme, setTheme];
}

if (typeof document !== 'undefined') applyTheme(read());
