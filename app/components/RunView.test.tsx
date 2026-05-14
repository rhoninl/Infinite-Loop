import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import RunView from './RunView';
import { useWorkflowStore } from '../../lib/client/workflow-store-client';
import type { Workflow, WorkflowEvent } from '../../lib/shared/workflow';

function seed(events: WorkflowEvent[], extra: Partial<{
  runStatus: ReturnType<typeof useWorkflowStore.getState>['runStatus'];
  connectionStatus: ReturnType<typeof useWorkflowStore.getState>['connectionStatus'];
  currentWorkflow: Workflow | null;
}> = {}) {
  useWorkflowStore.setState({
    runEvents: events,
    runStatus: extra.runStatus ?? 'idle',
    connectionStatus: extra.connectionStatus ?? 'open',
    currentWorkflow: extra.currentWorkflow ?? null,
  });
}

describe('RunView', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      runEvents: [],
      runStatus: 'idle',
      connectionStatus: 'open',
      currentWorkflow: null,
    });
    try {
      window.localStorage.removeItem('infinite_loop:runview:expandSubworkflows');
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    cleanup();
  });

  it('shows idle status and no currently running line when empty', () => {
    seed([], { runStatus: 'idle' });
    render(<RunView />);
    expect(screen.getByLabelText('run status')).toHaveTextContent(/idle/i);
    expect(screen.queryByLabelText('currently running')).toBeNull();
  });

  it('shows running status and lists the active node', () => {
    seed(
      [
        { type: 'run_started', workflowId: 'w1', workflowName: 'Demo' },
        {
          type: 'node_started',
          nodeId: 'agent-1',
          nodeType: 'agent',
          resolvedConfig: {},
        },
      ],
      { runStatus: 'running' },
    );
    render(<RunView />);
    expect(screen.getByLabelText('run status')).toHaveTextContent(/running/i);
    const current = screen.getByLabelText('currently running');
    expect(current).toHaveTextContent('agent-1');
    expect(current).toHaveTextContent(/agent/);
  });

  it('removes the currently running line when node_finished arrives', () => {
    seed(
      [
        { type: 'run_started', workflowId: 'w1', workflowName: 'Demo' },
        {
          type: 'node_started',
          nodeId: 'agent-1',
          nodeType: 'agent',
          resolvedConfig: {},
        },
      ],
      { runStatus: 'running' },
    );
    render(<RunView />);
    expect(screen.getByLabelText('currently running')).toHaveTextContent(
      'agent-1',
    );

    act(() => {
      useWorkflowStore.getState().appendRunEvent({
        type: 'node_finished',
        nodeId: 'agent-1',
        nodeType: 'agent',
        branch: 'next',
        outputs: {},
        durationMs: 100,
      });
    });

    expect(screen.queryByLabelText('currently running')).toBeNull();
  });

  it('renders a row in the event log for each event with key payload fields', () => {
    seed(
      [
        { type: 'run_started', workflowId: 'w1', workflowName: 'Demo' },
        {
          type: 'node_started',
          nodeId: 'agent-1',
          nodeType: 'agent',
          resolvedConfig: {},
        },
        {
          type: 'node_finished',
          nodeId: 'agent-1',
          nodeType: 'agent',
          branch: 'next',
          outputs: {},
          durationMs: 50,
        },
        {
          type: 'condition_checked',
          nodeId: 'cond-1',
          met: true,
          detail: 'matched',
        },
        {
          type: 'template_warning',
          nodeId: 'agent-1',
          field: 'prompt',
          missingKey: 'foo.bar',
        },
        { type: 'error', message: 'boom' },
      ],
      { runStatus: 'running' },
    );
    render(<RunView />);
    const log = screen.getByLabelText('event log');
    // node_started / node_finished rows are intentionally NOT rendered inside
    // each per-node card — the card header summarizes them. The card surface
    // (id, kind, branch, status) is what the user sees instead.
    expect(log).toHaveTextContent('run_started');
    expect(log).toHaveTextContent('agent-1');
    expect(log).toHaveTextContent(/next/i);
    expect(log).toHaveTextContent('condition_checked');
    expect(log).toHaveTextContent(/met:Y/);
    expect(log).toHaveTextContent('boom');

    // template_warning lives inside agent-1, which defaults collapsed because
    // agent-1 is finished. Expand it, then assert the body row is rendered.
    fireEvent.click(screen.getByLabelText(/expand node card agent-1/i));
    expect(screen.getByLabelText('node card agent-1')).toHaveTextContent(
      'foo.bar',
    );
  });

  it('reflects run_finished by updating the status badge to succeeded', () => {
    seed(
      [
        { type: 'run_started', workflowId: 'w1', workflowName: 'Demo' },
      ],
      { runStatus: 'running' },
    );
    render(<RunView />);
    expect(screen.getByLabelText('run status')).toHaveTextContent(/running/i);

    act(() => {
      useWorkflowStore.getState().appendRunEvent({
        type: 'run_finished',
        status: 'succeeded',
        scope: {},
      });
    });

    expect(screen.getByLabelText('run status')).toHaveTextContent(/succeeded/i);
  });

  it('finished cards default collapsed; running cards default open; clicking the head toggles', () => {
    seed(
      [
        { type: 'run_started', workflowId: 'w1', workflowName: 'Demo' },
        // a-1 finishes — defaults collapsed.
        {
          type: 'node_started',
          nodeId: 'a-1',
          nodeType: 'agent',
          resolvedConfig: {},
        },
        { type: 'stdout_chunk', nodeId: 'a-1', line: 'first-output' },
        {
          type: 'node_finished',
          nodeId: 'a-1',
          nodeType: 'agent',
          branch: 'next',
          outputs: {},
          durationMs: 10,
        },
        // b-1 still running — defaults open.
        {
          type: 'node_started',
          nodeId: 'b-1',
          nodeType: 'agent',
          resolvedConfig: {},
        },
        { type: 'stdout_chunk', nodeId: 'b-1', line: 'live-output' },
      ],
      { runStatus: 'running' },
    );
    render(<RunView />);

    // Running card body visible from the start.
    const bCard = screen.getByLabelText('node card b-1');
    expect(bCard).toHaveTextContent('live-output');

    // Finished card body hidden until expanded.
    const aCard = screen.getByLabelText('node card a-1');
    expect(aCard).not.toHaveTextContent('first-output');

    fireEvent.click(screen.getByLabelText(/expand node card a-1/i));
    expect(aCard).toHaveTextContent('first-output');

    // Re-collapse.
    fireEvent.click(screen.getByLabelText(/collapse node card a-1/i));
    expect(aCard).not.toHaveTextContent('first-output');
  });

  it('coalesces consecutive stdout chunks into a single block per card', () => {
    seed(
      [
        { type: 'run_started', workflowId: 'w1', workflowName: 'Demo' },
        {
          type: 'node_started',
          nodeId: 'agent-1',
          nodeType: 'agent',
          resolvedConfig: {},
        },
        { type: 'stdout_chunk', nodeId: 'agent-1', line: 'do? There' },
        { type: 'stdout_chunk', nodeId: 'agent-1', line: "'s no prior" },
        { type: 'stdout_chunk', nodeId: 'agent-1', line: ' task' },
      ],
      { runStatus: 'running' },
    );
    render(<RunView />);
    const card = screen.getByLabelText('node card agent-1');
    // Three chunks must concatenate into one continuous string — no visual
    // shredding when a token delta lands mid-word.
    expect(card).toHaveTextContent("do? There's no prior task");
    // And only one stdout block should exist for the run, not three.
    const stdoutLines = card.querySelectorAll('.run-view-log-row.is-stdout');
    expect(stdoutLines.length).toBe(1);
  });

  it('shows the event-stream connection status', () => {
    seed([], { runStatus: 'idle', connectionStatus: 'open' });
    render(<RunView />);
    expect(screen.getByLabelText('event stream status')).toHaveTextContent(
      'SSE: open',
    );
  });

  it('does not yank the log to bottom while the user has scrolled up', () => {
    seed([{ type: 'run_started', workflowId: 'w1', workflowName: 'Demo' }], {
      runStatus: 'running',
    });
    render(<RunView />);
    const log = screen.getByLabelText('event log') as HTMLDivElement;
    // happy-dom doesn't lay out scroll heights; fake the geometry so the
    // distance-from-bottom calculation in the component evaluates as
    // "user has scrolled up".
    Object.defineProperty(log, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 200, configurable: true });
    log.scrollTop = 100;
    log.dispatchEvent(new Event('scroll', { bubbles: true }));

    act(() => {
      useWorkflowStore.getState().appendRunEvent({
        type: 'node_started',
        nodeId: 'agent-1',
        nodeType: 'agent',
        resolvedConfig: {},
      });
    });

    // user's manual scroll position should be preserved
    expect(log.scrollTop).toBe(100);
  });

  it('renders parallel branch sub-rows that update independently', () => {
    const wf: Workflow = {
      id: 'team',
      name: 'Team',
      version: 1,
      nodes: [
        {
          id: 'par-1',
          type: 'parallel',
          position: { x: 0, y: 0 },
          config: { mode: 'wait-all', onError: 'fail-fast' },
          children: [
            {
              id: 'a-1',
              type: 'agent',
              position: { x: 0, y: 0 },
              config: {
                providerId: 'claude',
                prompt: '',
                cwd: '.',
                timeoutMs: 60000,
              },
            },
            {
              id: 'a-2',
              type: 'agent',
              position: { x: 0, y: 0 },
              config: {
                providerId: 'claude',
                prompt: '',
                cwd: '.',
                timeoutMs: 60000,
              },
            },
          ],
        },
      ],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
    };

    seed(
      [
        { type: 'run_started', workflowId: 'team', workflowName: 'Team' },
        {
          type: 'node_started',
          nodeId: 'par-1',
          nodeType: 'parallel',
          resolvedConfig: {},
        },
        {
          type: 'node_started',
          nodeId: 'a-1',
          nodeType: 'agent',
          resolvedConfig: {},
        },
        {
          type: 'node_started',
          nodeId: 'a-2',
          nodeType: 'agent',
          resolvedConfig: {},
        },
        { type: 'stdout_chunk', nodeId: 'a-1', line: 'a-1 working\n' },
        { type: 'stdout_chunk', nodeId: 'a-2', line: 'a-2 working\n' },
      ],
      { runStatus: 'running', currentWorkflow: wf },
    );

    render(<RunView />);
    const branches = screen.getByLabelText('parallel branches of par-1');
    expect(branches).toHaveTextContent('a-1');
    expect(branches).toHaveTextContent('a-2');
    // Both branches start in `live` state.
    expect(screen.getByLabelText('branch a-1 of par-1')).toHaveAttribute(
      'data-state',
      'live',
    );
    expect(screen.getByLabelText('branch a-2 of par-1')).toHaveAttribute(
      'data-state',
      'live',
    );
    // Live previews are visible while collapsed.
    expect(screen.getByLabelText('live preview a-1')).toHaveTextContent(
      'a-1 working',
    );
    expect(screen.getByLabelText('live preview a-2')).toHaveTextContent(
      'a-2 working',
    );

    // Finish branch a-1 — only its sub-row's state should flip; a-2 stays live.
    act(() => {
      useWorkflowStore.getState().appendRunEvent({
        type: 'node_finished',
        nodeId: 'a-1',
        nodeType: 'agent',
        branch: 'next',
        outputs: {},
        durationMs: 10,
      });
    });
    expect(screen.getByLabelText('branch a-1 of par-1')).toHaveAttribute(
      'data-state',
      'succeeded',
    );
    expect(screen.getByLabelText('branch a-2 of par-1')).toHaveAttribute(
      'data-state',
      'live',
    );

    // Click to expand a-1 → full stdout becomes visible.
    fireEvent.click(screen.getByLabelText(/expand branch a-1 of par-1/i));
    expect(screen.getByLabelText('full stdout a-1')).toHaveTextContent(
      'a-1 working',
    );
  });

  it('collapses subworkflow-internal events under the subworkflow card by default and toggles via the chip', () => {
    const wf: Workflow = {
      id: 'parent',
      name: 'Parent',
      version: 1,
      nodes: [
        {
          id: 'sub-1',
          type: 'subworkflow',
          position: { x: 0, y: 0 },
          config: { workflowId: 'team', inputs: {}, outputs: {} },
        },
      ],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
    };

    // Internal event uses an id that is NOT in the parent workflow — that's
    // the fallback signal a subworkflow event uses when the engine hasn't
    // started emitting `subworkflowStack` yet.
    seed(
      [
        { type: 'run_started', workflowId: 'parent', workflowName: 'Parent' },
        {
          type: 'node_started',
          nodeId: 'sub-1',
          nodeType: 'subworkflow',
          resolvedConfig: {},
        },
        {
          type: 'node_started',
          nodeId: 'inner-agent',
          nodeType: 'agent',
          resolvedConfig: {},
        },
        { type: 'stdout_chunk', nodeId: 'inner-agent', line: 'INNER_LINE' },
      ],
      { runStatus: 'running', currentWorkflow: wf },
    );

    render(<RunView />);

    // Default: collapsed — there should be NO inner-agent card surfaced in
    // the event log; the line is folded under sub-1.
    expect(screen.queryByLabelText('node card inner-agent')).toBeNull();
    const subCard = screen.getByLabelText('node card sub-1');
    expect(subCard).toHaveTextContent('INNER_LINE');

    // Toggle the chip → expand. Now the inner-agent card materializes.
    fireEvent.click(screen.getByLabelText('toggle subworkflow expansion'));
    expect(screen.getByLabelText('node card inner-agent')).toBeInTheDocument();
    // Subworkflow card no longer carries the folded line itself.
    expect(screen.getByLabelText('node card sub-1')).not.toHaveTextContent(
      'INNER_LINE',
    );
  });

  it('persists the subworkflow expansion preference to localStorage', () => {
    seed([], { runStatus: 'idle' });
    const { unmount } = render(<RunView />);
    fireEvent.click(screen.getByLabelText('toggle subworkflow expansion'));
    expect(window.localStorage.getItem('infinite_loop:runview:expandSubworkflows')).toBe(
      '1',
    );
    unmount();

    // New mount picks the preference back up.
    render(<RunView />);
    expect(screen.getByLabelText('toggle subworkflow expansion')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('re-engages auto-scroll once the user scrolls back to the bottom', () => {
    seed([{ type: 'run_started', workflowId: 'w1', workflowName: 'Demo' }], {
      runStatus: 'running',
    });
    render(<RunView />);
    const log = screen.getByLabelText('event log') as HTMLDivElement;
    Object.defineProperty(log, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 200, configurable: true });

    // user scrolls up to read history
    log.scrollTop = 100;
    log.dispatchEvent(new Event('scroll', { bubbles: true }));

    // user scrolls back to (near) the bottom — within the 48px threshold
    log.scrollTop = 4790;
    log.dispatchEvent(new Event('scroll', { bubbles: true }));

    // grow the content so the auto-pin would have a visible effect
    Object.defineProperty(log, 'scrollHeight', { value: 5400, configurable: true });

    act(() => {
      useWorkflowStore.getState().appendRunEvent({
        type: 'node_started',
        nodeId: 'agent-2',
        nodeType: 'agent',
        resolvedConfig: {},
      });
    });

    // sticky should have re-engaged and pinned us to the new bottom
    expect(log.scrollTop).toBe(5400);
  });
});
