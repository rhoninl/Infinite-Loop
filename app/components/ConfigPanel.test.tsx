import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import FakeTimers, { type InstalledClock } from '@sinonjs/fake-timers';
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
  let clock: InstalledClock | null = null;

  beforeEach(() => {
    reset();
  });

  afterEach(() => {
    cleanup();
    if (clock) {
      clock.uninstall();
      clock = null;
    }
    reset();
  });

  it('renders the empty placeholder when nothing is selected', () => {
    render(<ConfigPanel />);
    expect(screen.getByLabelText('config panel')).toBeInTheDocument();
    // Terminal-prompt placeholder: "› select a node to configure_". Match
    // the meaningful inner text rather than the prompt + cursor decoration.
    expect(
      screen.getByText(/select a node to configure/i),
    ).toBeInTheDocument();
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
    expect(screen.getByLabelText('Iteration timeout')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Iteration timeout unit' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveTextContent('claude');
    // header shows id + type
    expect(screen.getByText(/agent-1/)).toBeInTheDocument();
    expect(screen.getByText(/agent/)).toBeInTheDocument();
  });

  it('debounces edits to the Agent prompt and dispatches updateNode', () => {
    clock = FakeTimers.install();
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
      clock!.tick(300);
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

  it('Loop infinite toggle hides Max iterations and persists infinite=true', () => {
    const wf = makeWorkflow([loopNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('loop-1');
    });

    render(<ConfigPanel />);

    // Bounded by default → Max iterations input is rendered.
    expect(screen.getByLabelText('Max iterations')).toBeInTheDocument();

    const infiniteBtn = screen.getByRole('button', { name: 'Infinite ∞' });
    act(() => {
      fireEvent.click(infiniteBtn);
    });

    // Input disappears, store records infinite: true.
    expect(screen.queryByLabelText('Max iterations')).not.toBeInTheDocument();
    const stored = useWorkflowStore.getState().currentWorkflow!.nodes.find(
      (n) => n.id === 'loop-1',
    )!.config as { infinite?: boolean };
    expect(stored.infinite).toBe(true);

    // Toggle back to Bounded restores the input and flips the flag.
    const boundedBtn = screen.getByRole('button', { name: 'Bounded' });
    act(() => {
      fireEvent.click(boundedBtn);
    });
    expect(screen.getByLabelText('Max iterations')).toBeInTheDocument();
    const stored2 = useWorkflowStore.getState().currentWorkflow!.nodes.find(
      (n) => n.id === 'loop-1',
    )!.config as { infinite?: boolean };
    expect(stored2.infinite).toBe(false);
  });

  it('Start node shows the descriptor copy and only the Display name field', () => {
    const wf = makeWorkflow([startNode]);
    act(() => {
      useWorkflowStore.getState().loadWorkflow(wf);
      useWorkflowStore.getState().selectNode('start-1');
    });

    render(<ConfigPanel />);

    expect(screen.getByText('Begin the workflow.')).toBeInTheDocument();
    // Display name (renames the canvas card title) is shared across all
    // node types — that's the only textbox a Start node carries. No other
    // type-specific text/number inputs.
    expect(screen.getByLabelText('Display name')).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(1);
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
    // cwd field is a read-only div now (so CSS can truncate from the start
    // and show the tail of long paths) — assert text content, not value.
    expect(screen.getByLabelText('Working directory')).toHaveTextContent(
      '/work',
    );
  });
});
