'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@heroui/react';

/**
 * Top-bar theme toggle.
 *
 * Theme state is owned by `next-themes` (configured with
 * `attribute="data-theme"` and `storageKey="infloop:theme"` in
 * <Providers>). We render a HeroUI Button so the control inherits the
 * shared focus/keyboard behavior and visual language used by the rest of
 * the migrated UI.
 *
 * The `mounted` guard is the standard next-themes idiom: on the server
 * `resolvedTheme` is `undefined`, so we render a placeholder until after
 * hydration to keep server and first client paint identical and avoid
 * hydration mismatches on the glyph/label.
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isLight = mounted && resolvedTheme === 'light';
  const next = isLight ? 'dark' : 'light';
  const label = `switch to ${next} theme`;

  // Legacy `.theme-toggle*` classes still drive the dashed-border +
  // half-disc visual; a later cleanup unit will retire them in favor of
  // HeroUI tokens.
  return (
    <Button
      size="sm"
      variant="light"
      onPress={() => setTheme(next)}
      aria-label={label}
      aria-pressed={isLight}
      title={label}
      className="theme-toggle"
      disableRipple
    >
      <span className="theme-toggle-glyph" aria-hidden="true" />
      <span className="theme-toggle-label">{isLight ? 'light' : 'dark'}</span>
    </Button>
  );
}
