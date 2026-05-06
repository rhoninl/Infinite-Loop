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

  // Delete by id — one button per row in the list, shown on hover. Confirms
  // before destroying. Stops event propagation so it doesn't also fire the
  // row's pick handler.
  const onDeleteRow = async (id: string, name: string) => {
    const ok =
      typeof window === 'undefined'
        ? true
        : window.confirm(`Delete workflow "${name}"?`);
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/workflows/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete');
    }
  };

  // Trigger shows a small "•" while there are unsaved edits — it briefly
  // appears whenever the user changes the workflow and disappears when
  // auto-save settles. Mostly informational; users don't need to act on it.
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
                // Row is a wrapping <div> rather than a <button> so we can
                // nest a separate "delete" button inside without putting a
                // button-in-button (invalid HTML). Click anywhere except the
                // delete glyph picks the row; the × handler stops propagation.
                return (
                  <div
                    key={s.id}
                    aria-current={isCurrent}
                    className="wf-menu-row"
                  >
                    <button
                      type="button"
                      aria-label={`workflow ${s.id}`}
                      className="wf-menu-row-pick"
                      onClick={() => void onPickRow(s.id)}
                    >
                      <span className="wf-menu-row-name">{s.name}</span>
                      <span className="wf-menu-row-id">{s.id}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`delete workflow ${s.id}`}
                      className="wf-menu-row-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteRow(s.id, s.name);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
          </div>

          {/* Footer action: a single "+" button to create a new workflow.
           * Replaces the old SAVE / DUPLICATE / DELETE row — Save auto-fires
           * on change, Duplicate is gone, Delete moved per-row. */}
          <button
            type="button"
            aria-label="new workflow"
            className="wf-menu-new"
            onClick={() => void onNew()}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
