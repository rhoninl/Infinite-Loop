import type { ReactNode } from 'react';
import { Newsreader, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/providers/heroui-provider';
import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['300', '400', '500', '700'],
  display: 'swap',
});

export const metadata = {
  title: 'InfLoop · Console',
  description: 'Drive Claude Code in a loop until a condition is met.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      {/*
       * `next-themes` injects its own pre-paint script via <Providers>,
       * so we no longer need a hand-rolled <script> in <head>.
       *
       * Browser extensions like ColorZilla inject attributes such as
       * `cz-shortcut-listen="true"` onto <body> before React hydrates,
       * which causes a benign-but-noisy hydration warning. next-themes
       * also requires `suppressHydrationWarning` on the element it
       * mutates (<html>), so we keep both in place.
       */}
      <body suppressHydrationWarning>
        <div className="grain" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
