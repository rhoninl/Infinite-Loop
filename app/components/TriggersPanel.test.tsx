import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { TriggersPanel } from './TriggersPanel';
import { useWorkflowStore } from '@/lib/client/workflow-store-client';
import type { Workflow, TriggerStartedEvent } from '@/lib/shared/workflow';

// TODO(dispatch-v2): Workflow.triggers removed from type in Task 1. Cast
// through unknown to keep test compilable until TriggersPanel is rewritten
// in the DispatchView task to fetch from /api/triggers?workflowId=.
const wf = {
  id: 'wf-a', name: 'A', version: 1, createdAt: 0, updatedAt: 0,
  nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
  triggers: [
    {
      id: 'idAAAAAAAAAAAAAAAAAAAA',
      name: 'push-to-main',
      enabled: true,
      match: [{ lhs: '{{headers.x-github-event}}', op: '==', rhs: 'push' }],
      inputs: { branch: '{{body.ref}}' },
      lastFiredAt: null,
    },
    {
      id: 'idBBBBBBBBBBBBBBBBBBBB',
      name: 'pr-opened',
      enabled: false,
      match: [],
      inputs: {},
      lastFiredAt: 1_700_000_000_000,
    },
  ],
} as unknown as Workflow;

describe('TriggersPanel', () => {
  test('renders empty state when no triggers', () => {
    render(<TriggersPanel workflow={{ ...wf, triggers: [] } as unknown as Workflow} origin="http://localhost:3000" />);
    expect(screen.getByText(/no triggers/i)).toBeTruthy();
  });

  test('renders one row per trigger with the URL', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText('push-to-main')).toBeTruthy();
    expect(screen.getByText('pr-opened')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('idAAAA'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('idBBBB'))).toBeTruthy();
  });

  test('shows Enabled/Disabled chips', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText(/Enabled/)).toBeTruthy();
    expect(screen.getByText(/Disabled/)).toBeTruthy();
  });

  test('shows Last fired and Never fired', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText(/Never fired/i)).toBeTruthy();
    expect(screen.getByText(/Last fired/i)).toBeTruthy();
  });

  test('shows live lastFiredAt from the store when newer than the persisted value', () => {
    // Push a synthetic trigger_started event through appendRunEvent so the
    // store's triggerLastFiredAt map is populated for the trigger whose
    // persisted lastFiredAt is null (id: idAAAAAAAAAAAAAAAAAAAA).
    const ev: TriggerStartedEvent = {
      type: 'trigger_started',
      queueId: 'q-1',
      triggerId: 'idAAAAAAAAAAAAAAAAAAAA',
      workflowId: 'wf-a',
      runId: 'run-1',
    };
    useWorkflowStore.getState().appendRunEvent(ev);

    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);

    // The trigger that previously showed "Never fired" should now show a live
    // time — formatRelative for a just-fired event returns "just now".
    const neverFiredElements = screen.queryAllByText(/Never fired/i);
    // The idAAAA trigger should no longer say "Never fired"
    expect(neverFiredElements.length).toBe(0);
    expect(screen.getAllByText(/Last fired/i).length).toBe(2);
  });
});
