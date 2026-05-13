import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RunSummary } from '@/lib/shared/workflow';

// Capture originals before mocking so afterAll can restore.
const realRunStore = { ...(await import('@/lib/server/run-store')) };
const realEngine = { ...(await import('@/lib/server/workflow-engine')) };

mock.module('@/lib/server/run-store', () => ({
  getRun: mock(),
  listRuns: mock(),
}));
mock.module('@/lib/server/workflow-engine', () => ({
  workflowEngine: { getState: mock(), stop: mock() },
}));

const { getRun, listRuns: storeListRuns } = await import('@/lib/server/run-store');
const { workflowEngine } = await import('@/lib/server/workflow-engine');
const { getRunStatus, listRuns, cancelRun } = await import('./utility-tools');

afterAll(() => {
  mock.module('@/lib/server/run-store', () => realRunStore);
  mock.module('@/lib/server/workflow-engine', () => realEngine);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = ReturnType<typeof mock<(...args: any[]) => any>>;
const getRunMock = getRun as unknown as AnyMock;
const storeListRunsMock = storeListRuns as unknown as AnyMock;
const getStateMock = workflowEngine.getState as unknown as AnyMock;
const stopMock = workflowEngine.stop as unknown as AnyMock;

const settledRun = {
  runId: 'r',
  workflowId: 'wf',
  workflowName: 'WF',
  status: 'succeeded' as const,
  startedAt: 1000,
  finishedAt: 2000,
  durationMs: 1000,
  scope: { inputs: { hidden: 1 }, 'node-1': { result: 'ok' } },
  events: [],
};

beforeEach(() => {
  getRunMock.mockReset();
  storeListRunsMock.mockReset();
  getStateMock.mockReset();
  stopMock.mockReset();
});

describe('getRunStatus', () => {
  it('returns filtered outputs from the persisted store', async () => {
    getRunMock.mockResolvedValue(settledRun);
    const out = await getRunStatus({ workflowId: 'wf', runId: 'r' });
    expect(out.status).toBe('succeeded');
    expect(out.runId).toBe('r');
    expect(out.durationMs).toBe(1000);
    expect(out.outputs).toEqual({ 'node-1': { result: 'ok' } });
  });

  it('falls through to engine snapshot when not persisted', async () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    getRunMock.mockRejectedValue(err);
    getStateMock.mockReturnValue({
      status: 'running',
      runId: 'r',
      workflowId: 'wf',
      iterationByLoopId: {},
      scope: { 'node-1': { partial: true } },
      startedAt: 1000,
    });
    const out = await getRunStatus({ workflowId: 'wf', runId: 'r' });
    expect(out.status).toBe('running');
    expect(out.outputs).toEqual({ 'node-1': { partial: true } });
  });

  it('returns error when neither persisted nor in engine', async () => {
    getRunMock.mockRejectedValue(new Error('not found'));
    getStateMock.mockReturnValue({
      status: 'idle',
      iterationByLoopId: {},
      scope: {},
    });
    const out = await getRunStatus({ workflowId: 'wf', runId: 'r' });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/not found/i);
  });
});

describe('listRuns', () => {
  it('returns runs from the store', async () => {
    const summaries: RunSummary[] = [
      {
        runId: 'r1',
        workflowId: 'wf',
        workflowName: 'WF',
        status: 'succeeded',
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        eventCount: 0,
      },
    ];
    storeListRunsMock.mockResolvedValue(summaries);
    const out = await listRuns({ workflowId: 'wf' });
    expect(out.runs.length).toBe(1);
    expect(storeListRunsMock).toHaveBeenCalledWith('wf');
  });

  it('passes undefined workflowId for global listing', async () => {
    storeListRunsMock.mockResolvedValue([]);
    await listRuns({});
    expect(storeListRunsMock).toHaveBeenCalledWith(undefined);
  });
});

describe('cancelRun', () => {
  it('cancels when engine is running with matching runId', async () => {
    getStateMock.mockReturnValue({
      status: 'running',
      runId: 'r',
      workflowId: 'wf',
      iterationByLoopId: {},
      scope: {},
      startedAt: 1,
    });
    const out = await cancelRun({ workflowId: 'wf', runId: 'r' });
    expect(out.cancelled).toBe(true);
    expect(stopMock).toHaveBeenCalled();
  });

  it('returns cancelled:false when no run is active', async () => {
    getStateMock.mockReturnValue({ status: 'idle', iterationByLoopId: {}, scope: {} });
    const out = await cancelRun({ workflowId: 'wf', runId: 'r' });
    expect(out.cancelled).toBe(false);
    expect(out.reason).toMatch(/no run/i);
  });

  it('returns cancelled:false when runId does not match', async () => {
    getStateMock.mockReturnValue({
      status: 'running',
      runId: 'other-run',
      workflowId: 'wf',
      iterationByLoopId: {},
      scope: {},
      startedAt: 1,
    });
    const out = await cancelRun({ workflowId: 'wf', runId: 'r' });
    expect(out.cancelled).toBe(false);
    expect(out.reason).toMatch(/no longer tracked/i);
  });
});
