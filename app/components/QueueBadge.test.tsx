import { afterEach, describe, expect, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { QueueBadge } from './QueueBadge';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchResponse(payload: unknown) {
  // @ts-expect-error globalThis.fetch override
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => payload,
  });
}

describe('QueueBadge', () => {
  test('renders nothing when queue is empty', async () => {
    mockFetchResponse({ size: 0 });
    const { container } = render(<QueueBadge pollMs={50} />);
    await waitFor(() => {
      expect(container.textContent).toBe('');
    });
  });

  test('renders count when queue is non-empty', async () => {
    mockFetchResponse({ size: 3, head: { triggerId: 't', workflowId: 'w', position: 1 } });
    render(<QueueBadge pollMs={50} />);
    await waitFor(() => {
      expect(screen.getByText(/3 queued/i)).toBeTruthy();
    });
  });
});
