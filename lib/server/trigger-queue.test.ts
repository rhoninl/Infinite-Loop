import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TriggerQueue } from './trigger-queue';
import type { Workflow } from '../shared/workflow';

function fakeWorkflow(id: string): Workflow {
  return {
    id, name: id, version: 1,
    createdAt: 0, updatedAt: 0,
    nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  };
}

describe('TriggerQueue', () => {
  let started: Array<{ workflowId: string; runId: string }>;
  let engineBusy: boolean;
  let nextRunId: number;
  let q: TriggerQueue;

  beforeEach(() => {
    started = [];
    engineBusy = false;
    nextRunId = 0;

    q = new TriggerQueue({
      engineStart: async (wf) => {
        if (engineBusy) {
          throw new Error('a run is already active');
        }
        const runId = `run-${++nextRunId}`;
        started.push({ workflowId: wf.id, runId });
        return runId;
      },
      loadWorkflow: async (id) => fakeWorkflow(id),
      maxQueue: 3,
    });
  });

  afterEach(() => q.clear());

  test('enqueue returns sequential positions', () => {
    const a = q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    const b = q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 2,
    });
    expect(a.position).toBe(1);
    expect(b.position).toBe(2);
    expect(a.queueId).not.toBe(b.queueId);
  });

  test('drain pulls and starts when engine is idle', async () => {
    q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    await q.drain();
    expect(started).toHaveLength(1);
    expect(q.size()).toBe(0);
  });

  test('drain re-prepends on busy and waits', async () => {
    engineBusy = true;
    q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    await q.drain();
    expect(started).toHaveLength(0);
    expect(q.size()).toBe(1);

    engineBusy = false;
    await q.drain();
    expect(started).toHaveLength(1);
    expect(q.size()).toBe(0);
  });

  test('enqueue throws when at cap', () => {
    for (let i = 0; i < 3; i++) {
      q.enqueue({
        workflow: fakeWorkflow('w'), resolvedInputs: {},
        triggerId: 't', receivedAt: i,
      });
    }
    expect(() =>
      q.enqueue({
        workflow: fakeWorkflow('w'), resolvedInputs: {},
        triggerId: 't', receivedAt: 99,
      }),
    ).toThrow(/queue.*full|cap/i);
  });

  test('FIFO order', async () => {
    q.enqueue({
      workflow: fakeWorkflow('a'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    q.enqueue({
      workflow: fakeWorkflow('b'), resolvedInputs: {},
      triggerId: 't', receivedAt: 2,
    });
    await q.drain();
    await q.drain();
    expect(started.map((s) => s.workflowId)).toEqual(['a', 'b']);
  });

  test('drain calls touchLastFired after a successful engine start', async () => {
    const touched: string[] = [];
    const q2 = new TriggerQueue({
      engineStart: async (wf) => `run-${wf.id}`,
      loadWorkflow: async (id) => fakeWorkflow(id),
      touchLastFired: async (id) => { touched.push(id); },
    });
    q2.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 'tid-XYZ', receivedAt: 1,
    });
    await q2.drain();
    expect(touched).toEqual(['tid-XYZ']);
  });
});
