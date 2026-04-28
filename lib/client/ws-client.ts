'use client';

import { useEffect } from 'react';
import type { RunSnapshot, WorkflowEvent } from '../shared/workflow';
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

function isStateSnapshot(
  v: unknown,
): v is { type: 'state_snapshot'; state: RunSnapshot } {
  if (typeof v !== 'object' || v === null) return false;
  const t = (v as { type?: unknown }).type;
  return t === 'state_snapshot';
}

/**
 * Subscribe to the engine's Server-Sent Events stream and dispatch parsed
 * `WorkflowEvent`s into the Zustand store. Reconnects automatically on drop
 * (the browser's EventSource handles backoff itself; we surface the status).
 */
export function useEngineWebSocket(): void {
  const setConnectionStatus = useWorkflowStore((s) => s.setConnectionStatus);
  const appendRunEvent = useWorkflowStore((s) => s.appendRunEvent);
  const setRunStatus = useWorkflowStore((s) => s.setRunStatus);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const es = new EventSource('/api/events');
    setConnectionStatus('connecting');

    es.onopen = () => setConnectionStatus('open');

    es.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      try {
        const data = JSON.parse(e.data);
        if (isWorkflowEvent(data)) {
          appendRunEvent(data);
        } else if (isStateSnapshot(data)) {
          // Initial frame on connect: hydrate run status so a page refresh
          // mid-run shows RUNNING instead of idle. We can't rebuild the
          // historical event log (the engine doesn't keep one), but live
          // events from this point onward populate the log normally.
          if (data.state && typeof data.state.status === 'string') {
            setRunStatus(data.state.status);
          }
        }
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
