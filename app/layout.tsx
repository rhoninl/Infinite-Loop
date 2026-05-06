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
      <head>
        {/*
         * Pre-paint theme application — must run before <body> renders to
         * avoid a flash of the wrong theme. Reads the user's saved choice
         * (`infloop:theme`), falling back to OS preference.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('infloop:theme');var t=s||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`,
          }}
        />
      </head>
      {/*
       * Browser extensions like ColorZilla inject attributes such as
       * `cz-shortcut-listen="true"` onto <body> before React hydrates,
       * which causes a benign-but-noisy hydration warning. We don't
       * render any attribute-sensitive content on these elements, so
       * suppressing the warning here is the canonical React fix.
       */}
      <body suppressHydrationWarning>
        <div className="grain" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
