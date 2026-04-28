'use client';

import { useEffect, useRef, useState } from 'react';
import type { RunEvent, WsStatus } from '../shared/types';

export interface UseRunEventsResult {
  events: RunEvent[];
  status: WsStatus;
}

const RUN_EVENT_TYPES: ReadonlySet<RunEvent['type']> = new Set([
  'run_started',
  'iteration_started',
  'stdout_chunk',
  'iteration_finished',
  'condition_checked',
  'run_finished',
  'error',
]);

function isRunEvent(value: unknown): value is RunEvent {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  return typeof t === 'string' && RUN_EVENT_TYPES.has(t as RunEvent['type']);
}

export function useRunEvents(): UseRunEventsResult {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<WsStatus>('connecting');

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!mounted) return;
      const url = new URL('/ws', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);

      socket.addEventListener('open', () => {
        if (!mounted) return;
        setStatus('open');
      });

      socket.addEventListener('message', (event: MessageEvent) => {
        if (!mounted) return;
        if (typeof event.data !== 'string') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (isRunEvent(parsed)) {
          setEvents((prev) => [...prev, parsed]);
        }
      });

      const handleDrop = () => {
        if (!mounted) return;
        setStatus('closed');
        if (reconnectTimer !== null) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!mounted) return;
          setStatus('connecting');
          connect();
        }, 1000);
      };

      socket.addEventListener('close', handleDrop);
      socket.addEventListener('error', handleDrop);
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return { events, status };
}
