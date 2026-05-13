import { afterEach, describe, expect, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
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
});
