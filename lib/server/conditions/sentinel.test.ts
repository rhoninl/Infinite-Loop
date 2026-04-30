import { describe, expect, it } from 'bun:test';
import type { IterationRecord } from '../../shared/types';
import { sentinelStrategy } from './sentinel';

function makeIter(stdout: string): IterationRecord {
  return {
    n: 1,
    exitCode: 0,
    stdout,
    stderr: '',
    durationMs: 1,
    timedOut: false,
  };
}

describe('sentinelStrategy', () => {
  it('matches a literal pattern in stdout', async () => {
    const iter = makeIter('working... DONE next');
    const result = await sentinelStrategy.evaluate(
      iter,
      { pattern: 'DONE', isRegex: false },
      '/tmp',
    );
    expect(result.met).toBe(true);
    expect(result.detail).toBe('matched at index 11');
  });

  it('returns met=false when literal pattern is absent', async () => {
    const iter = makeIter('still working, no end token');
    const result = await sentinelStrategy.evaluate(
      iter,
      { pattern: 'DONE', isRegex: false },
      '/tmp',
    );
    expect(result.met).toBe(false);
    expect(result.detail).toBe('pattern not found');
  });

  it('matches a regex pattern against stdout', async () => {
    // Default RegExp has no `m` flag; anchor `^` matches the start of the
    // whole string, so we test against stdout that starts with the token.
    const iter = makeIter('STATUS: ok\nmore output below');
    const result = await sentinelStrategy.evaluate(
      iter,
      { pattern: '^STATUS: ok', isRegex: true },
      '/tmp',
    );
    expect(result.met).toBe(true);
    expect(result.detail).toBe('matched at index 0');
  });

  it('returns met=false with descriptive detail for invalid regex', async () => {
    const iter = makeIter('any output');
    const result = await sentinelStrategy.evaluate(
      iter,
      { pattern: '[', isRegex: true },
      '/tmp',
    );
    expect(result.met).toBe(false);
    expect(result.detail.toLowerCase()).toContain('invalid regex');
  });

  it('returns met=false with descriptive detail for invalid config shape', async () => {
    const iter = makeIter('something');

    const nullResult = await sentinelStrategy.evaluate(iter, null, '/tmp');
    expect(nullResult.met).toBe(false);
    expect(nullResult.detail).toBe('invalid sentinel config');

    const partialResult = await sentinelStrategy.evaluate(
      iter,
      { pattern: 'DONE' },
      '/tmp',
    );
    expect(partialResult.met).toBe(false);
    expect(partialResult.detail).toBe('invalid sentinel config');

    const wrongTypesResult = await sentinelStrategy.evaluate(
      iter,
      { pattern: 123, isRegex: 'yes' },
      '/tmp',
    );
    expect(wrongTypesResult.met).toBe(false);
    expect(wrongTypesResult.detail).toBe('invalid sentinel config');
  });
});
