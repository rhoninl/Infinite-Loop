import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['**/node_modules/**', '**/.claude/**', '**/.next/**', '**/dist/**'],
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['lib/client/**/*.test.ts', 'jsdom'],
    ],
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname,
    },
  },
});
