// Order matters: @testing-library/dom captures `document.body` at import time
// (it returns an error-throwing `screen` if the global isn't there yet). So we
// register happy-dom FIRST, then load anything that pulls in RTL.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();

const { afterEach, expect } = await import('bun:test');
const matchers = await import('@testing-library/jest-dom/matchers');
const { cleanup } = await import('@testing-library/react');

// `matchers` is a namespace of named exports — pass it through unchanged so
// expect.extend sees each matcher by name. The cast bridges bun:test's
// stricter MatcherFunction signature to jest-dom's loose one.
expect.extend(matchers as unknown as Record<string, never>);

// @testing-library/react auto-cleans up between tests under jest/vitest, but
// not under bun:test — so unmount + clear DOM between tests ourselves.
afterEach(() => {
  cleanup();
});
