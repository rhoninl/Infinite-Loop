'use client';

import { useEffect, useMemo, useState } from 'react';
import TaskForm from './components/TaskForm';
import RunPanel from './components/RunPanel';
import { useRunEvents } from '../lib/client/ws-client';
import type { RunConfig, RunStatus } from '../lib/shared/types';

function deriveStatus(events: ReturnType<typeof useRunEvents>['events']): RunStatus {
  let status: RunStatus = 'idle';
  for (const ev of events) {
    if (ev.type === 'run_started') status = 'running';
    else if (ev.type === 'run_finished') status = ev.outcome;
  }
  return status;
}

function deriveIterationCount(events: ReturnType<typeof useRunEvents>['events']): number {
  let max = 0;
  for (const ev of events) {
    if ('n' in ev && typeof ev.n === 'number' && ev.n > max) max = ev.n;
  }
  return max;
}

function formatRuntime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s % 60}s`;
}

export default function Page() {
  const { events, status: wsStatus } = useRunEvents();
  const status = useMemo(() => deriveStatus(events), [events]);
  const iterCount = useMemo(() => deriveIterationCount(events), [events]);
  const isRunning = status === 'running';

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const lastStart = [...events].reverse().find((e) => e.type === 'run_started');
    if (lastStart && isRunning && startedAt === null) {
      setStartedAt(Date.now());
    }
    if (!isRunning) setStartedAt(null);
  }, [events, isRunning, startedAt]);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [isRunning]);

  const runtime = startedAt ? formatRuntime(now - startedAt) : '—';

  async function handleStart(cfg: RunConfig) {
    await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  }

  async function handleStop() {
    await fetch('/api/run/stop', { method: 'POST' });
  }

  return (
    <>
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-text">
            Inf·Loop<em>Console</em>
          </span>
        </div>

        <div className="crumbs">
          <span>
            Iter <strong>{iterCount.toString().padStart(2, '0')}</strong>
          </span>
          <span>
            T+ <strong>{runtime}</strong>
          </span>
        </div>

        <div className="actions">
          <span
            className="pill"
            data-status={wsStatus === 'open' ? 'running' : 'idle'}
            title={`WebSocket ${wsStatus}`}
          >
            <span className="dot" /> Link · {wsStatus}
          </span>
          <span className="pill" data-status={status}>
            <span className="dot" /> {status}
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail">
          <div className="section-eyebrow">Mission · 01</div>
          <h2 className="section-title">
            Configure <em>the loop</em>.
          </h2>
          <p className="section-sub">
            Each iteration spawns a fresh <span className="cipher">claude --print</span> in
            your working directory. The exit condition decides when to stop.
          </p>
          <TaskForm onSubmit={handleStart} disabled={isRunning} />
        </aside>

        <main className="main">
          <div className="section-eyebrow">Telemetry · 02</div>
          <h2 className="section-title">
            <em>Live</em> iterations.
          </h2>
          <p className="section-sub">
            Streaming over WebSocket. One row per iteration, with stdout, exit
            metrics, and the condition verdict.
          </p>
          <RunPanel events={events} wsStatus={wsStatus} onStop={handleStop} />
        </main>
      </div>
    </>
  );
}
