import { describe, expect, test } from 'bun:test';
import { evaluatePredicate } from './predicate';

describe('evaluatePredicate', () => {
  test('== matches identical strings', () => {
    expect(evaluatePredicate({ lhs: 'push', op: '==', rhs: 'push' }))
      .toEqual({ ok: true, result: true });
  });

  test('!= negates equality', () => {
    expect(evaluatePredicate({ lhs: 'a', op: '!=', rhs: 'b' }))
      .toEqual({ ok: true, result: true });
  });

  test('contains is a substring check', () => {
    expect(evaluatePredicate({ lhs: 'refs/heads/main', op: 'contains', rhs: 'main' }))
      .toEqual({ ok: true, result: true });
  });

  test('matches treats rhs as a regex', () => {
    expect(evaluatePredicate({ lhs: 'v1.2.3', op: 'matches', rhs: '^v\\d+\\.\\d+\\.\\d+$' }))
      .toEqual({ ok: true, result: true });
  });

  test('matches returns ok:false on invalid regex', () => {
    const v = evaluatePredicate({ lhs: 'x', op: 'matches', rhs: '[' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/invalid regex/);
  });
});
