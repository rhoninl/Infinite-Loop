'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Button, Chip } from '@heroui/react';
import Canvas from './components/canvas/Canvas';
import Palette from './components/Palette';
import ConfigPanel from './components/ConfigPanel';
import RunView from './components/RunView';
import RunHistory from './components/RunHistory';
import WorkflowMenu from './components/WorkflowMenu';
import ThemeToggle from './components/ThemeToggle';
import { useEngineWebSocket } from '../lib/client/ws-client';
import { useWorkflowStore } from '../lib/client/workflow-store-client';
import { useAutoSave } from '../lib/client/use-auto-save';
import type { RunStatus } from '../lib/shared/workflow';

const RUN_STATUS_COLOR: Record<
  RunStatus,
  'default' | 'success' | 'warning' | 'danger'
> = {
  idle: 'default',
  running: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'default',
};

const DEFAULT_WORKFLOW_ID = 'loop-claude-until-condition';
const RIGHT_WIDTH_STORAGE_KEY = 'infloop:right-width';
const RIGHT_WIDTH_DEFAULT = 440;
const RIGHT_WIDTH_MIN = 280;
const CANVAS_MIN_WIDTH = 360;

export default function Page() {
  useEngineWebSocket();
  useAutoSave();

  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow);
  const runStatus = useWorkflowStore((s) => s.runStatus);
  const wsStatus = useWorkflowStore((s) => s.connectionStatus);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const isRunning = runStatus === 'running';

  // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo. Skip when focus is in an
  // editable field — let the browser's native field-level undo win there so
  // typing in the prompt textarea isn't blown away by a workflow rollback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== 'z' && e.key !== 'Z') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const [rightWidth, setRightWidth] = useState<number>(RIGHT_WIDTH_DEFAULT);
  const [historyOpen, setHistoryOpen] = useState(false);
  const dragStateRef = useRef<{ active: boolean }>({ active: false });

  // Hydrate the persisted width on mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RIGHT_WIDTH_STORAGE_KEY);
      if (saved) {
        const n = Number(saved);
        if (Number.isFinite(n)) setRightWidth(clampRightWidth(n));
      }
    } catch {
      // localStorage may be unavailable; fall back to default
    }
  }, []);

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
        // leave canvas empty so the user can still create a fresh workflow
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentWorkflow, loadWorkflow]);

  const onResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStateRef.current.active = true;

    const onMove = (m: MouseEvent) => {
      if (!dragStateRef.current.active) return;
      const next = clampRightWidth(window.innerWidth - m.clientX);
      setRightWidth(next);
    };
    const onUp = () => {
      dragStateRef.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        // setRightWidth is async; read from the closure where setRightWidth's
        // newest value lives — the simplest reliable approach is to query the
        // grid element's computed width, but a microtask after the last move
        // event the React state has settled too. We just persist whatever
        // state currently is — schedule on the next tick.
        setTimeout(() => {
          try {
            window.localStorage.setItem(
              RIGHT_WIDTH_STORAGE_KEY,
              String(getCurrentRightWidth()),
            );
          } catch {
            // ignore
          }
        }, 0);
      } catch {
        // ignore
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

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
          <span
            className="brand-mark"
            data-ws={wsStatus}
            data-run={runStatus}
            aria-label={`event stream ${wsStatus}, run ${runStatus}`}
            title={`event stream ${wsStatus} · run ${runStatus}`}
          />
          <span className="brand-text">
            Inf·Loop<em>Console</em>
          </span>
        </div>

        <div className="crumbs">
          <WorkflowMenu />
        </div>

        <div className="actions">
          <ThemeToggle />
          <Button
            type="button"
            variant="bordered"
            aria-label="toggle run history"
            aria-pressed={historyOpen}
            onPress={() => setHistoryOpen((v) => !v)}
            isDisabled={isRunning}
            title={
              isRunning
                ? 'Run history is unavailable while a run is in progress'
                : undefined
            }
          >
            History
          </Button>
          <Chip
            variant="dot"
            color={RUN_STATUS_COLOR[runStatus]}
            aria-label={`run ${runStatus}`}
          >
            {runStatus}
          </Chip>
          {isRunning ? (
            <Button
              type="button"
              color="danger"
              onPress={handleStop}
              aria-label="stop run"
            >
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              color="success"
              onPress={handleRun}
              aria-label="run workflow"
              isDisabled={!currentWorkflow}
              title={
                !currentWorkflow
                  ? 'Open or create a workflow first'
                  : undefined
              }
            >
              Run
            </Button>
          )}
        </div>
      </header>

      <div
        className="workspace workspace-tri"
        style={{ '--right-w': `${rightWidth}px` } as CSSProperties}
      >
        <Palette />
        <Canvas />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="resize right panel"
          tabIndex={0}
          className="resize-gutter"
          onMouseDown={onResizeStart}
        />
        {isRunning ? (
          <RunView />
        ) : historyOpen ? (
          <RunHistory workflowId={currentWorkflow?.id} />
        ) : (
          <ConfigPanel />
        )}
      </div>
    </>
  );
}

function clampRightWidth(n: number): number {
  const max = Math.max(
    RIGHT_WIDTH_MIN,
    (typeof window !== 'undefined' ? window.innerWidth : 1600) -
      CANVAS_MIN_WIDTH -
      220, // palette width
  );
  return Math.min(max, Math.max(RIGHT_WIDTH_MIN, Math.floor(n)));
}

/** Read the live rendered right-panel width from the CSS custom property. */
function getCurrentRightWidth(): number {
  if (typeof document === 'undefined') return RIGHT_WIDTH_DEFAULT;
  const el = document.querySelector('.workspace-tri') as HTMLElement | null;
  if (!el) return RIGHT_WIDTH_DEFAULT;
  const v = el.style.getPropertyValue('--right-w');
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : RIGHT_WIDTH_DEFAULT;
}
