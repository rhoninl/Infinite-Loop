import { describe, expect, test } from 'bun:test';
import { triggerQueue } from './trigger-queue-singleton';

describe('triggerQueue singleton', () => {
  test('exists and exposes the TriggerQueue interface', () => {
    expect(typeof triggerQueue.enqueue).toBe('function');
    expect(typeof triggerQueue.drain).toBe('function');
    expect(typeof triggerQueue.size).toBe('function');
  });
});
