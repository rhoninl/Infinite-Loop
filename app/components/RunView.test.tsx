import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import RunView from './RunView';
import { useWorkflowStore } from '../../lib/client/workflow-store-client';
import type { WorkflowEvent } from '../../lib/shared/workflow';

function seed(events: WorkflowEvent[], extra: Partial<{
  runStatus: ReturnType<typeof useWorkflowStore.getState>['runStatus'];
  connectionStatus: ReturnType<typeof useWorkflowStore.getState>['connectionStatus'];
}> = {}) {
  useWorkflowStore.setState({
    runEvents: events,
    runStatus: extra.runStatus ?? 'idle',
    connectionStatus: extra.connectionStatus ?? 'open',
  });
}

describe('RunView', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      runEvents: [],
      runStatus: 'idle',
      connectionStatus: 'open',
    });
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

  it('shows the websocket connection status', () => {
    seed([], { runStatus: 'idle', connectionStatus: 'open' });
    render(<RunView />);
    expect(screen.getByLabelText('websocket status')).toHaveTextContent(
      'WS: open',
    );
  });
});
