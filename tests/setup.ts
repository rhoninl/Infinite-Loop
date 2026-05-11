// Order matters: @testing-library/dom captures `document.body` at import time
// (it returns an error-throwing `screen` if the global isn't there yet). So we
// register happy-dom FIRST, then load anything that pulls in RTL.

// Stash the native fetch before happy-dom overrides it with a CORS-enforcing
// shim. Tests that exercise real Node-side HTTP code (e.g. the http-runner's
// fetch against a node:http stub server) should use this to bypass the DOM
// polyfill — in production those code paths run on the Next.js server with
// no CORS layer at all.
(globalThis as { __infloopNativeFetch?: typeof fetch }).__infloopNativeFetch =
  globalThis.fetch;

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
