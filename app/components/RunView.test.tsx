import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
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
    vi.useRealTimers();
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
    expect(log).toHaveTextContent('run_started');
    expect(log).toHaveTextContent('node_started');
    expect(log).toHaveTextContent('node_finished');
    expect(log).toHaveTextContent('agent-1');
    expect(log).toHaveTextContent('next');
    expect(log).toHaveTextContent('condition_checked');
    expect(log).toHaveTextContent(/met:Y/);
    expect(log).toHaveTextContent('foo.bar');
    expect(log).toHaveTextContent('boom');
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

  it('shows the websocket connection status', () => {
    seed([], { runStatus: 'idle', connectionStatus: 'open' });
    render(<RunView />);
    expect(screen.getByLabelText('websocket status')).toHaveTextContent(
      'WS: open',
    );
  });
});
