'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Workflow, WorkflowSummary } from '../../lib/shared/workflow';
import { useWorkflowStore } from '../../lib/client/workflow-store-client';

const NEW_WORKFLOW_DEFAULTS = () => {
  const now = Date.now();
  return {
    id: `workflow-${now}`,
    name: 'Untitled',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start' as const, position: { x: 80, y: 200 }, config: {} },
      {
        id: 'end-1',
        type: 'end' as const,
        position: { x: 520, y: 200 },
        config: { outcome: 'succeeded' as const },
      },
    ],
    edges: [
      { id: 'e1', source: 'start-1', sourceHandle: 'next' as const, target: 'end-1' },
    ],
    createdAt: now,
    updatedAt: now,
  } satisfies Workflow;
};

export default function WorkflowMenu() {
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const saveCurrentWorkflow = useWorkflowStore((s) => s.saveCurrentWorkflow);

  const [open, setOpen] = useState(false);
  const [summaries, setSummaries] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows');
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const data = (await res.json()) as { workflows: WorkflowSummary[] };
      setSummaries(data.workflows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refreshList();
  }, [open, refreshList]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onPickRow = async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      const data = (await res.json()) as { workflow?: Workflow };
      if (!data.workflow) throw new Error('malformed workflow response');
      loadWorkflow(data.workflow);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load workflow');
    }
  };

  const onNew = async () => {
    try {
      const body = NEW_WORKFLOW_DEFAULTS();
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const data = (await res.json()) as { workflow?: Workflow };
      if (!data.workflow) throw new Error('malformed create response');
      loadWorkflow(data.workflow);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create');
    }
  };

  const onDuplicate = async () => {
    if (!currentWorkflow) return;
    try {
      const now = Date.now();
      const copy: Workflow = {
        ...currentWorkflow,
        id: `${currentWorkflow.id}-copy-${now}`,
        name: `${currentWorkflow.name} (copy)`,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(copy),
      });
      if (!res.ok) throw new Error(`duplicate failed: ${res.status}`);
      const data = (await res.json()) as { workflow?: Workflow };
      if (!data.workflow) throw new Error('malformed duplicate response');
      loadWorkflow(data.workflow);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to duplicate');
    }
  };

  const onDelete = async () => {
    if (!currentWorkflow) return;
    const ok =
      typeof window === 'undefined'
        ? true
        : window.confirm(`Delete workflow "${currentWorkflow.name}"?`);
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/workflows/${encodeURIComponent(currentWorkflow.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete');
    }
  };

  const onSave = async () => {
    if (!currentWorkflow) return;
    try {
      await saveCurrentWorkflow();
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save');
    }
  };

  const triggerLabel = currentWorkflow
    ? `${currentWorkflow.name}${isDirty ? ' •' : ''}`
    : '(no workflow)';

  return (
    <div ref={rootRef} className="wf-menu">
      <button
        type="button"
        aria-label="workflow menu"
        aria-expanded={open}
        className="wf-menu-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="wf-menu-trigger-name">{triggerLabel}</span>
        <span className="wf-menu-trigger-caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open && (
        <div aria-label="workflow list" className="wf-menu-panel">
          <div className="wf-menu-list">
            {loading && (
              <div className="wf-menu-empty serif-italic">loading…</div>
            )}
            {error && !loading && (
              <div className="wf-menu-empty wf-menu-error serif-italic">
                {error}
              </div>
            )}
            {!loading && !error && summaries.length === 0 && (
              <div className="wf-menu-empty serif-italic">
                no saved workflows
              </div>
            )}
            {!loading &&
              !error &&
              summaries.map((s) => {
                const isCurrent = currentWorkflow?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`workflow ${s.id}`}
                    aria-current={isCurrent}
                    className="wf-menu-row"
                    onClick={() => void onPickRow(s.id)}
                  >
                    <span className="wf-menu-row-mark" aria-hidden="true">
                      {isCurrent ? '●' : ' '}
                    </span>
                    <span className="wf-menu-row-name">{s.name}</span>
                    <span className="wf-menu-row-id serif-italic">{s.id}</span>
                  </button>
                );
              })}
          </div>

          <div className="wf-menu-actions">
            <button
              type="button"
              aria-label="save workflow"
              className="wf-menu-action"
              disabled={!currentWorkflow || !isDirty}
              onClick={() => void onSave()}
            >
              save
            </button>
            <button
              type="button"
              aria-label="new workflow"
              className="wf-menu-action"
              onClick={() => void onNew()}
            >
              new
            </button>
            <button
              type="button"
              aria-label="duplicate workflow"
              className="wf-menu-action"
              disabled={!currentWorkflow}
              onClick={() => void onDuplicate()}
            >
              duplicate
            </button>
            <button
              type="button"
              aria-label="delete workflow"
              className="wf-menu-action wf-menu-action-danger"
              disabled={!currentWorkflow}
              onClick={() => void onDelete()}
            >
              delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
