'use client';

import { useMemo } from 'react';
import type {
  ErrorEvent,
  RunEvent,
  RunStatus,
  WsStatus,
} from '../../lib/shared/types';

export interface RunPanelProps {
  events: RunEvent[];
  wsStatus: WsStatus;
  onStop: () => void;
}

interface IterationFinishedFields {
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

interface ConditionCheckedFields {
  met: boolean;
  detail: string;
}

interface IterationView {
  n: number;
  stdoutLines: string[];
  finished?: IterationFinishedFields;
  condition?: ConditionCheckedFields;
}

interface RenderModel {
  currentStatus: RunStatus;
  iterations: IterationView[];
  errors: ErrorEvent[];
}

function buildModel(events: RunEvent[]): RenderModel {
  let currentStatus: RunStatus = 'idle';
  const iterMap = new Map<number, IterationView>();
  const errors: ErrorEvent[] = [];

  const ensure = (n: number): IterationView => {
    let entry = iterMap.get(n);
    if (!entry) {
      entry = { n, stdoutLines: [] };
      iterMap.set(n, entry);
    }
    return entry;
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'run_started':
        currentStatus = 'running';
        break;
      case 'iteration_started':
        ensure(ev.n);
        break;
      case 'stdout_chunk':
        ensure(ev.n).stdoutLines.push(ev.line);
        break;
      case 'iteration_finished':
        ensure(ev.n).finished = {
          exitCode: ev.exitCode,
          durationMs: ev.durationMs,
          timedOut: ev.timedOut,
        };
        break;
      case 'condition_checked':
        ensure(ev.n).condition = { met: ev.met, detail: ev.detail };
        break;
      case 'run_finished':
        currentStatus = ev.outcome;
        break;
      case 'error':
        errors.push(ev);
        break;
    }
  }

  const iterations = [...iterMap.values()].sort((a, b) => a.n - b.n);
  return { currentStatus, iterations, errors };
}

function iterCardState(it: IterationView, runStatus: RunStatus): string {
  if (!it.finished) return runStatus === 'running' ? 'live' : 'idle';
  if (it.condition?.met) return 'succeeded';
  if (it.finished.timedOut || it.finished.exitCode !== 0) return 'failed';
  return 'finished';
}

export default function RunPanel(props: RunPanelProps) {
  const { events, wsStatus, onStop } = props;
  const model = useMemo(() => buildModel(events), [events]);
  const { currentStatus, iterations, errors } = model;
  const isRunning = currentStatus === 'running';

  return (
    <section aria-label="run panel">
      <div
        style={{
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          marginBottom: 22,
          flexWrap: 'wrap',
        }}
      >
        <span
          aria-label="run status"
          data-status={currentStatus}
          className="pill"
        >
          <span className="dot" />
          {currentStatus}
        </span>
        <span
          aria-label="websocket status"
          data-ws-status={wsStatus}
          style={{
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)',
          }}
        >
          WS: {wsStatus}
        </span>
        {isRunning && (
          <button
            type="button"
            onClick={onStop}
            aria-label="stop run"
            className="btn btn-stop"
          >
            Stop
          </button>
        )}
      </div>

      {iterations.length === 0 && (
        <div className="empty">
          <div className="empty-num">∅</div>
          <div className="empty-text">awaiting first iteration</div>
        </div>
      )}
      <ol aria-label="iterations" className="timeline">
        {iterations.map((it) => {
            const state = iterCardState(it, currentStatus);
            const stdoutLines = it.stdoutLines;
            return (
              <li
                key={it.n}
                data-iteration={it.n}
                aria-label={`iteration ${it.n}`}
                className="iter-card"
                data-state={state}
              >
                <div className="iter-num-rail">
                  <div className="iter-num">
                    {it.n.toString().padStart(2, '0')}
                  </div>
                  <div className="iter-num-label">iter</div>
                </div>

                <div className="iter-body">
                  <div className="iter-head">
                    <div className="iter-head-left">
                      {state === 'live' && (
                        <span className="tag" data-kind="live">
                          <span className="dot" /> live
                        </span>
                      )}
                      {state === 'succeeded' && (
                        <span className="tag" data-kind="ok">
                          <span className="dot" /> condition met
                        </span>
                      )}
                      {state === 'failed' && (
                        <span className="tag" data-kind="err">
                          <span className="dot" /> failed
                        </span>
                      )}
                      {state === 'finished' && (
                        <span className="tag">
                          <span className="dot" /> not met
                        </span>
                      )}
                    </div>
                    {it.finished && (
                      <div className="metric-row" aria-label={`iteration ${it.n} result`}>
                        <span>
                          <span className="label">exit</span>
                          <var>: {String(it.finished.exitCode)}</var>
                        </span>
                        <span>
                          <span className="label">duration</span>
                          <var>: {it.finished.durationMs}ms</var>
                        </span>
                        {it.finished.timedOut && (
                          <span style={{ color: 'var(--accent-err)' }}>
                            <span className="label">timedOut</span>
                            <var>: true</var>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <details className="stdout" open={state === 'live'}>
                    <summary>
                      stdout · {stdoutLines.length}{' '}
                      {stdoutLines.length === 1 ? 'line' : 'lines'}
                    </summary>
                    <pre aria-label={`iteration ${it.n} stdout`}>
                      {stdoutLines.join('\n')}
                    </pre>
                  </details>

                  {it.condition && (
                    <div
                      className="condition-line"
                      data-met={String(it.condition.met)}
                      aria-label={`iteration ${it.n} condition`}
                    >
                      <span className="verdict">
                        {it.condition.met ? '✓ met' : '✗ not met'}
                      </span>
                      <span className="detail" style={{ display: 'none' }}>
                        met: {String(it.condition.met)}
                      </span>
                      <span className="detail">detail: {it.condition.detail}</span>
                    </div>
                  )}
                </div>
              </li>
            );
        })}
      </ol>

      {errors.length > 0 && (
        <section aria-label="errors" className="errors">
          <h3>Errors</h3>
          <ul>
            {errors.map((err, i) => (
              <li key={i}>
                <div>{err.message}</div>
                {err.stderr && <pre>{err.stderr}</pre>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
