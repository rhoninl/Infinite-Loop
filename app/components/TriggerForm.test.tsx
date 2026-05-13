import { describe, expect, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TriggerForm } from './TriggerForm';
import type { WebhookPlugin } from '@/lib/shared/trigger';

const plugins: WebhookPlugin[] = [
  { id: 'generic', displayName: 'Generic', events: [{ type: 'any', displayName: 'Any', fields: [] }] },
  {
    id: 'github', displayName: 'GitHub', eventHeader: 'x-github-event',
    events: [
      {
        type: 'issues', displayName: 'Issue',
        fields: [
          { path: 'body.action', type: 'string', description: 'opened, closed' },
          { path: 'body.issue.number', type: 'number' },
        ],
      },
    ],
  },
];

const workflows = [
  { id: 'wf-a', name: 'A', inputs: [{ name: 'msg', type: 'string' as const }] },
  { id: 'wf-b', name: 'B', inputs: [] },
];

describe('TriggerForm', () => {
  test('renders empty form with defaults', () => {
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/trigger name/i)).toBeTruthy();
    expect(screen.getByText(/Save trigger/)).toBeTruthy();
  });

  test('picking GitHub plugin reveals the Event picker', () => {
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Plugin/i), { target: { value: 'github' } });
    expect(screen.getByLabelText(/Event/i)).toBeTruthy();
  });

  test('picking a target workflow renders its inputs as rows', async () => {
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Target/i), { target: { value: 'wf-a' } });
    await waitFor(() => {
      expect(screen.getByText('msg')).toBeTruthy();
    });
  });

  test('save calls onSave with the built payload', async () => {
    let captured: unknown = null;
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={async (t) => { captured = t; }}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/trigger name/i), { target: { value: 'my-trigger' } });
    fireEvent.change(screen.getByLabelText(/Plugin/i), { target: { value: 'generic' } });
    fireEvent.change(screen.getByLabelText(/Target/i), { target: { value: 'wf-b' } });
    fireEvent.click(screen.getByText(/Save trigger/));
    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    expect((captured as { name: string }).name).toBe('my-trigger');
    expect((captured as { workflowId: string }).workflowId).toBe('wf-b');
    expect((captured as { pluginId: string }).pluginId).toBe('generic');
  });
});
