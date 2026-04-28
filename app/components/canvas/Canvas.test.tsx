import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type {
  ClaudeConfig,
  ConditionConfig,
  LoopConfig,
  Workflow,
  WorkflowEvent,
  WorkflowNode,
} from '../../../lib/shared/workflow';
import { useWorkflowStore } from '../../../lib/client/workflow-store-client';
import Canvas, {
  buildDroppedNode,
  buildEdge,
  buildLiveStateMap,
  defaultConfigFor,
  nextNodeId,
  workflowToXyflow,
} from './Canvas';

/* ─── jsdom polyfills required by xyflow ─────────────────────────────────── */

beforeEach(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
  // Reset zustand singleton between tests.
  useWorkflowStore.setState({
    currentWorkflow: null,
    isDirty: false,
    selectedNodeId: null,
    runStatus: 'idle',
    runEvents: [],
    connectionStatus: 'connecting',
  });
});

afterEach(() => {
  cleanup();
});

/* ─── helpers / fixtures ─────────────────────────────────────────────────── */

function makeWorkflow(): Workflow {
  const nodes: WorkflowNode[] = [
    {
      id: 'start-1',
      type: 'start',
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: 'claude-1',
      type: 'claude',
      position: { x: 200, y: 0 },
      config: { prompt: 'do thing', cwd: '/tmp', timeoutMs: 60000 },
    },
    {
      id: 'end-1',
      type: 'end',
      position: { x: 400, y: 0 },
      config: {},
    },
  ];
  return {
    id: 'wf-test',
    name: 'Test',
    version: 1,
    nodes,
    edges: [
      { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'claude-1' },
      { id: 'e2', source: 'claude-1', sourceHandle: 'next', target: 'end-1' },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

/* ─── pure helper tests ──────────────────────────────────────────────────── */

describe('defaultConfigFor', () => {
  it('returns sensible defaults per node type', () => {
    expect(defaultConfigFor('start')).toEqual({});
    expect(defaultConfigFor('end')).toEqual({});
    const claude = defaultConfigFor('claude') as ClaudeConfig;
    expect(claude).toEqual({ prompt: '', cwd: '', timeoutMs: 60000 });
    const condition = defaultConfigFor('condition') as ConditionConfig;
    expect(condition.kind).toBe('sentinel');
    expect(condition.sentinel).toEqual({ pattern: '', isRegex: false });
    const loop = defaultConfigFor('loop') as LoopConfig;
    expect(loop).toEqual({ maxIterations: 5, mode: 'while-not-met' });
  });
});

describe('nextNodeId', () => {
  it('starts at 1 when no nodes of that type exist', () => {
    expect(nextNodeId('claude', [])).toBe('claude-1');
  });

  it('picks max+1 across existing same-type ids', () => {
    const existing: WorkflowNode[] = [
      { id: 'claude-1', type: 'claude', position: { x: 0, y: 0 }, config: {} as ClaudeConfig },
      { id: 'claude-3', type: 'claude', position: { x: 0, y: 0 }, config: {} as ClaudeConfig },
      { id: 'start-1', type: 'start', position: { x: 0, y: 0 }, config: {} },
    ];
    expect(nextNodeId('claude', existing)).toBe('claude-4');
    expect(nextNodeId('start', existing)).toBe('start-2');
    expect(nextNodeId('end', existing)).toBe('end-1');
  });
});

describe('buildDroppedNode', () => {
  it('builds a node with default config and a unique id', () => {
    const node = buildDroppedNode(
      { type: 'claude', label: 'Step' },
      { x: 50, y: 75 },
      [],
    );
    expect(node.id).toBe('claude-1');
    expect(node.type).toBe('claude');
    expect(node.position).toEqual({ x: 50, y: 75 });
    expect(node.label).toBe('Step');
    expect((node.config as ClaudeConfig).timeoutMs).toBe(60000);
  });

  it('avoids id collisions by reading existing nodes', () => {
    const existing: WorkflowNode[] = [
      { id: 'loop-1', type: 'loop', position: { x: 0, y: 0 }, config: { maxIterations: 5, mode: 'while-not-met' } },
    ];
    const node = buildDroppedNode({ type: 'loop' }, { x: 0, y: 0 }, existing);
    expect(node.id).toBe('loop-2');
  });
});

describe('buildEdge', () => {
  it('returns null when source or target is missing', () => {
    expect(buildEdge({ source: null, target: 'b', sourceHandle: null, targetHandle: null })).toBeNull();
    expect(buildEdge({ source: 'a', target: null, sourceHandle: null, targetHandle: null })).toBeNull();
  });

  it('builds a WorkflowEdge with an e_-prefixed id', () => {
    const e = buildEdge({
      source: 'start-1',
      target: 'claude-1',
      sourceHandle: 'next',
      targetHandle: null,
    });
    expect(e).not.toBeNull();
    expect(e!.source).toBe('start-1');
    expect(e!.target).toBe('claude-1');
    expect(e!.sourceHandle).toBe('next');
    expect(e!.id.startsWith('e_')).toBe(true);
    expect('targetHandle' in e!).toBe(false);
  });

  it("defaults sourceHandle to 'next' when xyflow passes null", () => {
    const e = buildEdge({
      source: 'a',
      target: 'b',
      sourceHandle: null,
      targetHandle: null,
    });
    expect(e!.sourceHandle).toBe('next');
  });
});

describe('buildLiveStateMap', () => {
  it('returns an empty map for no events', () => {
    expect(buildLiveStateMap([])).toEqual({});
  });

  it('marks started-but-not-finished as live', () => {
    const events: WorkflowEvent[] = [
      {
        type: 'node_started',
        nodeId: 'claude-1',
        nodeType: 'claude',
        resolvedConfig: {},
      },
    ];
    expect(buildLiveStateMap(events)).toEqual({ 'claude-1': 'live' });
  });

  it("marks finished as 'succeeded' or 'failed' based on branch", () => {
    const events: WorkflowEvent[] = [
      { type: 'node_started', nodeId: 'claude-1', nodeType: 'claude', resolvedConfig: {} },
      { type: 'node_finished', nodeId: 'claude-1', nodeType: 'claude', branch: 'next', outputs: {}, durationMs: 1 },
      { type: 'node_started', nodeId: 'claude-2', nodeType: 'claude', resolvedConfig: {} },
      { type: 'node_finished', nodeId: 'claude-2', nodeType: 'claude', branch: 'error', outputs: {}, durationMs: 1 },
      { type: 'node_started', nodeId: 'claude-3', nodeType: 'claude', resolvedConfig: {} },
    ];
    expect(buildLiveStateMap(events)).toEqual({
      'claude-1': 'succeeded',
      'claude-2': 'failed',
      'claude-3': 'live',
    });
  });
});

describe('workflowToXyflow', () => {
  it('returns empty arrays when workflow is null', () => {
    expect(workflowToXyflow(null, {}, null)).toEqual({ nodes: [], edges: [] });
  });

  it('maps nodes preserving id/type/position and packs data + state', () => {
    const wf = makeWorkflow();
    const out = workflowToXyflow(wf, { 'claude-1': 'live' }, 'claude-1');
    expect(out.nodes).toHaveLength(3);
    const claudeOut = out.nodes.find((n) => n.id === 'claude-1');
    expect(claudeOut?.type).toBe('claude');
    expect(claudeOut?.selected).toBe(true);
    expect(claudeOut?.data._state).toBe('live');
    expect(claudeOut?.data.label).toBe('claude-1');
    expect(claudeOut?.data.config).toEqual({ prompt: 'do thing', cwd: '/tmp', timeoutMs: 60000 });

    const startOut = out.nodes.find((n) => n.id === 'start-1');
    expect(startOut?.data._state).toBe('idle');
    expect(startOut?.selected).toBe(false);
  });

  it('maps edges 1:1 keeping handles', () => {
    const wf = makeWorkflow();
    const out = workflowToXyflow(wf, {}, null);
    expect(out.edges).toHaveLength(2);
    expect(out.edges[0]).toMatchObject({
      id: 'e1',
      source: 'start-1',
      target: 'claude-1',
      sourceHandle: 'next',
    });
  });
});

/* ─── component-level tests (xyflow DOM) ─────────────────────────────────── */

describe('<Canvas />', () => {
  it('renders without a current workflow', () => {
    const { container } = render(<Canvas />);
    // Canvas mounts with no nodes — the wrapper should be in the DOM and no node markers.
    expect(container.querySelector('[aria-label="canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-id="start-1"]')).toBeNull();
  });

  it('renders xyflow nodes from the workflow store', () => {
    useWorkflowStore.getState().loadWorkflow(makeWorkflow());
    const { container } = render(<Canvas />);
    // xyflow renders each node with data-id="<nodeId>".
    expect(container.querySelector('[data-id="start-1"]')).not.toBeNull();
    expect(container.querySelector('[data-id="claude-1"]')).not.toBeNull();
    expect(container.querySelector('[data-id="end-1"]')).not.toBeNull();
  });
});
