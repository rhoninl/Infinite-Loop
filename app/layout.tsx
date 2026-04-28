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
    <html lang="en" className={`${newsreader.variable} ${jetbrains.variable}`}>
      <body>
        <div className="grain" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
