'use client';

import { useEffect } from 'react';
import Canvas from './components/canvas/Canvas';
import Palette from './components/Palette';
import ConfigPanel from './components/ConfigPanel';
import RunView from './components/RunView';
import WorkflowMenu from './components/WorkflowMenu';
import { useEngineWebSocket } from '../lib/client/ws-client';
import { useWorkflowStore } from '../lib/client/workflow-store-client';

const DEFAULT_WORKFLOW_ID = 'loop-claude-until-condition';

export default function Page() {
  useEngineWebSocket();

  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow);
  const runStatus = useWorkflowStore((s) => s.runStatus);
  const wsStatus = useWorkflowStore((s) => s.connectionStatus);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const isRunning = runStatus === 'running';

  useEffect(() => {
    if (currentWorkflow) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workflows/${DEFAULT_WORKFLOW_ID}`);
        if (!res.ok) return;
        const data = await res.json();
        const wf = data?.workflow;
        if (!cancelled && wf) loadWorkflow(wf);
      } catch {
        // network or parse error — leave canvas empty so the user can still
        // create a fresh workflow from the menu
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentWorkflow, loadWorkflow]);

  async function handleRun() {
    if (!currentWorkflow) return;
    await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: currentWorkflow.id }),
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
          <WorkflowMenu />
        </div>

        <div className="actions">
          <span className="pill" data-status={wsStatus === 'open' ? 'running' : 'idle'}>
            <span className="dot" /> Link · {wsStatus}
          </span>
          <span className="pill" data-status={runStatus}>
            <span className="dot" /> {runStatus}
          </span>
          {isRunning ? (
            <button
              type="button"
              onClick={handleStop}
              className="btn btn-stop"
              aria-label="stop run"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              className="btn"
              aria-label="run workflow"
              disabled={!currentWorkflow}
            >
              Run
            </button>
          )}
        </div>
      </header>

      <div className="workspace workspace-tri">
        <Palette />
        <Canvas />
        {isRunning ? <RunView /> : <ConfigPanel />}
      </div>
    </>
  );
}
