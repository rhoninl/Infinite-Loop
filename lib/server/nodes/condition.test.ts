import { describe, expect, it, vi } from 'vitest';
import type {
  ConditionConfig,
  NodeExecutorContext,
} from '../../shared/workflow';

function makeCtx(config: unknown, defaultCwd = '/tmp'): NodeExecutorContext {
  return {
    config,
    scope: {},
    defaultCwd,
    signal: new AbortController().signal,
  };
}

describe('conditionExecutor', () => {
  it('sentinel met: literal pattern present in against → branch "met"', async () => {
    const { conditionExecutor } = await import('./condition');
    const cfg: ConditionConfig = {
      kind: 'sentinel',
      against: 'hello DONE',
      sentinel: { pattern: 'DONE', isRegex: false },
    };
    const result = await conditionExecutor.execute(makeCtx(cfg));
    expect(result.branch).toBe('met');
    expect(result.outputs.met).toBe(true);
    expect(String(result.outputs.detail)).toContain('matched');
  });

  it('sentinel not_met: pattern absent → branch "not_met"', async () => {
    const { conditionExecutor } = await import('./condition');
    const cfg: ConditionConfig = {
      kind: 'sentinel',
      against: 'hello',
      sentinel: { pattern: 'X', isRegex: false },
    };
    const result = await conditionExecutor.execute(makeCtx(cfg));
    expect(result.branch).toBe('not_met');
    expect(result.outputs.met).toBe(false);
  });

  it('command met: `true` exits 0 → branch "met"', async () => {
    const { conditionExecutor } = await import('./condition');
    const cfg: ConditionConfig = {
      kind: 'command',
      command: { cmd: 'true' },
    };
    const result = await conditionExecutor.execute(makeCtx(cfg));
    expect(result.branch).toBe('met');
    expect(result.outputs.met).toBe(true);
  });

  it('command not_met: `false` exits non-zero → branch "not_met"', async () => {
    const { conditionExecutor } = await import('./condition');
    const cfg: ConditionConfig = {
      kind: 'command',
      command: { cmd: 'false' },
    };
    const result = await conditionExecutor.execute(makeCtx(cfg));
    expect(result.branch).toBe('not_met');
    expect(result.outputs.met).toBe(false);
  });

  it('invalid kind → branch "error" with check error detail', async () => {
    const { conditionExecutor } = await import('./condition');
    const cfg = { kind: 'oops' } as unknown as ConditionConfig;
    const result = await conditionExecutor.execute(makeCtx(cfg));
    expect(result.branch).toBe('error');
    expect(result.outputs.met).toBe(false);
    expect(String(result.outputs.detail).startsWith('check error:')).toBe(true);
  });
});

describe('conditionExecutor — strategy throws', () => {
  it('catches strategy errors and returns branch "error"', async () => {
    vi.resetModules();
    vi.doMock('../conditions/sentinel', () => ({
      sentinelStrategy: {
        evaluate: async () => {
          throw new Error('boom');
        },
      },
    }));

    const { conditionExecutor } = await import('./condition');
    const cfg: ConditionConfig = {
      kind: 'sentinel',
      against: 'whatever',
      sentinel: { pattern: 'DONE', isRegex: false },
    };
    const result = await conditionExecutor.execute(makeCtx(cfg));
    expect(result.branch).toBe('error');
    expect(result.outputs.met).toBe(false);
    expect(String(result.outputs.detail).startsWith('check error:')).toBe(true);
    expect(String(result.outputs.detail)).toContain('boom');

    vi.doUnmock('../conditions/sentinel');
    vi.resetModules();
  });
});
