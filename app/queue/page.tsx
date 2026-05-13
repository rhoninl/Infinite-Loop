'use client';

import React, { useEffect, useState, useCallback } from 'react';

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

  const startConfirm = useCallback((queueId: string) => {
    setConfirming(queueId);
  }, []);

  const cancelConfirm = useCallback(() => {
    setConfirming(null);
  }, []);

  const doDelete = useCallback(async (queueId: string) => {
    setItems((prev) => prev.filter((it) => it.queueId !== queueId));
    setConfirming(null);
    try {
      await fetch(`/api/triggers/queue/${queueId}`, { method: 'DELETE' });
    } catch {
      // SSE will re-sync on reconnect; not retrying.
    }
  }, []);

  return (
    <main className="queue-page">
      <header className="queue-page-header">
        <h1>Trigger Queue</h1>
        <span className="queue-count">{items.length} queued</span>
      </header>

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
