import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  readyState = 0;
  url: string;
  closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeSocket.instances.push(this);
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  triggerMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
  triggerClose() {
    this.readyState = 3;
    this.onclose?.(new Event('close'));
  }
  close() {
    this.closed = true;
  }
}

describe('useEngineWebSocket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket as unknown;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a socket on mount and dispatches valid events into the store', async () => {
    const { useWorkflowStore } = await import('./workflow-store-client');
    const { useEngineWebSocket } = await import('./ws-client');

    useWorkflowStore.getState().resetRun();

    const { unmount } = renderHook(() => useEngineWebSocket());
    expect(FakeSocket.instances.length).toBe(1);
    const sock = FakeSocket.instances[0];

    act(() => sock.triggerOpen());
    expect(useWorkflowStore.getState().connectionStatus).toBe('open');

    act(() =>
      sock.triggerMessage(
        JSON.stringify({ type: 'run_started', workflowId: 'w', workflowName: 'W' }),
      ),
    );
    expect(
      useWorkflowStore.getState().runEvents.some((e) => e.type === 'run_started'),
    ).toBe(true);

    const before = useWorkflowStore.getState().runEvents.length;
    act(() => sock.triggerMessage(JSON.stringify({ type: 'state_snapshot' })));
    expect(useWorkflowStore.getState().runEvents.length).toBe(before);

    unmount();
    expect(sock.closed).toBe(true);
  });

  it('reconnects roughly 1s after a drop', async () => {
    const { useEngineWebSocket } = await import('./ws-client');
    renderHook(() => useEngineWebSocket());
    const first = FakeSocket.instances[0];
    act(() => first.triggerOpen());
    act(() => first.triggerClose());
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(FakeSocket.instances.length).toBe(2);
  });
});
