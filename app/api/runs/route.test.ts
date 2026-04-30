import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  type Mock,
} from 'bun:test';
import type { RunRecord, RunSummary } from '@/lib/shared/workflow';

// Snapshot the real module before mocking so afterAll can re-publish it —
// bun:test's mock.module persists for the rest of the process.
const realStore = { ...(await import('@/lib/server/run-store')) };

mock.module('@/lib/server/run-store', () => ({
  listRuns: mock(),
  getRun: mock(),
  historyLimit: () => 100,
}));

import * as store from '@/lib/server/run-store';
import { GET as listGET } from './route';
import { GET as itemGET } from './[workflowId]/[runId]/route';

afterAll(() => {
  mock.module('@/lib/server/run-store', () => realStore);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<(...args: any[]) => any>;
const mocked = store as unknown as {
  listRuns: AnyMock;
  getRun: AnyMock;
};

const sampleSummary: RunSummary = {
  runId: 'r-1',
  workflowId: 'wf-1',
  workflowName: 'A',
  status: 'succeeded',
  startedAt: 1,
  finishedAt: 2,
  durationMs: 1,
  eventCount: 0,
};

const sampleRecord: RunRecord = {
  ...sampleSummary,
  scope: {},
  events: [],
};

beforeEach(() => {
  mocked.listRuns.mockReset();
  mocked.getRun.mockReset();
});

function paramsCtx(workflowId: string, runId: string) {
  return { params: Promise.resolve({ workflowId, runId }) };
}

describe('GET /api/runs', () => {
  it('returns 200 with all runs when no workflowId is given', async () => {
    mocked.listRuns.mockResolvedValueOnce([sampleSummary]);
    const res = await listGET(new Request('http://localhost/api/runs'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: RunSummary[] };
    expect(body.runs).toEqual([sampleSummary]);
    expect(mocked.listRuns).toHaveBeenCalledWith(undefined);
  });

  it('passes workflowId through to listRuns when provided', async () => {
    mocked.listRuns.mockResolvedValueOnce([]);
    await listGET(new Request('http://localhost/api/runs?workflowId=wf-1'));
    expect(mocked.listRuns).toHaveBeenCalledWith('wf-1');
  });

  it('treats an empty workflowId param as "no filter"', async () => {
    mocked.listRuns.mockResolvedValueOnce([]);
    await listGET(new Request('http://localhost/api/runs?workflowId='));
    expect(mocked.listRuns).toHaveBeenCalledWith(undefined);
  });

  it('returns 500 when listRuns throws', async () => {
    mocked.listRuns.mockRejectedValueOnce(new Error('disk on fire'));
    const res = await listGET(new Request('http://localhost/api/runs'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/disk on fire/);
  });
});

describe('GET /api/runs/[workflowId]/[runId]', () => {
  it('returns 200 with the run record', async () => {
    mocked.getRun.mockResolvedValueOnce(sampleRecord);
    const res = await itemGET(
      new Request('http://localhost/api/runs/wf-1/r-1'),
      paramsCtx('wf-1', 'r-1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: RunRecord };
    expect(body.run).toEqual(sampleRecord);
    expect(mocked.getRun).toHaveBeenCalledWith('wf-1', 'r-1');
  });

  it('returns 404 when getRun says not found', async () => {
    mocked.getRun.mockRejectedValueOnce(
      new Error('run not found: wf-1/missing'),
    );
    const res = await itemGET(
      new Request('http://localhost/api/runs/wf-1/missing'),
      paramsCtx('wf-1', 'missing'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 500 on other errors', async () => {
    mocked.getRun.mockRejectedValueOnce(new Error('disk read failed'));
    const res = await itemGET(
      new Request('http://localhost/api/runs/wf-1/r-1'),
      paramsCtx('wf-1', 'r-1'),
    );
    expect(res.status).toBe(500);
  });
});
