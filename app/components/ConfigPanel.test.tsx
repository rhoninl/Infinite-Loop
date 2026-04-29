import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useWorkflowStore } from '@/lib/client/workflow-store-client';
import type { Workflow, WorkflowNode } from '@/lib/shared/workflow';
import ConfigPanel from './ConfigPanel';

function makeWorkflow(nodes: WorkflowNode[]): Workflow {
  return {
    id: 'wf-test',
    name: 'Test',
    version: 1,
    nodes,
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

const startNode: WorkflowNode = {
  id: 'start-1',
  type: 'start',
  position: { x: 0, y: 0 },
  config: {},
};

const agentNode: WorkflowNode = {
  id: 'agent-1',
  type: 'agent',
  position: { x: 0, y: 0 },
  config: { providerId: 'claude', prompt: 'hello', cwd: '/tmp', timeoutMs: 60000 },
};

const conditionNode: WorkflowNode = {
  id: 'cond-1',
  type: 'condition',
  position: { x: 0, y: 0 },
  config: { kind: 'sentinel', sentinel: { pattern: 'OK', isRegex: false } },
};

const loopNode: WorkflowNode = {
  id: 'loop-1',
  type: 'loop',
  position: { x: 0, y: 0 },
  config: { maxIterations: 5, mode: 'while-not-met' },
  children: [],
};

function reset() {
  useWorkflowStore.setState({
    currentWorkflow: null,
    isDirty: false,
    selectedNodeId: null,
    runStatus: 'idle',
    runEvents: [],
  });
}

describe('ConfigPanel', () => {
  beforeEach(() => {
    reset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    reset();
  });

  it('renders the empty placeholder when nothing is selected', () => {
    render(<ConfigPanel />);
    expect(screen.getByLabelText('config panel')).toBeInTheDocument();
    expect(screen.getByText('Select a node to configure')).toBeInTheDocument();
  });

  it('renders Agent config fields when an Agent node is selected', () => {
    const wf = makeWorkflow([startNode, agentNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('agent-1');
    });

    render(<ConfigPanel />);

    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByLabelText('Working directory')).toBeInTheDocument();
    expect(screen.getByLabelText('Iteration timeout (ms)')).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveTextContent('claude');
    // header shows id + type
    expect(screen.getByText(/agent-1/)).toBeInTheDocument();
    expect(screen.getByText(/agent/)).toBeInTheDocument();
  });

  it('debounces edits to the Agent prompt and dispatches updateNode', () => {
    vi.useFakeTimers();
    const wf = makeWorkflow([startNode, agentNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('agent-1');
    });

    render(<ConfigPanel />);

    const promptField = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(promptField, { target: { value: 'updated prompt' } });
    });

    // Before the debounce timer fires, the store has not been updated.
    let stored = useWorkflowStore.getState().currentWorkflow!.nodes.find(
      (n) => n.id === 'agent-1',
    )!.config as { prompt: string };
    expect(stored.prompt).toBe('hello');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    stored = useWorkflowStore.getState().currentWorkflow!.nodes.find(
      (n) => n.id === 'agent-1',
    )!.config as { prompt: string };
    expect(stored.prompt).toBe('updated prompt');
  });

  it('shows the sentinel pattern by default and switches to command on segment click', () => {
    const wf = makeWorkflow([startNode, conditionNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('cond-1');
    });

    render(<ConfigPanel />);

    expect(screen.getByLabelText('Pattern')).toBeInTheDocument();
    expect(screen.queryByLabelText('Command')).not.toBeInTheDocument();

    const commandBtn = screen.getByRole('button', { name: 'Command' });
    act(() => {
      fireEvent.click(commandBtn);
    });

    expect(screen.getByLabelText('Command')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pattern')).not.toBeInTheDocument();

    // Store reflects the kind change immediately (segmented controls fire sync).
    const stored = useWorkflowStore.getState().currentWorkflow!.nodes.find(
      (n) => n.id === 'cond-1',
    )!.config as { kind: string };
    expect(stored.kind).toBe('command');
  });

  it('renders Loop max iterations and mode controls', () => {
    const wf = makeWorkflow([loopNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('loop-1');
    });

    render(<ConfigPanel />);

    expect(screen.getByLabelText('Max iterations')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'While not met' }),
    ).toHaveAttribute('data-active', 'true');
  });

  it('Start node shows the descriptor copy and no editable fields', () => {
    const wf = makeWorkflow([startNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('start-1');
    });

    render(<ConfigPanel />);

    expect(screen.getByText('Begin the workflow.')).toBeInTheDocument();
    // No text/number/textarea inputs should be present for a start node.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('finds nodes inside Loop containers (children)', () => {
    const childAgent: WorkflowNode = {
      id: 'agent-inside-loop',
      type: 'agent',
      position: { x: 0, y: 0 },
      config: { providerId: 'claude', prompt: 'inner', cwd: '/work', timeoutMs: 30000 },
    };
    const wf = makeWorkflow([
      startNode,
      { ...loopNode, children: [childAgent] },
    ]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('agent-inside-loop');
    });

    render(<ConfigPanel />);

    expect(screen.getByLabelText('Prompt')).toHaveValue('inner');
    expect(screen.getByLabelText('Working directory')).toHaveValue('/work');
  });
});
