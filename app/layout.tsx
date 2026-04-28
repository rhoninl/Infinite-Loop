import type { ReactNode } from 'react';
import { Newsreader, JetBrains_Mono } from 'next/font/google';
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
       * Browser extensions like ColorZilla inject attributes such as
       * `cz-shortcut-listen="true"` onto <body> before React hydrates,
       * which causes a benign-but-noisy hydration warning. We don't
       * render any attribute-sensitive content on these elements, so
       * suppressing the warning here is the canonical React fix.
       */}
      <body suppressHydrationWarning>
        <div className="grain" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
