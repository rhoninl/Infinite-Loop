import { afterEach, describe, expect, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QueuePage from './page';

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() { this.closed = true; }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function installFakes(payload: unknown) {
  FakeEventSource.instances = [];
  // @ts-expect-error override
  globalThis.fetch = async (input: any, init?: any) => {
    if (init?.method === 'DELETE') {
      return { ok: true, status: 204, json: async () => ({}) } as any;
    }
    return { ok: true, status: 200, json: async () => payload } as any;
  };
  // @ts-expect-error override
  globalThis.EventSource = FakeEventSource;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
});

describe('QueuePage', () => {
  test('renders an empty state when there are no items', async () => {
    installFakes({ size: 0, items: [] });
    render(<QueuePage />);
    await waitFor(() => {
      expect(screen.getByText(/no queued runs/i)).toBeTruthy();
    });
  });

  test('renders one row per item with workflow name and position', async () => {
    installFakes({
      size: 2,
      items: [
        { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
        { queueId: 'q-2', triggerId: 't2', workflowId: 'w2', workflowName: 'Second', receivedAt: 200, position: 2 },
      ],
    });
    render(<QueuePage />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
    });

    const rows = document.querySelectorAll('.queue-row');
    expect(rows.length).toBe(2);
  });

  test('shows Confirm/Cancel after clicking Delete; Cancel reverts', async () => {
    installFakes({
      size: 1,
      items: [
        { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
      ],
    });
    render(<QueuePage />);
    await waitFor(() => screen.getByText('First'));

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(screen.getByRole('button', { name: /confirm\?/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  test('clicking Confirm calls DELETE and optimistically removes the row', async () => {
    installFakes({
      size: 1,
      items: [
        { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
      ],
    });
    const calls: Array<{ url: string; method?: string }> = [];
    const fakeFetch = async (input: any, init?: any) => {
      calls.push({ url: String(input), method: init?.method });
      if (init?.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => ({}) } as any;
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          size: 1,
          items: [
            { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
          ],
        }),
      } as any;
    };
    // @ts-expect-error override
    globalThis.fetch = fakeFetch;

    render(<QueuePage />);
    await waitFor(() => screen.getByText('First'));

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm\?/i }));

    await waitFor(() => {
      expect(screen.queryByText('First')).toBeNull();
    });
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/triggers/queue/q-1'))).toBe(true);
  });

  test('clicking Delete on another row reverts the first', async () => {
    installFakes({
      size: 2,
      items: [
        { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
        { queueId: 'q-2', triggerId: 't2', workflowId: 'w2', workflowName: 'Second', receivedAt: 200, position: 2 },
      ],
    });
    render(<QueuePage />);
    await waitFor(() => screen.getByText('First'));

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);
    expect(screen.getAllByRole('button', { name: /confirm\?/i }).length).toBe(1);

    // click Delete on the second row
    const stillDelete = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(stillDelete[0]); // the only remaining "Delete" — row 2
    // exactly one row is confirming again
    expect(screen.getAllByRole('button', { name: /confirm\?/i }).length).toBe(1);
    // first row is back to "Delete"
    const finalDeletes = screen.getAllByRole('button', { name: /delete/i });
    expect(finalDeletes.length).toBe(1); // row 1's button reverted; row 2 is now in confirm
  });
});
