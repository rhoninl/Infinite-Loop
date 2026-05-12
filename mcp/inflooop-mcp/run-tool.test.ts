import { describe, expect, it, mock } from 'bun:test';
import type { InflooopClient, PersistedRun } from './inflooop-client';
import { runWorkflowTool } from './run-tool';

function fakeClient(opts: {
  start: Awaited<ReturnType<InflooopClient['startRun']>>;
  pollResults: Awaited<ReturnType<InflooopClient['getRun']>>[];
}): InflooopClient {
  let i = 0;
  return {
    startRun: mock(async () => opts.start),
    getRun: mock(async () => {
      const r = opts.pollResults[Math.min(i++, opts.pollResults.length - 1)]!;
      return r;
    }),
  } as unknown as InflooopClient;
}

const succeededRun: PersistedRun = {
  runId: 'r',
  workflowId: 'wf',
  status: 'succeeded',
  startedAt: 1,
  finishedAt: 5,
  scope: {
    inputs: { foo: 'bar' },
    'claude-1': { stdout: 'hello' },
  },
};
const runningRun: PersistedRun = {
  runId: 'r',
  workflowId: 'wf',
  status: 'running',
  startedAt: 1,
  scope: {},
};

describe('runWorkflowTool', () => {
  it('returns filtered outputs on settled run', async () => {
    const client = fakeClient({
      start: { ok: true, runId: 'r' },
      pollResults: [
        { ok: true, run: runningRun },
        { ok: true, run: succeededRun },
      ],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: { foo: 'bar' },
      pollIntervalMs: 1,
      timeoutMs: 500,
    });
    expect(out.status).toBe('succeeded');
    expect(out.runId).toBe('r');
    expect(out.outputs).toEqual({ 'claude-1': { stdout: 'hello' } });
  });

  it('surfaces a busy error with the in-flight runId', async () => {
    const client = fakeClient({
      start: { ok: false, kind: 'busy', runId: 'other', workflowId: 'wf-other' },
      pollResults: [],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: {},
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/busy/i);
    expect(out.error).toContain('other');
  });

  it('returns a timeout result with the runId for later polling', async () => {
    const client = fakeClient({
      start: { ok: true, runId: 'r' },
      pollResults: [{ ok: true, run: runningRun }],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: {},
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    expect(out.status).toBe('timeout');
    expect(out.runId).toBe('r');
  });

  it('surfaces invalid-inputs error with the offending field', async () => {
    const client = fakeClient({
      start: { ok: false, kind: 'invalid-inputs', field: 'pr_url', reason: 'required' },
      pollResults: [],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: {},
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/pr_url/);
    expect(out.error).toMatch(/required/);
  });
});
