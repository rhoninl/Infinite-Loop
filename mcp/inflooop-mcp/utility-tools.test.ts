import { describe, expect, it, mock } from 'bun:test';
import type { InflooopClient, PersistedRun } from './inflooop-client';
import { getRunStatus, listRuns, cancelRun } from './utility-tools';

function clientWith(overrides: Partial<InflooopClient>): InflooopClient {
  return overrides as InflooopClient;
}

const settled: PersistedRun = {
  runId: 'r',
  workflowId: 'wf',
  status: 'succeeded',
  startedAt: 1,
  finishedAt: 5,
  scope: { inputs: { hidden: 1 }, 'a': { result: 'ok' } },
};

describe('getRunStatus', () => {
  it('returns status + filtered outputs', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: true, run: settled })),
    });
    const out = await getRunStatus(c, { workflowId: 'wf', runId: 'r' });
    expect(out.status).toBe('succeeded');
    expect(out.outputs).toEqual({ a: { result: 'ok' } });
  });

  it('surfaces not-found cleanly', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: false, kind: 'not-found' as const })),
    });
    const out = await getRunStatus(c, { workflowId: 'wf', runId: 'r' });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/not found/i);
  });
});

describe('listRuns', () => {
  it('forwards to client.listRuns', async () => {
    const list = mock(async () => ({ runs: [{ runId: 'a' }, { runId: 'b' }] }));
    const c = clientWith({ listRuns: list });
    const out = await listRuns(c, { workflowId: 'wf' });
    expect(out.runs?.length).toBe(2);
    expect(list).toHaveBeenCalledWith('wf');
  });
});

describe('cancelRun', () => {
  it('returns cancelled:true when the runId matches the in-flight run', async () => {
    const c = clientWith({
      getRun: mock(async () => ({
        ok: true,
        run: { ...settled, status: 'running', runId: 'r' } as PersistedRun,
      })),
      cancelRun: mock(async () => ({ ok: true as const })),
    });
    const out = await cancelRun(c, { workflowId: 'wf', runId: 'r' });
    expect(out.cancelled).toBe(true);
  });

  it('returns cancelled:false when the run already settled', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: true, run: settled })),
    });
    const out = await cancelRun(c, { workflowId: 'wf', runId: 'r' });
    expect(out.cancelled).toBe(false);
    expect(out.reason).toMatch(/already settled/i);
  });

  it('returns cancelled:false when the runId does not match the current run', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: false, kind: 'not-found' as const })),
    });
    const out = await cancelRun(c, { workflowId: 'wf', runId: 'rid-old' });
    expect(out.cancelled).toBe(false);
    expect(out.reason).toMatch(/no longer/i);
  });
});
