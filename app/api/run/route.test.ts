import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSnapshot, Workflow } from '@/lib/shared/workflow';

vi.mock('@/lib/server/workflow-engine', () => ({
  workflowEngine: {
    start: vi.fn(),
    stop: vi.fn(),
    getState: vi.fn(),
  },
}));

vi.mock('@/lib/server/workflow-store', () => ({
  getWorkflow: vi.fn(),
}));

const { workflowEngine } = await import('@/lib/server/workflow-engine');
const { getWorkflow } = await import('@/lib/server/workflow-store');
const { POST, GET } = await import('./route');
const { POST: STOP } = await import('./stop/route');

const idleState: RunSnapshot = {
  status: 'idle',
  iterationByLoopId: {},
  scope: {},
};
const runningState: RunSnapshot = {
  status: 'running',
  iterationByLoopId: {},
  scope: {},
  workflowId: 'wf-1',
  startedAt: 1,
};

const sampleWorkflow: Workflow = {
  id: 'wf-1',
  name: 'sample',
  version: 1,
  nodes: [
    { id: 'start-1', type: 'start', position: { x: 0, y: 0 }, config: {} },
    {
      id: 'end-1',
      type: 'end',
      position: { x: 0, y: 0 },
      config: { outcome: 'succeeded' },
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'start-1',
      sourceHandle: 'next',
      target: 'end-1',
    },
  ],
  createdAt: 0,
  updatedAt: 0,
};

const startMock = vi.mocked(workflowEngine.start);
const stopMock = vi.mocked(workflowEngine.stop);
const getStateMock = vi.mocked(workflowEngine.getState);
const getWorkflowMock = vi.mocked(getWorkflow);

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string): Request {
  return new Request('http://localhost/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  startMock.mockReset();
  stopMock.mockReset();
  getStateMock.mockReset();
  getWorkflowMock.mockReset();
  startMock.mockResolvedValue(undefined);
});

describe('POST /api/run', () => {
  it('starts the engine and returns 202 with state when idle', async () => {
    getWorkflowMock.mockResolvedValue(sampleWorkflow);
    getStateMock.mockReturnValue(idleState);

    const res = await POST(jsonRequest({ workflowId: 'wf-1' }));

    expect(res.status).toBe(202);
    const body = (await res.json()) as { state: RunSnapshot };
    expect(body.state).toEqual(idleState);
    expect(getWorkflowMock).toHaveBeenCalledWith('wf-1');
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(sampleWorkflow);
  });

  it('returns 400 when body is invalid JSON', async () => {
    const res = await POST(rawRequest('not-json{'));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/json|workflowId/i);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 400 when workflowId is missing or not a string', async () => {
    const res1 = await POST(jsonRequest({}));
    expect(res1.status).toBe(400);

    const res2 = await POST(jsonRequest({ workflowId: 123 }));
    expect(res2.status).toBe(400);

    const res3 = await POST(jsonRequest({ workflowId: '' }));
    expect(res3.status).toBe(400);

    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the workflow is not found', async () => {
    getWorkflowMock.mockRejectedValue(new Error('not found'));
    getStateMock.mockReturnValue(idleState);

    const res = await POST(jsonRequest({ workflowId: 'missing' }));

    expect(res.status).toBe(404);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 409 when a run is already active', async () => {
    getWorkflowMock.mockResolvedValue(sampleWorkflow);
    getStateMock.mockReturnValue(runningState);

    const res = await POST(jsonRequest({ workflowId: 'wf-1' }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('a run is already active');
    expect(startMock).not.toHaveBeenCalled();
  });

  it('does not propagate engine.start rejections back to the caller', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getWorkflowMock.mockResolvedValue(sampleWorkflow);
    getStateMock.mockReturnValue(idleState);
    startMock.mockRejectedValue(new Error('boom'));

    const res = await POST(jsonRequest({ workflowId: 'wf-1' }));

    expect(res.status).toBe(202);
    // Allow the caught microtask to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('GET /api/run', () => {
  it('returns 200 with the engine state', async () => {
    getStateMock.mockReturnValue(idleState);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: RunSnapshot };
    expect(body.state).toEqual(idleState);
  });
});

describe('POST /api/run/stop', () => {
  it('calls engine.stop and returns 200 with state', async () => {
    getStateMock.mockReturnValue(idleState);

    const res = await STOP();

    expect(res.status).toBe(200);
    expect(stopMock).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { state: RunSnapshot };
    expect(body.state).toEqual(idleState);
  });
});
