'use client';

import { useEffect } from 'react';
import type { WorkflowEvent } from '../shared/workflow';
import { useWorkflowStore } from './workflow-store-client';

const VALID_EVENT_TYPES = new Set<WorkflowEvent['type']>([
  'run_started',
  'node_started',
  'node_finished',
  'condition_checked',
  'template_warning',
  'error',
  'run_finished',
]);

function isWorkflowEvent(v: unknown): v is WorkflowEvent {
  if (typeof v !== 'object' || v === null) return false;
  const t = (v as { type?: unknown }).type;
  return typeof t === 'string' && VALID_EVENT_TYPES.has(t as WorkflowEvent['type']);
}

export function useEngineWebSocket(): void {
  const setConnectionStatus = useWorkflowStore((s) => s.setConnectionStatus);
  const appendRunEvent = useWorkflowStore((s) => s.appendRunEvent);

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!mounted) return;
      const url = new URL('/ws', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url);
      socket = ws;
      setConnectionStatus('connecting');

      ws.onopen = () => {
        if (mounted) setConnectionStatus('open');
      };

      ws.onmessage = (e) => {
        if (!mounted) return;
        if (typeof e.data !== 'string') return;
        try {
          const data = JSON.parse(e.data);
          if (isWorkflowEvent(data)) appendRunEvent(data);
        } catch {
          // ignore non-JSON
        }
      };

      const handleDrop = () => {
        if (!mounted) return;
        setConnectionStatus('closed');
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 1000);
      };
      ws.onclose = handleDrop;
      ws.onerror = handleDrop;
    };

    connect();
    return () => {
      mounted = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    };
  }, [setConnectionStatus, appendRunEvent]);
}
