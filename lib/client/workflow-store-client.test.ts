import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '../shared/workflow';
import { useWorkflowStore } from './workflow-store-client';

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
