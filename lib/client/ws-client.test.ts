import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRunEvents } from './ws-client';

type Listener = (event: unknown) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  private listeners: Record<string, Listener[]> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  constructor(url: string | URL) {
    this.url = typeof url === 'string' ? url : url.toString();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: Listener) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }

  close() {
    this.readyState = 3;
  }

  triggerOpen() {
    this.readyState = 1;
    for (const fn of this.listeners.open) fn({});
  }

  triggerMessage(data: string) {
    for (const fn of this.listeners.message) fn({ data });
  }

  triggerClose() {
    this.readyState = 3;
    for (const fn of this.listeners.close) fn({});
  }

  triggerError() {
    for (const fn of this.listeners.error) fn({});
  }
}

describe('useRunEvents', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket =
      FakeWebSocket as unknown;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in connecting state with no events', () => {
    const { result } = renderHook(() => useRunEvents());
    expect(result.current.status).toBe('connecting');
    expect(result.current.events).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('transitions to open on socket open', () => {
    const { result } = renderHook(() => useRunEvents());
    act(() => {
      FakeWebSocket.instances[0].triggerOpen();
    });
    expect(result.current.status).toBe('open');
  });

  it('appends RunEvent messages to events', () => {
    const { result } = renderHook(() => useRunEvents());
    act(() => {
      FakeWebSocket.instances[0].triggerOpen();
      FakeWebSocket.instances[0].triggerMessage(
        JSON.stringify({ type: 'iteration_started', n: 1 }),
      );
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toEqual({
      type: 'iteration_started',
      n: 1,
    });
  });

  it('ignores non-RunEvent messages such as state_snapshot', () => {
    const { result } = renderHook(() => useRunEvents());
    act(() => {
      FakeWebSocket.instances[0].triggerOpen();
      FakeWebSocket.instances[0].triggerMessage(
        JSON.stringify({ type: 'state_snapshot', state: { status: 'idle' } }),
      );
    });
    expect(result.current.events).toEqual([]);
  });

  it('sets status to closed and reconnects after 1000ms', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRunEvents());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => {
      FakeWebSocket.instances[0].triggerClose();
    });
    expect(result.current.status).toBe('closed');
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('does not reconnect after unmount during connecting', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useRunEvents());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => {
      unmount();
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
