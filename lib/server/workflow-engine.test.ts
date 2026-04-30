import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type {
  EdgeHandle,
  NodeExecutor,
  Workflow,
  WorkflowEvent,
  WorkflowNode,
} from '../shared/workflow';

// Capture the real templating module up front; bun's `mock.module` is global
// to the test process and replaces live ESM bindings, so anything captured
// AFTER the mock would itself be the mock.
const realTemplating = { ...(await import('./templating')) };

mock.module('./templating', () => ({
  resolve: (text: string) => ({ text, warnings: [] }),
}));

const { WorkflowEngine } = await import('./workflow-engine');
const { eventBus } = await import('./event-bus');

afterAll(() => {
  // Restore the real module so other test files in the same Bun process see
  // the genuine implementation.
  mock.module('./templating', () => realTemplating);
});

function exec(branchByCall: EdgeHandle[], outputs: Record<string, unknown> = {}): NodeExecutor {
  let i = 0;
  return {
    async execute() {
      const branch = branchByCall[i] ?? branchByCall[branchByCall.length - 1];
      i++;
      return { outputs, branch };
    },
  };
}

function captureEvents(): { events: WorkflowEvent[]; off: () => void } {
  const events: WorkflowEvent[] = [];
  const off = eventBus.subscribe((e) => events.push(e));
  return { events, off };
}

const startNode: WorkflowNode = {
  id: 'start-1',
  type: 'start',
  position: { x: 0, y: 0 },
  config: {},
};
const endNode: WorkflowNode = {
  id: 'end-1',
  type: 'end',
  position: { x: 0, y: 0 },
  config: {},
};

describe('WorkflowEngine', () => {
  beforeEach(() => {
    eventBus.clear();
  });

  afterEach(() => {
    eventBus.clear();
  });

  it('runs a linear Start → Claude → End and settles succeeded', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    const wf: Workflow = {
      id: 'w1',
      name: 'lin',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, agent, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'agent-1' },
        { id: 'e2', source: 'agent-1', sourceHandle: 'next', target: 'end-1' },
      ],
    };
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: exec(['next'], { stdout: 'hello', exitCode: 0 }),
      condition: exec(['next']),
      loop: exec(['next']),
    });

    const { events } = captureEvents();
    await eng.start(wf);

    expect(eng.getState().status).toBe('succeeded');
    expect(eng.getState().scope['agent-1']).toEqual({ stdout: 'hello', exitCode: 0 });
    expect(events.find((e) => e.type === 'run_started')).toBeTruthy();
    expect(events.find((e) => e.type === 'run_finished' && (e as { status: string }).status === 'succeeded')).toBeTruthy();
  });

  it('routes a Condition met branch to End and not_met branch back', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    const cond: WorkflowNode = {
      id: 'cond-1',
      type: 'condition',
      position: { x: 0, y: 0 },
      config: { kind: 'sentinel', sentinel: { pattern: 'X', isRegex: false } },
    };
    const wf: Workflow = {
      id: 'w2',
      name: 'cond',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, agent, cond, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'agent-1' },
        { id: 'e2', source: 'agent-1', sourceHandle: 'next', target: 'cond-1' },
        { id: 'e3', source: 'cond-1', sourceHandle: 'met', target: 'end-1' },
      ],
    };
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: exec(['next']),
      condition: exec(['met'], { met: true, detail: 'matched' }),
      loop: exec(['next']),
    });
    await eng.start(wf);
    expect(eng.getState().status).toBe('succeeded');
    expect(eng.getState().scope['cond-1']).toEqual({ met: true, detail: 'matched' });
  });

  it('walks a Loop body until the condition fires break (met)', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    const cond: WorkflowNode = {
      id: 'cond-1',
      type: 'condition',
      position: { x: 0, y: 0 },
      config: { kind: 'sentinel', sentinel: { pattern: 'X', isRegex: false } },
    };
    const loop: WorkflowNode = {
      id: 'loop-1',
      type: 'loop',
      position: { x: 0, y: 0 },
      config: { maxIterations: 5, mode: 'while-not-met' },
      children: [agent, cond],
    };
    const wf: Workflow = {
      id: 'w3',
      name: 'loop',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, loop, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', sourceHandle: 'next', target: 'end-1' },
        { id: 'e3', source: 'agent-1', sourceHandle: 'next', target: 'cond-1' },
        // Condition has no edges: met → fall back to break, not_met → continue.
      ],
    };
    // condition emits not_met twice, then met on the third iteration
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: exec(['next', 'next', 'next']),
      condition: exec(['not_met', 'not_met', 'met']),
      loop: exec(['next']),
    });
    await eng.start(wf);
    expect(eng.getState().status).toBe('succeeded');
    expect(eng.getState().iterationByLoopId['loop-1']).toBe(3);
  });

  it('caps iterations at maxIterations and falls through past the loop', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    const cond: WorkflowNode = {
      id: 'cond-1',
      type: 'condition',
      position: { x: 0, y: 0 },
      config: { kind: 'sentinel', sentinel: { pattern: 'X', isRegex: false } },
    };
    const loop: WorkflowNode = {
      id: 'loop-1',
      type: 'loop',
      position: { x: 0, y: 0 },
      config: { maxIterations: 2, mode: 'while-not-met' },
      children: [agent, cond],
    };
    const wf: Workflow = {
      id: 'w4',
      name: 'cap',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, loop, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', sourceHandle: 'next', target: 'end-1' },
        { id: 'e3', source: 'agent-1', sourceHandle: 'next', target: 'cond-1' },
      ],
    };
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: exec(['next', 'next', 'next']),
      condition: exec(['not_met', 'not_met', 'not_met']),
      loop: exec(['next']),
    });
    await eng.start(wf);
    expect(eng.getState().status).toBe('succeeded');
    expect(eng.getState().iterationByLoopId['loop-1']).toBe(2);
  });

  it('ignores maxIterations when infinite: true and exits via break', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    const cond: WorkflowNode = {
      id: 'cond-1',
      type: 'condition',
      position: { x: 0, y: 0 },
      config: { kind: 'sentinel', sentinel: { pattern: 'X', isRegex: false } },
    };
    // Tiny cap, but infinite: true should override it.
    const loop: WorkflowNode = {
      id: 'loop-1',
      type: 'loop',
      position: { x: 0, y: 0 },
      config: { maxIterations: 2, mode: 'while-not-met', infinite: true },
      children: [agent, cond],
    };
    const wf: Workflow = {
      id: 'w-inf',
      name: 'inf',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, loop, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', sourceHandle: 'next', target: 'end-1' },
        { id: 'e3', source: 'agent-1', sourceHandle: 'next', target: 'cond-1' },
      ],
    };
    // 7× not_met then met → 8 iterations, well past maxIterations=2.
    const condBranches: EdgeHandle[] = [
      'not_met', 'not_met', 'not_met', 'not_met',
      'not_met', 'not_met', 'not_met', 'met',
    ];
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: exec(['next']),
      condition: exec(condBranches),
      loop: exec(['next']),
    });
    await eng.start(wf);
    expect(eng.getState().status).toBe('succeeded');
    expect(eng.getState().iterationByLoopId['loop-1']).toBe(8);
  });

  it('infinite Loop blows past maxIterations and cancels via stop()', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    // maxIterations: 1 — without infinite, would settle after a single iteration.
    const loop: WorkflowNode = {
      id: 'loop-1',
      type: 'loop',
      position: { x: 0, y: 0 },
      config: { maxIterations: 1, mode: 'unbounded', infinite: true },
      children: [agent],
    };
    const wf: Workflow = {
      id: 'w-inf-cancel',
      name: 'inf-cancel',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, loop, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', sourceHandle: 'next', target: 'end-1' },
      ],
    };

    // Agent self-stops the engine on the 5th call. If the cap were honored
    // we'd never reach the 5th call (only one iteration).
    let calls = 0;
    let engRef: { stop: () => void } | null = null;
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: {
        async execute() {
          calls++;
          if (calls === 5) engRef!.stop();
          return { branch: 'next' as EdgeHandle, outputs: {} };
        },
      },
      condition: exec(['next']),
      loop: exec(['next']),
    });
    engRef = eng;

    await eng.start(wf);

    expect(eng.getState().status).toBe('cancelled');
    expect(eng.getState().iterationByLoopId['loop-1']).toBe(5);
  });

  it('infinite Loop terminates when its body hits an end node', async () => {
    const innerEnd: WorkflowNode = {
      id: 'end-inner',
      type: 'end',
      position: { x: 0, y: 0 },
      config: { outcome: 'succeeded' },
    };
    const loop: WorkflowNode = {
      id: 'loop-1',
      type: 'loop',
      position: { x: 0, y: 0 },
      config: { maxIterations: 1, mode: 'unbounded', infinite: true },
      children: [innerEnd],
    };
    const wf: Workflow = {
      id: 'w-inf-end',
      name: 'inf-end',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, loop, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', sourceHandle: 'next', target: 'end-1' },
      ],
    };
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: exec(['next']),
      condition: exec(['next']),
      loop: exec(['next']),
    });
    await eng.start(wf);
    expect(eng.getState().status).toBe('succeeded');
  });

  it('settles failed when an executor returns the error branch with no handler', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    const wf: Workflow = {
      id: 'w5',
      name: 'err',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, agent, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'agent-1' },
        { id: 'e2', source: 'agent-1', sourceHandle: 'next', target: 'end-1' },
      ],
    };
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: exec(['error'], { errorMessage: 'boom' }),
      condition: exec(['next']),
      loop: exec(['next']),
    });
    await eng.start(wf);
    expect(eng.getState().status).toBe('failed');
  });

  it('cancels mid-run when stop() is called', async () => {
    const agent: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { prompt: 'p', cwd: '/tmp', timeoutMs: 1000 },
    };
    const wf: Workflow = {
      id: 'w6',
      name: 'cancel',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, agent, endNode],
      edges: [
        { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'agent-1' },
        { id: 'e2', source: 'agent-1', sourceHandle: 'next', target: 'end-1' },
      ],
    };
    let resolveExec: ((value: { branch: EdgeHandle; outputs: Record<string, unknown> }) => void) | null = null;
    const eng = new WorkflowEngine({
      start: exec(['next']),
      end: exec(['next']),
      agent: {
        execute: () =>
          new Promise<{ branch: EdgeHandle; outputs: Record<string, unknown> }>((resolve) => {
            resolveExec = resolve;
          }),
      },
      condition: exec(['next']),
      loop: exec(['next']),
    });

    const runPromise = eng.start(wf);
    await new Promise((r) => setTimeout(r, 20));
    eng.stop();
    resolveExec!({ branch: 'next', outputs: {} });
    await runPromise;

    expect(eng.getState().status).toBe('cancelled');
  });

  it('rejects start when a run is already active', async () => {
    const wf: Workflow = {
      id: 'w7',
      name: 'busy',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [startNode, endNode],
      edges: [{ id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'end-1' }],
    };
    let release: (() => void) | null = null;
    const eng = new WorkflowEngine({
      start: {
        execute: () =>
          new Promise<{ branch: EdgeHandle; outputs: Record<string, unknown> }>((resolve) => {
            release = () => resolve({ branch: 'next', outputs: {} });
          }),
      },
      end: exec(['next']),
      agent: exec(['next']),
      condition: exec(['next']),
      loop: exec(['next']),
    });
    const first = eng.start(wf);
    await new Promise((r) => setTimeout(r, 5));
    await expect(eng.start(wf)).rejects.toThrow(/already active/);
    release!();
    await first;
  });
});
