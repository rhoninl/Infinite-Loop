'use client';

import TaskForm from './components/TaskForm';
import RunPanel from './components/RunPanel';
import { useRunEvents } from '../lib/client/ws-client';
import type { RunConfig } from '../lib/shared/types';

export default function Page() {
  const { events, status } = useRunEvents();

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
    <main>
      <h1>InfLoop</h1>
      <p>
        Drive the Claude Code CLI in a loop until a condition is met. WebSocket
        status: <strong>{status}</strong>.
      </p>
      <TaskForm onSubmit={handleStart} />
      <RunPanel events={events} wsStatus={status} onStop={handleStop} />
    </main>
  );
}
