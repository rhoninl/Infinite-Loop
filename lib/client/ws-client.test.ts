import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  triggerOpen() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }
  triggerMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
  triggerError() {
    this.onerror?.(new Event('error'));
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe('useEngineWebSocket (SSE)', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource =
      FakeEventSource as unknown;
  });
  afterEach(() => {
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });

  it('opens an EventSource on mount and dispatches valid events into the store', async () => {
    const { useWorkflowStore } = await import('./workflow-store-client');
    const { useEngineWebSocket } = await import('./ws-client');

    useWorkflowStore.getState().resetRun();

    const { unmount } = renderHook(() => useEngineWebSocket());
    expect(FakeEventSource.instances.length).toBe(1);
    const es = FakeEventSource.instances[0];
    expect(es.url).toContain('/api/events');

    act(() => es.triggerOpen());
    expect(useWorkflowStore.getState().connectionStatus).toBe('open');

    act(() =>
      es.triggerMessage(
        JSON.stringify({ type: 'run_started', workflowId: 'w', workflowName: 'W' }),
      ),
    );
    expect(
      useWorkflowStore.getState().runEvents.some((e) => e.type === 'run_started'),
    ).toBe(true);

    const before = useWorkflowStore.getState().runEvents.length;
    act(() => es.triggerMessage(JSON.stringify({ type: 'state_snapshot' })));
    expect(useWorkflowStore.getState().runEvents.length).toBe(before);

    unmount();
    expect(es.closed).toBe(true);
  });

  it('marks connection closed on transient error (EventSource auto-reconnects)', async () => {
    const { useWorkflowStore } = await import('./workflow-store-client');
    const { useEngineWebSocket } = await import('./ws-client');
    renderHook(() => useEngineWebSocket());
    const es = FakeEventSource.instances[0];
    act(() => es.triggerOpen());
    act(() => es.triggerError());
    expect(useWorkflowStore.getState().connectionStatus).toBe('closed');
  });
});
