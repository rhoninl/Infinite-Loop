import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type {
  EdgeHandle,
  NodeExecutor,
  Workflow,
  WorkflowNode,
} from '../shared/workflow';

// Capture the real modules first so the mocks can be reverted at file end.
// bun's `mock.module` is global to the test process, so anything captured
// AFTER the mock call would itself be the mock.
const realTemplating = { ...(await import('./templating')) };
const realRunStore = { ...(await import('./run-store')) };

mock.module('./templating', () => ({
  resolve: (text: string) => ({ text, warnings: [] }),
}));
mock.module('./run-store', () => ({
  saveRun: async () => undefined,
  historyLimit: () => 100,
  listRuns: async () => [],
  getRun: async () => {
    throw new Error('run not found');
  },
}));

const { engineStartAdapter, triggerQueue } = await import('./trigger-queue-singleton');
const { WorkflowEngine } = await import('./workflow-engine');

afterAll(() => {
  mock.module('./templating', () => realTemplating);
  mock.module('./run-store', () => realRunStore);
});

describe('triggerQueue singleton', () => {
  test('exists and exposes the TriggerQueue interface', () => {
    expect(typeof triggerQueue.enqueue).toBe('function');
    expect(typeof triggerQueue.drain).toBe('function');
    expect(typeof triggerQueue.size).toBe('function');
  });
});

describe('engineStartAdapter', () => {
  const startNode: WorkflowNode = {
    id: 'start-1', type: 'start', position: { x: 0, y: 0 }, config: {},
  };
  const wf: Workflow = {
    id: 'w-adapter',
    name: 'adapter-test',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    nodes: [startNode],
    edges: [],
  };

  function hangingExecutor(): { exec: NodeExecutor; release: () => void } {
    let resolve: ((v: { branch: EdgeHandle; outputs: Record<string, unknown> }) => void) | null =
      null;
    const exec: NodeExecutor = {
      execute: () =>
        new Promise((r) => {
          resolve = r;
        }),
    };
    return {
      exec,
      release: () => resolve?.({ branch: 'next', outputs: {} }),
    };
  }

  test('returns a freshly-assigned runId on the idle path', async () => {
    const { exec, release } = hangingExecutor();
    const engine = new WorkflowEngine({ start: exec });

    expect(engine.getState().status).toBe('idle');
    const runId = await engineStartAdapter(engine, wf, { resolvedInputs: {} });

    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    expect(engine.getState().status).toBe('running');
    expect(engine.getState().runId).toBe(runId);

    // Let the in-flight run finish so we don't leak a pending promise.
    release();
    // Give the engine a tick to settle.
    await new Promise((r) => setTimeout(r, 5));
  });

  test('rejects with busy error when a run is already active (does NOT return the stale runId)', async () => {
    const { exec, release } = hangingExecutor();
    const engine = new WorkflowEngine({ start: exec });

    // Kick off the first run; it will park inside the hanging start executor.
    void engine.start(wf).catch(() => {});
    // engine.start sets status='running' synchronously before its first await,
    // but the executor await happens via walkFrom → executeNode. Yield once so
    // the snapshot reflects the running state without leaving the hang.
    await Promise.resolve();
    expect(engine.getState().status).toBe('running');
    const inFlightRunId = engine.getState().runId;

    // Now the adapter must REJECT, not return inFlightRunId. The pre-fix bug
    // was: void-kick swallowed the busy throw, and getState().runId returned
    // the in-flight run's id — drain() then dropped the queued item.
    await expect(
      engineStartAdapter(engine, wf, { resolvedInputs: {} }),
    ).rejects.toThrow(/already active|busy/i);

    // The in-flight runId must not have changed (no spurious side effect).
    expect(engine.getState().runId).toBe(inFlightRunId);

    release();
    await new Promise((r) => setTimeout(r, 5));
  });
});
