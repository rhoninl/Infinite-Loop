import { describe, expect, it } from 'bun:test';
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

  it('accepts booleans only when actually boolean', () => {
    expect(
      resolveRunInputs([decl({ name: 'b', type: 'boolean' })], { b: true }),
    ).toEqual({ b: true });
    try {
      resolveRunInputs([decl({ name: 'b', type: 'boolean' })], { b: 'true' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as WorkflowInputError).reason).toBe('type');
    }
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
