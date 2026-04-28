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

export default function RunPanel(props: RunPanelProps) {
  const { events, wsStatus, onStop } = props;
  const model = useMemo(() => buildModel(events), [events]);
  const { currentStatus, iterations, errors } = model;
  const isRunning = currentStatus === 'running';

  return (
    <section aria-label="run panel" style={{ display: 'grid', gap: '0.75rem' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <span
          aria-label="run status"
          data-status={currentStatus}
          className={`status-badge status-${currentStatus}`}
          style={{
            padding: '0.2rem 0.6rem',
            border: '1px solid #888',
            borderRadius: '0.25rem',
            fontWeight: 600,
          }}
        >
          {currentStatus}
        </span>
        <span
          aria-label="websocket status"
          data-ws-status={wsStatus}
          style={{ fontSize: '0.9rem', color: '#555' }}
        >
          WS: {wsStatus}
        </span>
        {isRunning && (
          <button type="button" onClick={onStop} aria-label="stop run">
            Stop
          </button>
        )}
      </header>

      <ol
        aria-label="iterations"
        style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}
      >
        {iterations.map((it) => (
          <li
            key={it.n}
            data-iteration={it.n}
            aria-label={`iteration ${it.n}`}
            style={{
              border: '1px solid #ccc',
              borderRadius: '0.25rem',
              padding: '0.5rem',
            }}
          >
            <div style={{ fontWeight: 600 }}>Iteration {it.n}</div>
            <details>
              <summary>stdout ({it.stdoutLines.length} lines)</summary>
              <pre
                aria-label={`iteration ${it.n} stdout`}
                style={{ whiteSpace: 'pre-wrap', margin: 0 }}
              >
                {it.stdoutLines.join('\n')}
              </pre>
            </details>
            {it.finished && (
              <div aria-label={`iteration ${it.n} result`}>
                <span>exit: {String(it.finished.exitCode)}</span>
                {' · '}
                <span>duration: {it.finished.durationMs}ms</span>
                {it.finished.timedOut && (
                  <>
                    {' · '}
                    <span>timedOut: true</span>
                  </>
                )}
              </div>
            )}
            {it.condition && (
              <div aria-label={`iteration ${it.n} condition`}>
                <span>met: {String(it.condition.met)}</span>
                {' · '}
                <span>detail: {it.condition.detail}</span>
              </div>
            )}
          </li>
        ))}
      </ol>

      {errors.length > 0 && (
        <section aria-label="errors" style={{ color: '#a00' }}>
          <h3 style={{ margin: '0 0 0.25rem' }}>Errors</h3>
          <ul style={{ paddingLeft: '1rem', margin: 0 }}>
            {errors.map((err, i) => (
              <li key={i}>
                <div>{err.message}</div>
                {err.stderr && (
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {err.stderr}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
