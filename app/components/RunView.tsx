'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../../lib/client/workflow-store-client';
import { GroupedEventLog } from './RunLog';
import type {
  NodeStartedEvent,
  WorkflowEvent,
} from '../../lib/shared/workflow';

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

  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runEvents.length]);

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
        <span className="pill" aria-label="run status" data-status={runStatus}>
          <span className="dot" /> {runStatus}
        </span>
        <span className="run-view-ws" aria-label="websocket status">
          WS: {connectionStatus}
        </span>
      </header>

      {running.length > 0 ? (
        <div className="run-view-current" aria-label="currently running">
          {running.map((ev) => {
            const since = startedAtRef.current.get(ev.nodeId) ?? Date.now();
            const elapsed = Date.now() - since;
            return (
              <div key={ev.nodeId} className="run-view-current-row">
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

      <div ref={logRef} className="run-view-log" aria-label="event log">
        <GroupedEventLog events={runEvents} />
      </div>
    </aside>
  );
}
