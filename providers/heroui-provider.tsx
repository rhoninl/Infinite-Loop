'use client';

/**
 * App-wide client providers for HeroUI + theming.
 *
 * Why this file exists:
 * - HeroUI v2 components rely on `<HeroUIProvider>` for keyboard navigation,
 *   portal targets, and default props. It must be mounted high in the tree.
 * - We use `next-themes` with `attribute="data-theme"` (not the default
 *   `class`) so it stays compatible with the existing pre-paint script and
 *   the CSS rules that already key off `[data-theme='dark'|'light']`.
 *   `defaultTheme="dark"` matches the current product default.
 * - This is a separate `'use client'` boundary so `app/layout.tsx` can stay
 *   a server component and keep streaming the document shell.
 *
 * NOTE: the inline pre-paint script in `app/layout.tsx` still runs to avoid
 * a flash of the wrong theme on first paint. A later worker (Unit 2) will
 * remove it once next-themes is the single source of truth.
 */

import type { ReactNode } from 'react';
import { HeroUIProvider } from '@heroui/react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
      <HeroUIProvider>{children}</HeroUIProvider>
    </NextThemesProvider>
  );
}
