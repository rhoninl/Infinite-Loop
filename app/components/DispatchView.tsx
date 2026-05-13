'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WebhookPlugin, WebhookTrigger } from '@/lib/shared/trigger';
import { TriggerForm } from './TriggerForm';
import { TestFireModal } from './TestFireModal';

export interface DispatchViewProps {
  origin: string;
}

interface WorkflowSummary {
  id: string;
  name: string;
  inputs: Array<{ name: string; type: string }>;
}

export function DispatchView({ origin }: DispatchViewProps) {
  const [triggers, setTriggers] = useState<WebhookTrigger[] | null>(null);
  const [plugins, setPlugins] = useState<WebhookPlugin[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testingTrigger, setTestingTrigger] = useState<WebhookTrigger | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, p, w] = await Promise.all([
        fetch('/api/triggers').then((r) => r.json()),
        fetch('/api/webhook-plugins').then((r) => r.json()),
        fetch('/api/workflows').then((r) => r.json()),
      ]);
      setTriggers(t.triggers as WebhookTrigger[]);
      setPlugins(p.plugins as WebhookPlugin[]);
      // /api/workflows returns lightweight summaries; we need inputs too,
      // so re-fetch each workflow's full record on demand. For v2 simplicity,
      // we fetch a small per-id GET only when picked, kept locally via a
      // shallow cache.
      const summaries = w.workflows as Array<{ id: string; name: string }>;
      // Workflow inputs aren't on the summary; fetch full records in parallel.
      const full: WorkflowSummary[] = await Promise.all(
        summaries.map(async (s) => {
          const wf = await fetch(`/api/workflows/${encodeURIComponent(s.id)}`).then((r) => r.json());
          const inputs = (wf.workflow?.inputs as Array<{ name: string; type: string }>) ?? [];
          return { id: s.id, name: s.name, inputs };
        }),
      );
      setWorkflows(full);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleCreate(payload: Omit<WebhookTrigger, 'id' | 'createdAt' | 'updatedAt'>) {
    const res = await fetch('/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.reason ?? 'create failed');
    setCreating(false);
    await refresh();
    setSelectedId(json.trigger.id);
  }

  async function handleUpdate(payload: Omit<WebhookTrigger, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!selectedId) return;
    const res = await fetch(`/api/triggers/${encodeURIComponent(selectedId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, id: selectedId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.reason ?? 'update failed');
    setEditing(false);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this trigger? The URL stops working immediately.')) return;
    await fetch(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  if (triggers === null) {
    return <div className="dsp-loading">Loading…</div>;
  }

  const selected = triggers.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="dsp-root">
      <header className="dsp-head">
        <h2 className="dsp-title">Triggers</h2>
        <button type="button" className="dsp-new-btn" onClick={() => { setCreating(true); setSelectedId(null); setEditing(false); }}>
          + New trigger
        </button>
      </header>

      {error && <div className="dsp-error">{error}</div>}

      <div className="dsp-split">
        <aside className="dsp-list">
          {triggers.length === 0 ? (
            <p className="dsp-empty">No triggers yet. Click "New trigger" to add one.</p>
          ) : triggers.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`dsp-list-row ${selectedId === t.id ? 'dsp-list-row-selected' : ''}`}
              onClick={() => { setSelectedId(t.id); setCreating(false); setEditing(false); }}
            >
              <span className={`dsp-pip ${t.enabled ? 'on' : 'off'}`} aria-hidden />
              <span className="dsp-list-name">{t.name}</span>
              <span className="dsp-list-meta">
                {t.pluginId}{t.eventType ? ` · ${t.eventType}` : ''} → {t.workflowId}
              </span>
            </button>
          ))}
        </aside>

        <section className="dsp-detail">
          {creating ? (
            <TriggerForm
              plugins={plugins}
              workflows={workflows}
              initial={null}
              origin={origin}
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
            />
          ) : editing && selected ? (
            <TriggerForm
              plugins={plugins}
              workflows={workflows}
              initial={selected}
              origin={origin}
              onSave={handleUpdate}
              onCancel={() => setEditing(false)}
            />
          ) : selected ? (
            <div className="dsp-read">
              <header className="dsp-read-head">
                <h3>{selected.name}</h3>
                <div className="dsp-read-actions">
                  <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
                  <button type="button" className="btn" onClick={() => setTestingTrigger(selected)}>Test</button>
                  <button type="button" className="btn" onClick={() => handleDelete(selected.id)}>Delete</button>
                </div>
              </header>
              <p className="dsp-read-line"><span className="dsp-label">URL</span> <code>{`${origin}/api/webhook/${selected.id}`}</code></p>
              <p className="dsp-read-line"><span className="dsp-label">Plugin</span> {selected.pluginId}{selected.eventType ? ` · ${selected.eventType}` : ''}</p>
              <p className="dsp-read-line"><span className="dsp-label">Target</span> {selected.workflowId}</p>
              <p className="dsp-read-line"><span className="dsp-label">Match</span> {selected.match.length} predicate{selected.match.length === 1 ? '' : 's'}</p>
              <p className="dsp-read-line"><span className="dsp-label">Inputs</span> {Object.keys(selected.inputs).length} mapped</p>
              <p className="dsp-read-line"><span className="dsp-label">Last fired</span> {selected.lastFiredAt ? new Date(selected.lastFiredAt).toLocaleString() : 'Never'}</p>
            </div>
          ) : (
            <div className="dsp-empty">Select a trigger or click "New trigger".</div>
          )}
        </section>
      </div>

      {testingTrigger && (
        <TestFireModal
          trigger={testingTrigger}
          plugin={plugins.find((p) => p.id === testingTrigger.pluginId)}
          onClose={() => setTestingTrigger(null)}
        />
      )}
    </div>
  );
}
