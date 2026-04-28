'use client';

import { useEffect } from 'react';
import type { WorkflowEvent } from '../shared/workflow';
import { useWorkflowStore } from './workflow-store-client';

const VALID_EVENT_TYPES = new Set<WorkflowEvent['type']>([
  'run_started',
  'node_started',
  'node_finished',
  'stdout_chunk',
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

/**
 * Subscribe to the engine's Server-Sent Events stream and dispatch parsed
 * `WorkflowEvent`s into the Zustand store. Reconnects automatically on drop
 * (the browser's EventSource handles backoff itself; we surface the status).
 */
export function useEngineWebSocket(): void {
  const setConnectionStatus = useWorkflowStore((s) => s.setConnectionStatus);
  const appendRunEvent = useWorkflowStore((s) => s.appendRunEvent);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const es = new EventSource('/api/events');
    setConnectionStatus('connecting');

    es.onopen = () => setConnectionStatus('open');

    es.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      try {
        const data = JSON.parse(e.data);
        if (isWorkflowEvent(data)) appendRunEvent(data);
        // non-RunEvent messages (e.g. initial state_snapshot) are ignored
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; just reflect the transient state.
      setConnectionStatus('closed');
    };

    return () => {
      es.close();
    };
  }, [setConnectionStatus, appendRunEvent]);
}
