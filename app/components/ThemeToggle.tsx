'use client';

import { useCallback, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'infloop:theme';

function readCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const t = document.documentElement.dataset.theme;
  return t === 'light' ? 'light' : 'dark';
}

export default function ThemeToggle() {
  // Start in 'dark' on the server render so the markup is stable; the
  // pre-paint script in layout.tsx has already set the actual dataset.theme,
  // and we sync from it after mount.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(readCurrentTheme());
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable; toggle is still effective for the session.
    }
  }, [theme]);

  // Glyph: filled circle for active mode, outlined for the alternate.
  const glyph = theme === 'dark' ? '◐' : '◑';
  const label = theme === 'dark' ? 'switch to light theme' : 'switch to dark theme';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      aria-pressed={theme === 'light'}
      title={label}
    >
      <span className="theme-toggle-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="theme-toggle-label">{theme}</span>
    </button>
  );
}
