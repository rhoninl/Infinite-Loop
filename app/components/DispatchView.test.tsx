import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { DispatchView } from './DispatchView';
import type { WebhookTrigger, WebhookPlugin } from '@/lib/shared/trigger';

const triggers: WebhookTrigger[] = [
  {
    id: 'idAAAAAAAAAAAAAAAAAAAA', name: 'github-issue-opened',
    enabled: true, workflowId: 'code-review',
    pluginId: 'github', eventType: 'issues',
    match: [], inputs: {}, lastFiredAt: null, createdAt: 1, updatedAt: 1,
  },
  {
    id: 'idBBBBBBBBBBBBBBBBBBBB', name: 'generic-debug',
    enabled: false, workflowId: 'test-flow',
    pluginId: 'generic', match: [], inputs: {},
    lastFiredAt: 1_700_000_000_000, createdAt: 1, updatedAt: 1,
  },
];

const plugins: WebhookPlugin[] = [
  { id: 'generic', displayName: 'Generic', events: [{ type: 'any', displayName: 'Any', fields: [] }] },
  { id: 'github', displayName: 'GitHub', eventHeader: 'x-github-event', events: [{ type: 'issues', displayName: 'Issue', fields: [] }] },
];

const workflows = [
  { id: 'code-review', name: 'Code review', inputs: [] },
  { id: 'test-flow', name: 'Test flow', inputs: [] },
];

const originalFetch = globalThis.fetch;
const originalHash = window.location.hash;

beforeEach(() => { window.location.hash = ''; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  window.location.hash = originalHash;
});

function mockFetch(routes: Record<string, unknown>) {
  // @ts-expect-error fetch override
  globalThis.fetch = async (url: string) => {
    const path = typeof url === 'string' ? url : (url as Request).url;
    const key = Object.keys(routes).find((k) => path.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${path}`);
    return { ok: true, json: async () => routes[key] };
  };
}

describe('DispatchView', () => {
  test('lists triggers fetched from the API', async () => {
    mockFetch({
      '/api/triggers': { triggers },
      '/api/webhook-plugins': { plugins },
      '/api/workflows': { workflows },
    });
    render(<DispatchView origin="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText('github-issue-opened')).toBeTruthy();
      expect(screen.getByText('generic-debug')).toBeTruthy();
    });
  });

  test('renders empty state when no triggers exist', async () => {
    mockFetch({
      '/api/triggers': { triggers: [] },
      '/api/webhook-plugins': { plugins },
      '/api/workflows': { workflows },
    });
    render(<DispatchView origin="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(/No triggers yet/i)).toBeTruthy();
    });
  });

  test('filters list when hash has workflow=<id>', async () => {
    window.location.hash = '#dispatch?workflow=test-flow';
    mockFetch({
      '/api/triggers': { triggers },
      '/api/webhook-plugins': { plugins },
      '/api/workflows': { workflows },
    });
    render(<DispatchView origin="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.queryByText('github-issue-opened')).toBeNull();
      expect(screen.getByText('generic-debug')).toBeTruthy();
    });
    window.location.hash = '';
  });
});
