import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestFireModal } from './TestFireModal';
import type { WebhookTrigger, WebhookPlugin } from '@/lib/shared/trigger';

const trigger: WebhookTrigger = {
  id: 'idTESTAAAAAAAAAAAAAAAA', name: 't', enabled: true,
  workflowId: 'wf', pluginId: 'github', eventType: 'issues',
  match: [], inputs: {},
  createdAt: 0, updatedAt: 0, lastFiredAt: null,
};

const plugin: WebhookPlugin = {
  id: 'github', displayName: 'GitHub', eventHeader: 'x-github-event',
  events: [
    {
      type: 'issues', displayName: 'Issue', fields: [],
      examplePayload: { action: 'opened', issue: { number: 1 } },
    },
  ],
};

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('TestFireModal', () => {
  test('Pre-fill button populates the payload from examplePayload', () => {
    render(<TestFireModal trigger={trigger} plugin={plugin} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Pre-fill example/i));
    const textarea = screen.getByLabelText(/Payload/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('"action": "opened"');
  });

  test('Send hits the test endpoint and shows the response', async () => {
    // @ts-expect-error fetch override
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 202, body: { queued: true } }),
    });
    render(<TestFireModal trigger={trigger} plugin={plugin} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Send/i));
    await waitFor(() => {
      expect(screen.getByText(/202/)).toBeTruthy();
      expect(screen.getByText(/queued/)).toBeTruthy();
    });
  });
});
