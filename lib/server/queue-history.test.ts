import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eventBus } from './event-bus';
import { queueHistory, subscribeQueueHistory } from './queue-history';

// Other tests in the suite call eventBus.clear(), which strips the
// queueHistory singleton's subscription. Re-register it for each case here.
let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  queueHistory.clear();
  unsubscribe = subscribeQueueHistory(queueHistory);
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
});

describe('queueHistory', () => {
  it('records enqueued items as queued', () => {
    eventBus.emit({
      type: 'trigger_enqueued',
      queueId: 'q-1',
      triggerId: 't-1',
      workflowId: 'wf',
      position: 1,
      receivedAt: 100,
    });
    const entry = queueHistory.get('q-1');
    expect(entry?.state).toBe('queued');
    expect(entry?.workflowId).toBe('wf');
    expect(entry?.enqueuedAt).toBe(100);
  });

  it('transitions queued → started and captures runId', () => {
    eventBus.emit({
      type: 'trigger_enqueued',
      queueId: 'q-2',
      triggerId: 't-2',
      workflowId: 'wf',
      position: 1,
      receivedAt: 100,
    });
    eventBus.emit({
      type: 'trigger_started',
      queueId: 'q-2',
      triggerId: 't-2',
      workflowId: 'wf',
      runId: 'r-2',
    });
    const entry = queueHistory.get('q-2');
    expect(entry?.state).toBe('started');
    expect(entry?.runId).toBe('r-2');
    expect(entry?.enqueuedAt).toBe(100);
  });

  it('records removed with reason', () => {
    eventBus.emit({
      type: 'trigger_enqueued',
      queueId: 'q-3',
      triggerId: 't-3',
      workflowId: 'wf',
      position: 1,
      receivedAt: 50,
    });
    eventBus.emit({
      type: 'trigger_removed',
      queueId: 'q-3',
      triggerId: 't-3',
      workflowId: 'wf',
      reason: 'user-cancelled',
    });
    const entry = queueHistory.get('q-3');
    expect(entry?.state).toBe('removed');
    expect(entry?.reason).toBe('user-cancelled');
  });

  it('records dropped with reason', () => {
    eventBus.emit({
      type: 'trigger_enqueued',
      queueId: 'q-4',
      triggerId: 't-4',
      workflowId: 'wf',
      position: 1,
      receivedAt: 50,
    });
    eventBus.emit({
      type: 'trigger_dropped',
      queueId: 'q-4',
      triggerId: 't-4',
      reason: 'workflow-deleted',
    });
    const entry = queueHistory.get('q-4');
    expect(entry?.state).toBe('dropped');
    expect(entry?.reason).toBe('workflow-deleted');
    expect(entry?.workflowId).toBe('wf');
  });
});
