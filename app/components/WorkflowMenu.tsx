'use client';

import { useState } from 'react';
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from '@heroui/react';
import type { Workflow, WorkflowSummary } from '../../lib/shared/workflow';
import { useWorkflowStore } from '../../lib/client/workflow-store-client';

const NEW_WORKFLOW_DEFAULTS = (): Workflow => {
  const now = Date.now();
  return {
    id: `workflow-${now}`,
    name: 'Untitled',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start', position: { x: 80, y: 200 }, config: {} },
      {
        id: 'end-1',
        type: 'end',
        position: { x: 520, y: 200 },
        config: { outcome: 'succeeded' },
      },
    ],
    edges: [
      { id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'end-1' },
    ],
    createdAt: now,
    updatedAt: now,
  } satisfies Workflow;
};

// Stable key for the placeholder row shown while the list is loading,
// errored, or empty. Disabled so it can't be selected.
const STATE_KEY = '__state__';
// Action keys are prefixed so onAction can route them without colliding
// with workflow-row keys.
const WF_KEY_PREFIX = 'wf:';
const ACTION_KEYS = {
  save: 'action:save',
  new: 'action:new',
  duplicate: 'action:duplicate',
  delete: 'action:delete',
} as const;

export default function WorkflowMenu() {
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const saveCurrentWorkflow = useWorkflowStore((s) => s.saveCurrentWorkflow);
  const isDirty = useWorkflowStore((s) => s.isDirty);

  const [summaries, setSummaries] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = async () => {
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
  };

  const onPickRow = async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      const data = (await res.json()) as { workflow?: Workflow };
      if (!data.workflow) throw new Error('malformed workflow response');
      loadWorkflow(data.workflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load workflow');
    }
  };

  const onSave = async () => {
    try {
      await saveCurrentWorkflow();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save');
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
        id: `workflow-${now}`,
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

  // Trigger shows a small "•" while there are unsaved edits. Mostly informational.
  const triggerLabel = currentWorkflow
    ? `${currentWorkflow.name}${isDirty ? ' •' : ''}`
    : '(no workflow)';

  // The workflows section needs at least one child, so when there's nothing
  // real to show we render a single non-selectable placeholder.
  const stateLabel = loading
    ? 'loading…'
    : (error ?? (summaries.length === 0 ? 'no saved workflows' : null));
  const workflowItems = stateLabel
    ? [{ key: STATE_KEY, label: stateLabel, id: '', isCurrent: false, isPlaceholder: true }]
    : summaries.map((s) => ({
        key: `${WF_KEY_PREFIX}${s.id}`,
        label: s.name,
        id: s.id,
        isCurrent: currentWorkflow?.id === s.id,
        isPlaceholder: false,
      }));

  const disabledKeys: string[] = [];
  if (!isDirty || !currentWorkflow) disabledKeys.push(ACTION_KEYS.save);
  if (!currentWorkflow) disabledKeys.push(ACTION_KEYS.duplicate, ACTION_KEYS.delete);
  if (stateLabel) disabledKeys.push(STATE_KEY);

  const onAction = (key: React.Key) => {
    const k = String(key);
    if (k === ACTION_KEYS.save) void onSave();
    else if (k === ACTION_KEYS.new) void onNew();
    else if (k === ACTION_KEYS.duplicate) void onDuplicate();
    else if (k === ACTION_KEYS.delete) void onDelete();
    else if (k.startsWith(WF_KEY_PREFIX)) void onPickRow(k.slice(WF_KEY_PREFIX.length));
  };

  return (
    <Dropdown
      placement="bottom-start"
      onOpenChange={(open) => {
        if (open) {
          setError(null);
          void refreshList();
        }
      }}
    >
      <DropdownTrigger>
        <Button
          variant="light"
          size="sm"
          aria-label="workflow menu"
          className="font-mono"
        >
          <span className="truncate max-w-[28ch]">{triggerLabel}</span>
          <span aria-hidden="true">▼</span>
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="workflow list"
        disabledKeys={disabledKeys}
        onAction={onAction}
      >
        <DropdownSection title="Workflows" showDivider items={workflowItems}>
          {(item) =>
            item.isPlaceholder ? (
              <DropdownItem key={item.key} className="serif-italic opacity-70">
                {item.label}
              </DropdownItem>
            ) : (
              // `textValue` powers typeahead (so two workflows with the same
              // name remain distinguishable when users type to focus).
              <DropdownItem
                key={item.key}
                textValue={`${item.label} ${item.id}`}
                description={item.id}
                className={item.isCurrent ? 'text-primary' : undefined}
                endContent={item.isCurrent ? <span aria-hidden="true">●</span> : null}
              >
                {item.label}
              </DropdownItem>
            )
          }
        </DropdownSection>
        <DropdownSection title="Actions">
          <DropdownItem key={ACTION_KEYS.save}>Save</DropdownItem>
          <DropdownItem key={ACTION_KEYS.new}>New</DropdownItem>
          <DropdownItem key={ACTION_KEYS.duplicate}>Duplicate</DropdownItem>
          <DropdownItem
            key={ACTION_KEYS.delete}
            color="danger"
            className="text-danger"
          >
            Delete
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
}
