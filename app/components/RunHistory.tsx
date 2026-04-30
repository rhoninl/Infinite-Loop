'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RunRecord,
  RunSummary,
  WorkflowEvent,
} from '../../lib/shared/workflow';

interface Props {
  workflowId: string | undefined;
}

function formatPayload(ev: WorkflowEvent): string {
  switch (ev.type) {
    case 'run_started':
      return `${ev.workflowName} (${ev.workflowId})`;
    case 'node_started':
      return ev.nodeId;
    case 'node_finished':
      return `${ev.nodeId} → ${ev.branch}`;
    case 'condition_checked':
      return `${ev.nodeId} met:${ev.met ? 'Y' : 'N'} ${ev.detail}`;
    case 'template_warning':
      return `${ev.nodeId} missingKey:${ev.missingKey}`;
    case 'error':
      return ev.nodeId ? `${ev.nodeId} ${ev.message}` : ev.message;
    case 'run_finished':
      return ev.status;
    default:
      return '';
  }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem}s`;
}

export default function RunHistory({ workflowId }: Props) {
  const [summaries, setSummaries] = useState<RunSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Track which workflow the most recent in-flight list fetch was for, so a
  // stale response (older workflow's data arriving after the user switched)
  // can't overwrite a fresher list.
  const listForRef = useRef<string | undefined>(undefined);

  const refreshList = useCallback(async () => {
    if (!workflowId) {
      setSummaries([]);
      return;
    }
    listForRef.current = workflowId;
    const requestedFor = workflowId;
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch(
        `/api/runs?workflowId=${encodeURIComponent(workflowId)}`,
      );
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const data = (await res.json()) as { runs: RunSummary[] };
      if (listForRef.current !== requestedFor) return;
      setSummaries(data.runs ?? []);
    } catch (err) {
      if (listForRef.current !== requestedFor) return;
      setListError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      if (listForRef.current === requestedFor) setListLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Switching workflows clears any in-progress detail view.
  useEffect(() => {
    setSelectedRunId(null);
    setRecord(null);
    setRecordError(null);
  }, [workflowId]);

  useEffect(() => {
    if (!selectedRunId || !workflowId) {
      setRecord(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setRecordLoading(true);
      setRecordError(null);
      try {
        const res = await fetch(
          `/api/runs/${encodeURIComponent(workflowId)}/${encodeURIComponent(selectedRunId)}`,
        );
        if (!res.ok) throw new Error(`load failed: ${res.status}`);
        const data = (await res.json()) as { run: RunRecord };
        if (!cancelled) setRecord(data.run);
      } catch (err) {
        if (!cancelled) {
          setRecordError(err instanceof Error ? err.message : 'failed to load');
        }
      } finally {
        if (!cancelled) setRecordLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, workflowId]);

  if (selectedRunId) {
    return (
      <aside aria-label="run history detail" className="run-view">
        <header className="run-view-head">
          <button
            type="button"
            className="wf-menu-action"
            aria-label="back to history list"
            onClick={() => setSelectedRunId(null)}
          >
            ← back
          </button>
          {record ? (
            <span
              className="pill"
              aria-label="recorded run status"
              data-status={record.status}
            >
              <span className="dot" /> {record.status}
            </span>
          ) : null}
        </header>

        {recordLoading && (
          <div className="wf-menu-empty serif-italic">loading…</div>
        )}
        {recordError && !recordLoading && (
          <div
            className="wf-menu-empty wf-menu-error serif-italic"
            aria-label="run history error"
          >
            {recordError}
          </div>
        )}

        {record && !recordLoading && (
          <>
            <div className="run-view-log-row" aria-label="run metadata">
              <span className="run-view-log-type">started</span>
              <span className="run-view-log-payload">
                {fmtTime(record.startedAt)}
              </span>
            </div>
            <div className="run-view-log-row">
              <span className="run-view-log-type">duration</span>
              <span className="run-view-log-payload">
                {fmtDuration(record.durationMs)}
              </span>
            </div>
            {record.errorMessage ? (
              <div className="run-view-log-row">
                <span className="run-view-log-type">error</span>
                <span className="run-view-log-payload">
                  {record.errorMessage}
                </span>
              </div>
            ) : null}
            {record.truncated ? (
              <div className="run-view-log-row">
                <span className="run-view-log-type">notice</span>
                <span className="run-view-log-payload">
                  event log truncated — earliest events were dropped
                </span>
              </div>
            ) : null}

            <div className="run-view-log" aria-label="event log">
              {record.events.map((ev, idx) => {
                if (ev.type === 'stdout_chunk') {
                  return (
                    <div key={idx} className="run-view-log-row is-stdout">
                      <span className="stdout-prefix">{ev.nodeId} │</span>
                      <span className="stdout-line">{ev.line}</span>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="run-view-log-row">
                    <span className="run-view-log-type">{ev.type}</span>
                    <span className="run-view-log-payload">
                      {formatPayload(ev)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </aside>
    );
  }

  return (
    <aside aria-label="run history" className="run-view">
      <header className="run-view-head">
        <span className="run-view-ws">history</span>
      </header>

      {listLoading && (
        <div className="wf-menu-empty serif-italic">loading…</div>
      )}
      {listError && !listLoading && (
        <div
          className="wf-menu-empty wf-menu-error serif-italic"
          aria-label="run history error"
        >
          {listError}
        </div>
      )}
      {!listLoading && !listError && summaries.length === 0 && (
        <div className="wf-menu-empty serif-italic">
          {workflowId ? 'no recorded runs yet' : 'load a workflow first'}
        </div>
      )}

      <div className="run-view-log" aria-label="run history list">
        {summaries.map((s) => (
          <button
            key={s.runId}
            type="button"
            aria-label={`run ${s.runId}`}
            className="wf-menu-row"
            onClick={() => setSelectedRunId(s.runId)}
          >
            <span className="wf-menu-row-mark" data-status={s.status}>
              ●
            </span>
            <span className="wf-menu-row-name">{s.status}</span>
            <span className="wf-menu-row-id serif-italic">
              {fmtTime(s.startedAt)} · {fmtDuration(s.durationMs)} ·{' '}
              {s.eventCount} ev
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
