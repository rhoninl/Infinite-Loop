import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { WorkflowEvent } from '@/lib/shared/workflow';

// Capture originals before mocking.
const realEngine = { ...(await import('@/lib/server/workflow-engine')) };
const realEventBus = { ...(await import('@/lib/server/event-bus')) };
const realRunStore = { ...(await import('@/lib/server/run-store')) };
const realWorkflowStore = { ...(await import('@/lib/server/workflow-store')) };

// A minimal event bus for testing.
class FakeEventBus {
  private subs = new Set<(ev: WorkflowEvent) => void>();
  subscribe(handler: (ev: WorkflowEvent) => void) {
    this.subs.add(handler);
    return () => this.subs.delete(handler);
  }
  emit(ev: WorkflowEvent) {
    for (const s of this.subs) s(ev);
  }
}
const fakeEventBus = new FakeEventBus();

mock.module('@/lib/server/event-bus', () => ({
  eventBus: fakeEventBus,
}));
mock.module('@/lib/server/workflow-engine', () => ({
  workflowEngine: {
    getState: mock(),
    start: mock(),
  },
}));
mock.module('@/lib/server/run-store', () => ({
  getRun: mock(),
}));
mock.module('@/lib/server/workflow-store', () => ({
  getWorkflow: mock(),
}));

const { workflowEngine } = await import('@/lib/server/workflow-engine');
const { getRun } = await import('@/lib/server/run-store');
const { getWorkflow } = await import('@/lib/server/workflow-store');
const { runWorkflowTool } = await import('./run-tool');

afterAll(() => {
  mock.module('@/lib/server/workflow-engine', () => realEngine);
  mock.module('@/lib/server/event-bus', () => realEventBus);
  mock.module('@/lib/server/run-store', () => realRunStore);
  mock.module('@/lib/server/workflow-store', () => realWorkflowStore);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = ReturnType<typeof mock<(...args: any[]) => any>>;
const getStateMock = workflowEngine.getState as unknown as AnyMock;
const startMock = workflowEngine.start as unknown as AnyMock;
const getRunMock = getRun as unknown as AnyMock;
const getWorkflowMock = getWorkflow as unknown as AnyMock;

const minimalWorkflow = {
  id: 'wf',
  name: 'WF',
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  nodes: [],
  edges: [],
  inputs: [],
};

beforeEach(() => {
  getStateMock.mockReset();
  startMock.mockReset();
  getRunMock.mockReset();
  getWorkflowMock.mockReset();
});

describe('runWorkflowTool', () => {
  it('returns filtered outputs on a successful settle (persisted)', async () => {
    getWorkflowMock.mockResolvedValue(minimalWorkflow);
    // First call: idle (for busy check); second call: running with runId.
    getStateMock
      .mockReturnValueOnce({ status: 'idle', iterationByLoopId: {}, scope: {} })
      .mockReturnValueOnce({
        status: 'running',
        runId: 'r1',
        workflowId: 'wf',
        iterationByLoopId: {},
        scope: {},
        startedAt: 1000,
      });

    startMock.mockImplementation(async () => {
      // Emit the settle event after a tick so subscribers are registered.
      await Promise.resolve();
      fakeEventBus.emit({
        type: 'run_finished',
        status: 'succeeded',
        scope: { inputs: { hidden: 1 }, 'node-1': { result: 'ok' } },
      });
    });

    getRunMock.mockResolvedValue({
      runId: 'r1',
      workflowId: 'wf',
      workflowName: 'WF',
      status: 'succeeded',
      startedAt: 1000,
      finishedAt: 2000,
      durationMs: 1000,
      scope: { inputs: { hidden: 1 }, 'node-1': { result: 'ok' } },
      events: [],
    });

    const out = await runWorkflowTool({ workflowId: 'wf', inputs: {}, timeoutMs: 5000 });
    expect(out.status).toBe('succeeded');
    expect(out.runId).toBe('r1');
    expect(out.outputs).toEqual({ 'node-1': { result: 'ok' } });
  });

  it('returns filtered outputs from settle event when run-store not yet persisted', async () => {
    getWorkflowMock.mockResolvedValue(minimalWorkflow);
    getStateMock
      .mockReturnValueOnce({ status: 'idle', iterationByLoopId: {}, scope: {} })
      .mockReturnValueOnce({
        status: 'running',
        runId: 'r2',
        workflowId: 'wf',
        iterationByLoopId: {},
        scope: {},
        startedAt: 1000,
      })
      .mockReturnValue({
        status: 'succeeded',
        runId: 'r2',
        workflowId: 'wf',
        iterationByLoopId: {},
        scope: { 'node-1': { result: 'ok' } },
        startedAt: 1000,
        finishedAt: 2000,
      });

    startMock.mockImplementation(async () => {
      await Promise.resolve();
      fakeEventBus.emit({
        type: 'run_finished',
        status: 'succeeded',
        scope: { 'node-1': { result: 'ok' } },
      });
    });

    // Simulate not yet persisted.
    getRunMock.mockRejectedValue(new Error('run not found'));

    const out = await runWorkflowTool({ workflowId: 'wf', inputs: {}, timeoutMs: 5000 });
    expect(out.status).toBe('succeeded');
    expect(out.runId).toBe('r2');
    expect(out.outputs).toEqual({ 'node-1': { result: 'ok' } });
  });

  it('returns error when engine is busy', async () => {
    getWorkflowMock.mockResolvedValue(minimalWorkflow);
    getStateMock.mockReturnValue({
      status: 'running',
      runId: 'other',
      workflowId: 'wf-other',
      iterationByLoopId: {},
      scope: {},
      startedAt: 1,
    });

    const out = await runWorkflowTool({ workflowId: 'wf', inputs: {}, timeoutMs: 5000 });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/busy/i);
    expect(out.error).toContain('other');
  });

  it('returns timeout result with runId for later polling', async () => {
    getWorkflowMock.mockResolvedValue(minimalWorkflow);
    getStateMock
      .mockReturnValueOnce({ status: 'idle', iterationByLoopId: {}, scope: {} })
      .mockReturnValue({
        status: 'running',
        runId: 'r3',
        workflowId: 'wf',
        iterationByLoopId: {},
        scope: {},
        startedAt: 1000,
      });

    // start() hangs — never emits run_finished.
    startMock.mockImplementation(() => new Promise(() => {}));

    const out = await runWorkflowTool({ workflowId: 'wf', inputs: {}, timeoutMs: 10 });
    expect(out.status).toBe('timeout');
    expect(out.runId).toBe('r3');
    expect(out.error).toContain('r3');
  }, 3000);

  it('returns error for invalid inputs', async () => {
    getWorkflowMock.mockResolvedValue({
      ...minimalWorkflow,
      inputs: [{ name: 'pr_url', type: 'string' }],
    });
    getStateMock.mockReturnValue({ status: 'idle', iterationByLoopId: {}, scope: {} });

    const out = await runWorkflowTool({ workflowId: 'wf', inputs: {}, timeoutMs: 5000 });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/pr_url/);
    expect(out.error).toMatch(/required/);
  });
});
