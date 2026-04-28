import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConditionStrategy,
  RunConfig,
  RunEvent,
  RunnerOptions,
  RunnerResult,
} from '../shared/types';

const runClaudeMock = vi.fn<(opts: RunnerOptions) => Promise<RunnerResult>>();
const sentinelEvaluate = vi.fn<ConditionStrategy['evaluate']>();
const commandEvaluate = vi.fn<ConditionStrategy['evaluate']>();
const judgeEvaluate = vi.fn<ConditionStrategy['evaluate']>();

vi.mock('./claude-runner', () => ({
  runClaude: (opts: RunnerOptions) => runClaudeMock(opts),
}));

vi.mock('./conditions/index', () => ({
  strategies: {
    sentinel: { evaluate: (...a: Parameters<ConditionStrategy['evaluate']>) => sentinelEvaluate(...a) },
    command: { evaluate: (...a: Parameters<ConditionStrategy['evaluate']>) => commandEvaluate(...a) },
    judge: { evaluate: (...a: Parameters<ConditionStrategy['evaluate']>) => judgeEvaluate(...a) },
  },
}));

const { LoopManager } = await import('./loop-manager');
const { eventBus } = await import('./event-bus');

const baseCfg: RunConfig = {
  prompt: 'do the thing',
  cwd: '/tmp/x',
  condition: { type: 'sentinel', config: { pattern: 'DONE', isRegex: false } },
  maxIterations: 3,
  iterationTimeoutMs: 1000,
};

function ok(stdout = ''): RunnerResult {
  return { exitCode: 0, stdout, stderr: '', durationMs: 5, timedOut: false };
}

function captureEvents(): { events: RunEvent[]; unsubscribe: () => void } {
  const events: RunEvent[] = [];
  const unsubscribe = eventBus.subscribe((e) => events.push(e));
  return { events, unsubscribe };
}

describe('LoopManager', () => {
  let mgr: InstanceType<typeof LoopManager>;

  beforeEach(() => {
    runClaudeMock.mockReset();
    sentinelEvaluate.mockReset();
    commandEvaluate.mockReset();
    judgeEvaluate.mockReset();
    eventBus.clear();
    mgr = new LoopManager();
  });

  afterEach(() => {
    eventBus.clear();
  });

  it('succeeds when the sentinel strategy reports met=true', async () => {
    runClaudeMock.mockResolvedValue(ok('DONE'));
    sentinelEvaluate.mockResolvedValue({ met: true, detail: 'matched DONE' });

    const { events } = captureEvents();
    await mgr.start(baseCfg);

    expect(mgr.getState().outcome).toBe('succeeded');
    expect(mgr.getState().iterations).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'run_finished', outcome: 'succeeded' });
  });

  it('exhausts when condition never meets within maxIterations', async () => {
    runClaudeMock.mockResolvedValue(ok());
    sentinelEvaluate.mockResolvedValue({ met: false, detail: 'no match' });

    await mgr.start(baseCfg);

    expect(mgr.getState().outcome).toBe('exhausted');
    expect(mgr.getState().iterations).toHaveLength(baseCfg.maxIterations);
    expect(runClaudeMock).toHaveBeenCalledTimes(baseCfg.maxIterations);
  });

  it('fails on non-zero exit code', async () => {
    runClaudeMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      durationMs: 1,
      timedOut: false,
    });

    const { events } = captureEvents();
    await mgr.start(baseCfg);

    expect(mgr.getState().outcome).toBe('failed');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('fails on timeout', async () => {
    runClaudeMock.mockResolvedValue({
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 1000,
      timedOut: true,
    });

    await mgr.start(baseCfg);
    expect(mgr.getState().outcome).toBe('failed');
    expect(mgr.getState().errorMessage).toMatch(/timed out/);
  });

  it('cancels when stop() is called mid-run', async () => {
    let resolveCurrent: ((r: RunnerResult) => void) | null = null;
    runClaudeMock.mockImplementation(
      () =>
        new Promise<RunnerResult>((resolve) => {
          resolveCurrent = resolve;
        }),
    );
    sentinelEvaluate.mockResolvedValue({ met: false, detail: 'no match' });

    const runPromise = mgr.start(baseCfg);
    await new Promise((r) => setTimeout(r, 10));
    mgr.stop();
    resolveCurrent!(ok());
    await runPromise;

    expect(mgr.getState().outcome).toBe('cancelled');
  });

  it('rejects start when a run is already active', async () => {
    let resolveCurrent: ((r: RunnerResult) => void) | null = null;
    runClaudeMock.mockImplementation(
      () =>
        new Promise<RunnerResult>((resolve) => {
          resolveCurrent = resolve;
        }),
    );
    sentinelEvaluate.mockResolvedValue({ met: true, detail: 'met' });

    const first = mgr.start(baseCfg);
    await expect(mgr.start(baseCfg)).rejects.toThrow(/already active/);
    resolveCurrent!(ok());
    await first;
  });
});
