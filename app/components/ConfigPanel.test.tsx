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

const claudeNode: WorkflowNode = {
  id: 'claude-1',
  type: 'claude',
  position: { x: 0, y: 0 },
  config: { prompt: 'hello', cwd: '/tmp', timeoutMs: 60000 },
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

  it('renders Claude config fields when a Claude node is selected', () => {
    const wf = makeWorkflow([startNode, claudeNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('claude-1');
    });

    render(<ConfigPanel />);

    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByLabelText('Working directory')).toBeInTheDocument();
    expect(screen.getByLabelText('Iteration timeout (ms)')).toBeInTheDocument();
    // header shows id + type
    expect(screen.getByText(/claude-1/)).toBeInTheDocument();
    expect(screen.getByText(/claude/)).toBeInTheDocument();
  });

  it('debounces edits to the Claude prompt and dispatches updateNode', () => {
    vi.useFakeTimers();
    const wf = makeWorkflow([startNode, claudeNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('claude-1');
    });

    render(<ConfigPanel />);

    const promptField = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(promptField, { target: { value: 'updated prompt' } });
    });

    // Before the debounce timer fires, the store has not been updated.
    let stored = useWorkflowStore.getState().currentWorkflow!.nodes.find(
      (n) => n.id === 'claude-1',
    )!.config as { prompt: string };
    expect(stored.prompt).toBe('hello');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    stored = useWorkflowStore.getState().currentWorkflow!.nodes.find(
      (n) => n.id === 'claude-1',
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
    const childClaude: WorkflowNode = {
      id: 'claude-inside-loop',
      type: 'claude',
      position: { x: 0, y: 0 },
      config: { prompt: 'inner', cwd: '/work', timeoutMs: 30000 },
    };
    const wf = makeWorkflow([
      startNode,
      { ...loopNode, children: [childClaude] },
    ]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('claude-inside-loop');
    });

    render(<ConfigPanel />);

    expect(screen.getByLabelText('Prompt')).toHaveValue('inner');
    expect(screen.getByLabelText('Working directory')).toHaveValue('/work');
  });
});
