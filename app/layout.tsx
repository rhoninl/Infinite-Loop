import type { ReactNode } from 'react';

export const metadata = {
  title: 'InfLoop',
  description: 'Drive Claude Code in a loop until a condition is met.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: '24px',
          maxWidth: 960,
          marginInline: 'auto',
        }}
      >
        {children}
      </body>
    </html>
  );
}
