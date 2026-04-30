import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import FakeTimers, { type InstalledClock } from '@sinonjs/fake-timers';
import type { Workflow, WorkflowNode } from '../shared/workflow';
import {
  HISTORY_COALESCE_MS,
  HISTORY_LIMIT,
  useWorkflowStore,
} from './workflow-store-client';

function makeWorkflow(): Workflow {
  const loop: WorkflowNode = {
    id: 'loop-1',
    type: 'loop',
    position: { x: 0, y: 0 },
    config: { maxIterations: 5, mode: 'while-not-met' },
    children: [],
  };
  const start: WorkflowNode = {
    id: 'start-1',
    type: 'start',
    position: { x: 0, y: 0 },
    config: {},
  };
  return {
    id: 'wf',
    name: 'WF',
    version: 1,
    nodes: [start, loop],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  useWorkflowStore.setState({
    currentWorkflow: null,
    isDirty: false,
    selectedNodeId: null,
    runStatus: 'idle',
    runEvents: [],
    connectionStatus: 'connecting',
    past: [],
    future: [],
  });
});

describe('addChildNode', () => {
  it('appends a child to the matching Loop and marks the workflow dirty', () => {
    const wf = makeWorkflow();
    useWorkflowStore.getState().loadWorkflow(wf);

    const child: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 20, y: 30 },
      config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
    };

    useWorkflowStore.getState().addChildNode('loop-1', child);

    const next = useWorkflowStore.getState().currentWorkflow!;
    const loop = next.nodes.find((n) => n.id === 'loop-1')!;
    expect(loop.children).toHaveLength(1);
    expect(loop.children![0].id).toBe('agent-1');
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });

  it('preserves existing children when appending', () => {
    const wf = makeWorkflow();
    const loop = wf.nodes.find((n) => n.id === 'loop-1')!;
    loop.children = [
      {
        id: 'existing',
        type: 'agent',
        position: { x: 0, y: 0 },
        config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
      },
    ];
    useWorkflowStore.getState().loadWorkflow(wf);

    const child: WorkflowNode = {
      id: 'agent-2',
      type: 'agent',
      position: { x: 20, y: 30 },
      config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
    };

    useWorkflowStore.getState().addChildNode('loop-1', child);

    const next = useWorkflowStore.getState().currentWorkflow!;
    const updatedLoop = next.nodes.find((n) => n.id === 'loop-1')!;
    expect(updatedLoop.children!.map((c) => c.id)).toEqual([
      'existing',
      'agent-2',
    ]);
  });

  it('no-ops when the parent id does not match any top-level node', () => {
    const wf = makeWorkflow();
    useWorkflowStore.getState().loadWorkflow(wf);

    const child: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
    };

    useWorkflowStore.getState().addChildNode('does-not-exist', child);

    const next = useWorkflowStore.getState().currentWorkflow!;
    const loop = next.nodes.find((n) => n.id === 'loop-1')!;
    expect(loop.children).toHaveLength(0);
  });
});

describe('undo / redo', () => {
  // Fake timers so we can step past the coalesce window deterministically.
  let clock: InstalledClock;
  beforeEach(() => {
    clock = FakeTimers.install({ now: 1_000_000 });
  });
  afterEach(() => {
    clock.uninstall();
  });

  function loadFresh(): Workflow {
    const wf = makeWorkflow();
    useWorkflowStore.getState().loadWorkflow(wf);
    return wf;
  }

  function step() {
    // Push the clock past the coalesce window so the next mutation is treated
    // as a new gesture, not a continuation.
    clock.tick(HISTORY_COALESCE_MS + 1);
  }

  it('undo restores the prior workflow snapshot', () => {
    loadFresh();
    step();
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 50, y: 60 } });
    expect(useWorkflowStore.getState().past).toHaveLength(1);

    useWorkflowStore.getState().undo();

    const wf = useWorkflowStore.getState().currentWorkflow!;
    expect(wf.nodes.find((n) => n.id === 'start-1')!.position).toEqual({ x: 0, y: 0 });
    expect(useWorkflowStore.getState().past).toHaveLength(0);
    expect(useWorkflowStore.getState().future).toHaveLength(1);
  });

  it('redo replays the snapshot popped by undo', () => {
    loadFresh();
    step();
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 50, y: 60 } });
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().future).toHaveLength(1);

    useWorkflowStore.getState().redo();

    const wf = useWorkflowStore.getState().currentWorkflow!;
    expect(wf.nodes.find((n) => n.id === 'start-1')!.position).toEqual({ x: 50, y: 60 });
    expect(useWorkflowStore.getState().future).toHaveLength(0);
  });

  it('any new mutation after undo wipes the redo stack', () => {
    loadFresh();
    step();
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 50, y: 60 } });
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().future).toHaveLength(1);

    step();
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 99, y: 99 } });

    expect(useWorkflowStore.getState().future).toHaveLength(0);
  });

  it('rapid mutations within the coalesce window collapse to one entry', () => {
    loadFresh();
    step();
    // Three position updates inside the same coalesce window — drag-like burst.
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 1, y: 1 } });
    clock.tick(50);
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 2, y: 2 } });
    clock.tick(50);
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 3, y: 3 } });

    expect(useWorkflowStore.getState().past).toHaveLength(1);

    useWorkflowStore.getState().undo();
    const wf = useWorkflowStore.getState().currentWorkflow!;
    // Undo should jump back to the pre-burst state, not to an intermediate value.
    expect(wf.nodes.find((n) => n.id === 'start-1')!.position).toEqual({ x: 0, y: 0 });
  });

  it('loadWorkflow resets both history stacks', () => {
    loadFresh();
    step();
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 7, y: 7 } });
    expect(useWorkflowStore.getState().past).toHaveLength(1);

    loadFresh();

    expect(useWorkflowStore.getState().past).toHaveLength(0);
    expect(useWorkflowStore.getState().future).toHaveLength(0);
  });

  it('caps the past stack at HISTORY_LIMIT entries', () => {
    loadFresh();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      step();
      useWorkflowStore.getState().updateNode('start-1', { position: { x: i, y: i } });
    }
    expect(useWorkflowStore.getState().past).toHaveLength(HISTORY_LIMIT);
  });

  it('undo / redo are no-ops on empty stacks', () => {
    loadFresh();
    const before = useWorkflowStore.getState().currentWorkflow;

    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().currentWorkflow).toBe(before);

    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().currentWorkflow).toBe(before);
  });

  it('coalesce window slides — a long drag of sub-window ticks stays one entry', () => {
    loadFresh();
    step();
    // First push lands. Subsequent updates each 200ms apart (under the 250ms
    // window relative to the *previous* push, but >250ms from the original).
    // With a sliding window every tick advances the marker, so they all
    // coalesce into the single original entry.
    useWorkflowStore.getState().updateNode('start-1', { position: { x: 1, y: 1 } });
    for (let i = 2; i <= 10; i++) {
      clock.tick(200);
      useWorkflowStore.getState().updateNode('start-1', { position: { x: i, y: i } });
    }
    expect(useWorkflowStore.getState().past).toHaveLength(1);
  });

  it('every content-changing mutation pushes to past', () => {
    loadFresh();
    const start = () => useWorkflowStore.getState();

    step();
    start().setNodes([...start().currentWorkflow!.nodes]);
    expect(start().past).toHaveLength(1);

    step();
    start().setEdges([]);
    expect(start().past).toHaveLength(2);

    step();
    start().addNode({
      id: 'agent-x',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
    });
    expect(start().past).toHaveLength(3);

    step();
    start().addChildNode('loop-1', {
      id: 'agent-child',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
    });
    expect(start().past).toHaveLength(4);

    step();
    start().addEdge({
      id: 'e-x',
      source: 'start-1',
      sourceHandle: 'next',
      target: 'agent-x',
    });
    expect(start().past).toHaveLength(5);

    step();
    start().removeEdge('e-x');
    expect(start().past).toHaveLength(6);

    step();
    start().removeNode('agent-x');
    expect(start().past).toHaveLength(7);
  });

  it('undo restores edges that were cascade-removed alongside a node', () => {
    loadFresh();
    useWorkflowStore.getState().addEdge({
      id: 'e1',
      source: 'start-1',
      sourceHandle: 'next',
      target: 'loop-1',
    });
    expect(useWorkflowStore.getState().currentWorkflow!.edges).toHaveLength(1);

    step();
    useWorkflowStore.getState().removeNode('loop-1');
    const afterRemove = useWorkflowStore.getState().currentWorkflow!;
    expect(afterRemove.nodes.find((n) => n.id === 'loop-1')).toBeUndefined();
    expect(afterRemove.edges).toHaveLength(0);

    useWorkflowStore.getState().undo();
    const restored = useWorkflowStore.getState().currentWorkflow!;
    expect(restored.nodes.find((n) => n.id === 'loop-1')).toBeDefined();
    expect(restored.edges).toEqual([
      { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'loop-1' },
    ]);
  });

  it('redo clears selection if the redone snapshot drops the selected node', () => {
    loadFresh();
    // Add then select a new node.
    step();
    useWorkflowStore.getState().addNode({
      id: 'agent-r',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
    });
    useWorkflowStore.setState({ selectedNodeId: 'agent-r' });

    // Remove it — the snapshot pushed onto `past` here is the WITH-agent-r one.
    step();
    useWorkflowStore.getState().removeNode('agent-r');
    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();

    // Undo: agent-r returns. Re-select it.
    useWorkflowStore.getState().undo();
    useWorkflowStore.setState({ selectedNodeId: 'agent-r' });

    // Redo: agent-r vanishes again — selection should clear.
    useWorkflowStore.getState().redo();
    expect(
      useWorkflowStore.getState().currentWorkflow!.nodes.find((n) => n.id === 'agent-r'),
    ).toBeUndefined();
    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });

  it('undo clears selection if the selected node no longer exists in the snapshot', () => {
    loadFresh();
    useWorkflowStore.setState({ selectedNodeId: 'agent-new' });

    step();
    const newAgent: WorkflowNode = {
      id: 'agent-new',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { providerId: 'claude', prompt: '', cwd: '', timeoutMs: 60000 },
    };
    useWorkflowStore.getState().addNode(newAgent);

    useWorkflowStore.getState().undo();

    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });
});
