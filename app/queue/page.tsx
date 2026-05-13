'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

export const CONFIRM_TIMEOUT_MS = 4000;

interface QueueItem {
  queueId: string;
  triggerId: string;
  workflowId: string;
  workflowName: string;
  receivedAt: number;
  position: number;
}

interface QueueResponse {
  size: number;
  items: QueueItem[];
}

function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString();
}

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/triggers/queue');
        if (!res.ok) return;
        const json = (await res.json()) as QueueResponse;
        if (alive) {
          setItems(json.items ?? []);
          setLoaded(true);
        }
      } catch {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      try {
        const data = JSON.parse(e.data);
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
        const t = data.type as string;

        if (t === 'trigger_enqueued') {
          setItems((prev) => {
            if (prev.some((it) => it.queueId === data.queueId)) return prev;
            return [
              ...prev,
              {
                queueId: data.queueId,
                triggerId: data.triggerId,
                workflowId: data.workflowId,
                workflowName: data.workflowId, // refined by next refetch / page reload
                receivedAt: data.receivedAt,
                position: prev.length + 1,
              },
            ];
          });
          return;
        }

        if (t === 'trigger_started' || t === 'trigger_dropped' || t === 'trigger_removed') {
          setItems((prev) => prev.filter((it) => it.queueId !== data.queueId));
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => { es.close(); };
  }, []);

  // Clear the confirm auto-revert timer on unmount
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current !== null) {
        clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  const startConfirm = useCallback((queueId: string) => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
    }
    setConfirming(queueId);
    confirmTimerRef.current = setTimeout(() => {
      setConfirming(null);
      confirmTimerRef.current = null;
    }, CONFIRM_TIMEOUT_MS);
  }, []);

  const cancelConfirm = useCallback(() => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirming(null);
  }, []);

  const doDelete = useCallback(async (queueId: string) => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    // Snapshot before optimistic removal so we can restore on failure
    let snapshot: QueueItem[] = [];
    setItems((prev) => {
      snapshot = prev;
      return prev.filter((it) => it.queueId !== queueId);
    });
    setConfirming(null);
    try {
      const res = await fetch(`/api/triggers/queue/${queueId}`, { method: 'DELETE' });
      if (res.status === 204) {
        // success — nothing more to do
      } else if (res.status === 404) {
        // Row is already gone server-side; SSE will handle removal if it hasn't yet.
        setNotice('Already started — couldn\'t cancel');
        setTimeout(() => setNotice(null), 3000);
      } else {
        // Unexpected error — restore the row so the user knows nothing was deleted
        setItems(snapshot);
        setNotice('Failed to cancel — please retry');
      }
    } catch {
      // Network error — restore the row
      setItems(snapshot);
      setNotice('Failed to cancel — please retry');
    }
  }, []);

  return (
    <main className="queue-page">
      <header className="queue-page-header">
        <h1>Trigger Queue</h1>
        <span className="queue-count">{items.length} queued</span>
      </header>

      {notice && <p className="queue-notice">{notice}</p>}

      {loaded && items.length === 0 ? (
        <p className="queue-empty">No queued runs.</p>
      ) : (
        <table className="queue-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Workflow</th>
              <th>Trigger</th>
              <th>Queued at</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const isConfirming = confirming === it.queueId;
              return (
                <tr
                  key={it.queueId}
                  className="queue-row"
                  data-confirming={isConfirming || undefined}
                >
                  <td>{idx + 1}</td>
                  <td>{it.workflowName}</td>
                  <td>{it.triggerId}</td>
                  <td>{formatTime(it.receivedAt)}</td>
                  <td className="queue-row-actions">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-stop"
                          onClick={() => doDelete(it.queueId)}
                        >
                          Confirm?
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={cancelConfirm}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => startConfirm(it.queueId)}
                      >
                        ✕ Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
