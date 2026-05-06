'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chip, Spinner } from '@heroui/react';
import { useWorkflowStore } from '../../lib/client/workflow-store-client';
import { GroupedEventLog } from './RunLog';
import type {
  NodeStartedEvent,
  RunStatus,
  WorkflowEvent,
} from '../../lib/shared/workflow';

// Map run status onto HeroUI semantic colors. `running` is warning (warm) so
// it reads as "in flight" rather than success or failure; cancelled stays
// neutral because the user chose to stop, not because anything went wrong.
const STATUS_COLOR: Record<RunStatus, 'warning' | 'success' | 'danger' | 'default'> = {
  idle: 'default',
  running: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'default',
};

/**
 * Walk events to find each `node_started` not yet matched by a `node_finished`
 * for the same nodeId. The map keeps it O(n) and tolerates re-entry (loops).
 */
function findRunningNodeEvents(events: WorkflowEvent[]): NodeStartedEvent[] {
  const inFlight = new Map<string, NodeStartedEvent>();
  for (const ev of events) {
    if (ev.type === 'node_started') {
      inFlight.set(ev.nodeId, ev);
    } else if (ev.type === 'node_finished') {
      inFlight.delete(ev.nodeId);
    }
  }
  return Array.from(inFlight.values());
}

export default function RunView() {
  const runStatus = useWorkflowStore((s) => s.runStatus);
  const runEvents = useWorkflowStore((s) => s.runEvents);
  const connectionStatus = useWorkflowStore((s) => s.connectionStatus);

  // Re-render on every animation frame while running so the elapsed-time
  // counter steps smoothly instead of jumping by 0.2-0.3s every interval
  // tick. rAF naturally pauses when the tab is backgrounded.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (runStatus !== 'running') return;
    let raf = 0;
    const loop = () => {
      setTick((n) => (n + 1) & 0xffff);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runStatus]);

  // Stick the log to the bottom while the user is reading the latest output,
  // but stop yanking them down if they have scrolled up to inspect history.
  // Re-engages once they scroll back near the bottom. The 48px threshold (~2
  // wrapped stdout lines) keeps streaming chunks from flipping us out of
  // stickiness when the user is essentially at the bottom.
  const logRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
    // Immunize against the synthetic scroll event the assignment above fires
    // — without this, a slightly off-by-one scrollTop value during the
    // browser's scroll-into-place could flip stickToBottom to false.
    stickToBottomRef.current = true;
  }, [runEvents.length]);
  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  };

  const running = useMemo(
    () => findRunningNodeEvents(runEvents),
    [runEvents],
  );

  // Track the wall-clock time at which each in-flight node was first seen so
  // the elapsed counter does not reset whenever an unrelated event arrives.
  const startedAtRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const startedAt = startedAtRef.current;
    const liveIds = new Set(running.map((e) => e.nodeId));
    for (const ev of running) {
      if (!startedAt.has(ev.nodeId)) startedAt.set(ev.nodeId, Date.now());
    }
    for (const id of startedAt.keys()) {
      if (!liveIds.has(id)) startedAt.delete(id);
    }
  }, [running]);

  return (
    <aside aria-label="run view" className="run-view">
      <header className="run-view-head">
        <Chip
          aria-label="run status"
          variant="dot"
          size="sm"
          color={STATUS_COLOR[runStatus]}
        >
          {runStatus}
        </Chip>
        <span className="run-view-ws" aria-label="event stream status">
          SSE: {connectionStatus}
        </span>
      </header>

      {running.length > 0 ? (
        <div className="run-view-current" aria-label="currently running">
          {running.map((ev) => {
            const since = startedAtRef.current.get(ev.nodeId) ?? Date.now();
            const elapsed = Date.now() - since;
            return (
              <div key={ev.nodeId} className="run-view-current-row">
                <Spinner
                  aria-label={`running ${ev.nodeId}`}
                  size="sm"
                  color="warning"
                />
                <span className="tag" data-kind="live">
                  <span className="dot" /> {ev.nodeType}
                </span>
                <span className="run-view-current-id">{ev.nodeId}</span>
                <span className="run-view-current-elapsed">
                  {(elapsed / 1000).toFixed(1)}s
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div
        ref={logRef}
        className="run-view-log"
        aria-label="event log"
        onScroll={onLogScroll}
      >
        <GroupedEventLog events={runEvents} />
      </div>
    </aside>
  );
}
