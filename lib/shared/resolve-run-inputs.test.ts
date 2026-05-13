import { describe, expect, it, test } from 'bun:test';
import {
  resolveRunInputs,
  WorkflowInputError,
} from './resolve-run-inputs';
import type { WorkflowInputDecl } from './workflow';

const decl = (overrides: Partial<WorkflowInputDecl> & { name: string }):
  WorkflowInputDecl => ({ type: 'string', ...overrides });

describe('resolveRunInputs', () => {
  it('returns empty object when nothing is declared', () => {
    expect(resolveRunInputs([], undefined)).toEqual({});
    expect(resolveRunInputs([], {})).toEqual({});
  });

  it('uses supplied value when declared and supplied', () => {
    const out = resolveRunInputs(
      [decl({ name: 'topic' })],
      { topic: 'cats' },
    );
    expect(out).toEqual({ topic: 'cats' });
  });

  it('falls back to declared default when value omitted', () => {
    const out = resolveRunInputs(
      [decl({ name: 'topic', default: 'cats' })],
      {},
    );
    expect(out).toEqual({ topic: 'cats' });
  });

  it('throws required when no value and no default', () => {
    try {
      resolveRunInputs([decl({ name: 'topic' })], {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowInputError);
      expect((err as WorkflowInputError).reason).toBe('required');
      expect((err as WorkflowInputError).field).toBe('topic');
    }
  });

  it('coerces numbers and rejects non-finite', () => {
    expect(
      resolveRunInputs([decl({ name: 'n', type: 'number' })], { n: 5 }),
    ).toEqual({ n: 5 });
    try {
      resolveRunInputs(
        [decl({ name: 'n', type: 'number' })],
        { n: 'abc' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowInputError);
      expect((err as WorkflowInputError).reason).toBe('type');
      expect((err as WorkflowInputError).expected).toBe('number');
    }
  });

  it('accepts booleans and coerces "true"/"false" strings', () => {
    expect(
      resolveRunInputs([decl({ name: 'b', type: 'boolean' })], { b: true }),
    ).toEqual({ b: true });
    expect(
      resolveRunInputs([decl({ name: 'b', type: 'boolean' })], { b: 'true' }),
    ).toEqual({ b: true });
  });

  it('treats `text` like a string', () => {
    const out = resolveRunInputs(
      [decl({ name: 't', type: 'text' })],
      { t: 'hello\nworld' },
    );
    expect(out).toEqual({ t: 'hello\nworld' });
  });

  it('drops unknown supplied keys silently (forward compat)', () => {
    const out = resolveRunInputs(
      [decl({ name: 'topic', default: 'cats' })],
      { topic: 'dogs', stale: 'oops' },
    );
    expect(out).toEqual({ topic: 'dogs' });
    expect('stale' in out).toBe(false);
  });

  it('reports the first missing-required field', () => {
    try {
      resolveRunInputs(
        [decl({ name: 'a' }), decl({ name: 'b' })],
        { a: 'x' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as WorkflowInputError).field).toBe('b');
      expect((err as WorkflowInputError).reason).toBe('required');
    }
  });
});

describe('resolveRunInputs string coercion (Dispatch v2)', () => {
  test('coerces "42" to 42 for a number-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'n', type: 'number' }],
      { n: '42' },
    );
    expect(r.n).toBe(42);
  });

  test('coerces "3.14" to 3.14 for a number-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'n', type: 'number' }],
      { n: '3.14' },
    );
    expect(r.n).toBe(3.14);
  });

  test('rejects a non-numeric string for number-typed input', () => {
    expect(() =>
      resolveRunInputs(
        [{ name: 'n', type: 'number' }],
        { n: 'abc' },
      ),
    ).toThrow(/n/);
  });

  test('coerces "true" / "false" to boolean (case-insensitive)', () => {
    const r1 = resolveRunInputs(
      [{ name: 'b', type: 'boolean' }],
      { b: 'true' },
    );
    expect(r1.b).toBe(true);

    const r2 = resolveRunInputs(
      [{ name: 'b', type: 'boolean' }],
      { b: 'FALSE' },
    );
    expect(r2.b).toBe(false);
  });

  test('rejects a non-boolean string for boolean-typed input', () => {
    expect(() =>
      resolveRunInputs(
        [{ name: 'b', type: 'boolean' }],
        { b: 'yes' },
      ),
    ).toThrow(/b/);
  });

  test('native number still works for number-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'n', type: 'number' }],
      { n: 42 },
    );
    expect(r.n).toBe(42);
  });

  test('native boolean still works for boolean-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'b', type: 'boolean' }],
      { b: true },
    );
    expect(r.b).toBe(true);
  });
});
