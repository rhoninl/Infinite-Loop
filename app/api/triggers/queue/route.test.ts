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

  test('returns items array with positions and workflow names', async () => {
    triggerQueue.enqueue({
      workflow: { id: 'w1', name: 'First', version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any,
      resolvedInputs: {},
      triggerId: 'trig-1',
      receivedAt: 100,
    });
    triggerQueue.enqueue({
      workflow: { id: 'w2', name: 'Second', version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any,
      resolvedInputs: {},
      triggerId: 'trig-2',
      receivedAt: 200,
    });

    const res = await GET(new Request('http://test/api/triggers/queue'));
    const json = await res.json();

    expect(json.size).toBe(2);
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.items).toHaveLength(2);
    expect(json.items[0]).toMatchObject({
      triggerId: 'trig-1',
      workflowId: 'w1',
      workflowName: 'First',
      receivedAt: 100,
      position: 1,
    });
    expect(json.items[1]).toMatchObject({
      triggerId: 'trig-2',
      workflowId: 'w2',
      workflowName: 'Second',
      position: 2,
    });
    // Each item also has a queueId
    expect(typeof json.items[0].queueId).toBe('string');
  });

  test('empty queue returns items: []', async () => {
    const res = await GET(new Request('http://test/api/triggers/queue'));
    const json = await res.json();
    expect(json.items).toEqual([]);
  });
});
