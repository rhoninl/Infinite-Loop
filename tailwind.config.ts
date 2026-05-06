/**
 * Tailwind + HeroUI configuration.
 *
 * Why this file looks the way it does:
 * - `darkMode` is wired to *both* the `.dark` class and the existing
 *   `[data-theme='dark']` attribute so the legacy `data-theme` toggle on
 *   <html> keeps working while next-themes also flips the attribute.
 * - The `content` glob covers our app code plus HeroUI's compiled theme
 *   assets so the `heroui()` plugin's variants land in the build.
 * - `theme.extend.colors` mirrors every CSS custom property defined in
 *   `app/globals.css`. This lets future component migrations reach for a
 *   Tailwind utility (e.g. `bg-bg-elevated`) instead of inline styles
 *   without losing the single source of truth — the CSS vars themselves.
 *   The CSS vars (light + dark) keep driving the actual values; Tailwind
 *   just hands out class names that resolve to `var(--…)`.
 */

import type { Config } from 'tailwindcss';
import { heroui } from '@heroui/react';

const config: Config = {
  darkMode: ['class', "[data-theme='dark']"],
  content: [
    './app/**/*.{ts,tsx}',
    './providers/**/*.{ts,tsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,mjs}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: {
          DEFAULT: 'var(--bg)',
          elevated: 'var(--bg-elevated)',
          input: 'var(--bg-input)',
          'input-focus': 'var(--bg-input-focus)',
          deep: 'var(--bg-deep)',
        },
        surface: {
          overlay: 'var(--surface-overlay)',
        },
        // Borders
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
          bright: 'var(--border-bright)',
        },
        // Foreground / text
        fg: {
          DEFAULT: 'var(--fg)',
          soft: 'var(--fg-soft)',
          dim: 'var(--fg-dim)',
          muted: 'var(--fg-muted)',
          faint: 'var(--fg-faint)',
        },
        // Status / accent palette
        accent: {
          live: 'var(--accent-live)',
          'on-live': 'var(--accent-on-live)',
          'on-live-soft': 'var(--accent-on-live-soft)',
          ok: 'var(--accent-ok)',
          err: 'var(--accent-err)',
          warn: 'var(--accent-warn)',
          info: 'var(--accent-info)',
        },
        // Per-node-type accents (drive the canvas card tinting)
        node: {
          start: 'var(--node-start)',
          end: 'var(--node-end)',
          agent: 'var(--node-agent)',
          condition: 'var(--node-condition)',
          loop: 'var(--node-loop)',
          branch: 'var(--node-branch)',
        },
        hover: {
          tint: 'var(--hover-tint)',
        },
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Newsreader', 'Source Serif', 'Georgia', 'serif'],
        mono: [
          'var(--font-mono)',
          'JetBrains Mono',
          'Berkeley Mono',
          'ui-monospace',
          'monospace',
        ],
      },
      spacing: {
        'top-bar': 'var(--top-bar-h)',
        rail: 'var(--rail-w)',
        palette: 'var(--palette-w)',
        right: 'var(--right-w)',
      },
    },
  },
  plugins: [heroui()],
};

export default config;
