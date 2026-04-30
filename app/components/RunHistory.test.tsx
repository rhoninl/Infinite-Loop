import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RunRecord, RunSummary } from '../../lib/shared/workflow';
import RunHistory from './RunHistory';

const SUMMARY_A: RunSummary = {
  runId: 'r-a',
  workflowId: 'wf-1',
  workflowName: 'Demo',
  status: 'succeeded',
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_500,
  durationMs: 1500,
  eventCount: 4,
};

const RECORD_A: RunRecord = {
  ...SUMMARY_A,
  scope: { 'agent-1': { ok: true } },
  events: [
    { type: 'run_started', workflowId: 'wf-1', workflowName: 'Demo' },
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
      durationMs: 1200,
    },
    { type: 'run_finished', status: 'succeeded', scope: {} },
  ],
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('RunHistory', () => {
  beforeEach(() => {
    // Default fetch handles list + detail.
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.startsWith('/api/runs?workflowId=')) {
        return jsonResponse({ runs: [SUMMARY_A] });
      }
      if (u.startsWith('/api/runs/wf-1/r-a')) {
        return jsonResponse({ run: RECORD_A });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;
  });

  it('shows the no-workflow placeholder when none is loaded', async () => {
    // Override fetch to assert it isn't called when workflowId is absent.
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return jsonResponse({ runs: [] });
    }) as unknown as typeof fetch;

    render(<RunHistory workflowId={undefined} />);
    await waitFor(() =>
      expect(screen.getByText(/load a workflow first/i)).toBeInTheDocument(),
    );
    expect(called).toBe(false);
  });

  it('lists runs returned by /api/runs for the current workflow', async () => {
    render(<RunHistory workflowId="wf-1" />);
    await waitFor(() =>
      expect(screen.getByLabelText('run r-a')).toBeInTheDocument(),
    );
    // Status text appears, plus the event-count badge.
    const row = screen.getByLabelText('run r-a');
    expect(row).toHaveTextContent('succeeded');
    expect(row).toHaveTextContent('4 ev');
  });

  it('opens a detail view when a run row is clicked and renders the events', async () => {
    render(<RunHistory workflowId="wf-1" />);
    const row = await screen.findByLabelText('run r-a');
    fireEvent.click(row);

    await waitFor(() =>
      expect(screen.getByLabelText('event log')).toBeInTheDocument(),
    );
    const log = screen.getByLabelText('event log');
    expect(log).toHaveTextContent('run_started');
    expect(log).toHaveTextContent('node_started');
    expect(log).toHaveTextContent('node_finished');
    expect(log).toHaveTextContent('run_finished');
  });

  it('back button returns to the list view', async () => {
    render(<RunHistory workflowId="wf-1" />);
    fireEvent.click(await screen.findByLabelText('run r-a'));
    await screen.findByLabelText('event log');

    fireEvent.click(screen.getByLabelText('back to history list'));
    await waitFor(() =>
      expect(screen.getByLabelText('run history')).toBeInTheDocument(),
    );
  });

  it('surfaces a failure from /api/runs as an inline error', async () => {
    globalThis.fetch = mock(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;

    render(<RunHistory workflowId="wf-1" />);
    await waitFor(() =>
      expect(screen.getByLabelText('run history error')).toBeInTheDocument(),
    );
  });
});
