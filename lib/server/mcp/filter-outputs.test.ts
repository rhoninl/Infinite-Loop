import { describe, expect, it } from 'bun:test';
import { filterOutputs } from './filter-outputs';

describe('filterOutputs', () => {
  it('strips inputs, __inputs, globals', () => {
    const scope = {
      inputs: { foo: 'bar' },
      __inputs: { foo: 'bar' },
      globals: { url: 'https://…' },
      'claude-1': { stdout: 'hello', exitCode: 0 },
      'end-1': { outcome: 'succeeded' },
    };
    expect(filterOutputs(scope)).toEqual({
      'claude-1': { stdout: 'hello', exitCode: 0 },
      'end-1': { outcome: 'succeeded' },
    });
  });

  it('returns an empty object for an empty scope', () => {
    expect(filterOutputs({})).toEqual({});
  });

  it('passes through undefined or non-object input safely', () => {
    expect(filterOutputs(undefined)).toEqual({});
    expect(filterOutputs(null as unknown as Record<string, unknown>)).toEqual({});
  });
});
