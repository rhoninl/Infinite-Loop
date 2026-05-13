import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GET } from './route';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

beforeEach(() => triggerQueue.clear());
afterEach(() => triggerQueue.clear());

describe('GET /api/triggers/queue', () => {
  test('returns size 0 when empty', async () => {
    const res = await GET(new Request('http://test/api/triggers/queue'));
    const json = await res.json();
    expect(json.size).toBe(0);
    expect(json.head).toBeUndefined();
  });

  test('returns head when non-empty', async () => {
    triggerQueue.enqueue({
      workflow: { id: 'w', name: 'x', version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any,
      resolvedInputs: {},
      triggerId: 'idAAAAAAAAAAAAAAAAAAAA',
      receivedAt: 1,
    });
    const res = await GET(new Request('http://test/api/triggers/queue'));
    const json = await res.json();
    expect(json.size).toBe(1);
    expect(json.head.workflowId).toBe('w');
    expect(json.head.triggerId).toBe('idAAAAAAAAAAAAAAAAAAAA');
    expect(json.head.position).toBe(1);
  });
});
