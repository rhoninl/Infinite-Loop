import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DELETE } from './route';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

beforeEach(() => triggerQueue.clear());
afterEach(() => triggerQueue.clear());

function fakeWorkflow(id: string) {
  return { id, name: id, version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any;
}

describe('DELETE /api/triggers/queue/[queueId]', () => {
  test('returns 204 and removes the item when it exists', async () => {
    const { queueId } = triggerQueue.enqueue({
      workflow: fakeWorkflow('w'),
      resolvedInputs: {},
      triggerId: 't',
      receivedAt: 1,
    });
    expect(triggerQueue.size()).toBe(1);

    const req = new Request(`http://test/api/triggers/queue/${queueId}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ queueId }) });

    expect(res.status).toBe(204);
    expect(triggerQueue.size()).toBe(0);
  });

  test('returns 404 with not-in-queue when the id is unknown', async () => {
    const queueId = 'q-nope';
    const req = new Request(`http://test/api/triggers/queue/${queueId}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ queueId }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('not-in-queue');
  });
});
