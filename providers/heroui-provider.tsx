'use client';

/**
 * App-wide client providers for HeroUI + theming.
 *
 * Why this file exists:
 * - HeroUI v2 components rely on `<HeroUIProvider>` for keyboard navigation,
 *   portal targets, and default props. It must be mounted high in the tree.
 * - We use `next-themes` with both `class` and `data-theme` attributes:
 *   our globals.css keys colors off `[data-theme='dark'|'light']`, while
 *   the `heroui()` Tailwind plugin scopes its design tokens to the literal
 *   `.dark`/`.light` class on the root. Setting only one attribute caused
 *   HeroUI components to keep their light-mode foreground in dark mode.
 *   `storageKey="infloop:theme"` preserves the legacy localStorage slot so
 *   users don't lose their saved choice across this migration.
 *   `defaultTheme="dark"` matches the current product default.
 * - This is a separate `'use client'` boundary so `app/layout.tsx` can stay
 *   a server component and keep streaming the document shell.
 *
 * next-themes injects its own pre-paint script, so the inline script that
 * used to live in `app/layout.tsx` has been removed.
 */

import type { ReactNode } from 'react';
import { HeroUIProvider } from '@heroui/react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute={['class', 'data-theme']}
      defaultTheme="dark"
      enableSystem={false}
      storageKey="infloop:theme"
    >
      <HeroUIProvider>{children}</HeroUIProvider>
    </NextThemesProvider>
  );
}
