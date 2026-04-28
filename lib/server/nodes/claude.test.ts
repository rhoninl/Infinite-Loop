import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClaudeConfig,
  NodeExecutorContext,
} from '../../shared/workflow';
import { claudeExecutor } from './claude';
import { runClaude } from '../claude-runner';

vi.mock('../claude-runner', () => ({ runClaude: vi.fn() }));

const mockRunClaude = runClaude as unknown as ReturnType<typeof vi.fn>;

function makeCtx(
  config: Partial<ClaudeConfig>,
  overrides: Partial<NodeExecutorContext> = {},
): NodeExecutorContext {
  return {
    config: { prompt: 'do thing', cwd: '/tmp', timeoutMs: 1000, ...config },
    scope: {},
    defaultCwd: '/tmp',
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('claudeExecutor', () => {
  beforeEach(() => {
    mockRunClaude.mockReset();
  });

  it('returns branch "next" with full outputs on clean exit', async () => {
    mockRunClaude.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'hi',
      stderr: '',
      durationMs: 5,
      timedOut: false,
    });

    const result = await claudeExecutor.execute(makeCtx({}));

    expect(result.branch).toBe('next');
    expect(result.outputs).toEqual({
      stdout: 'hi',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
  });

  it('returns branch "error" on non-zero exit code', async () => {
    mockRunClaude.mockResolvedValueOnce({
      exitCode: 7,
      stdout: 'partial',
      stderr: 'boom',
      durationMs: 12,
      timedOut: false,
    });

    const result = await claudeExecutor.execute(makeCtx({}));

    expect(result.branch).toBe('error');
    expect(result.outputs.exitCode).toBe(7);
    expect(result.outputs.stderr).toBe('boom');
    expect(result.outputs.timedOut).toBe(false);
  });

  it('returns branch "error" when the runner times out', async () => {
    mockRunClaude.mockResolvedValueOnce({
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 1000,
      timedOut: true,
    });

    const result = await claudeExecutor.execute(makeCtx({}));

    expect(result.branch).toBe('error');
    expect(result.outputs.timedOut).toBe(true);
    expect(result.outputs.exitCode).toBeNull();
  });

  it('rejects invalid config without calling runClaude', async () => {
    const result = await claudeExecutor.execute(
      makeCtx({ prompt: '', cwd: '/tmp' }),
    );

    expect(result.branch).toBe('error');
    expect(result.outputs.errorMessage).toBe('invalid claude config');
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it('forwards the abort signal from the context to runClaude', async () => {
    mockRunClaude.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: false,
    });

    const ctx = makeCtx({});
    await claudeExecutor.execute(ctx);

    expect(mockRunClaude.mock.calls[0][0].signal).toBe(ctx.signal);
  });
});
