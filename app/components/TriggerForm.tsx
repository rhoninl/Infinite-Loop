'use client';

import { useMemo, useState } from 'react';
import type { WebhookPlugin, WebhookTrigger, TriggerPredicate } from '@/lib/shared/trigger';
import { FieldPicker } from './FieldPicker';

export interface TriggerFormProps {
  plugins: WebhookPlugin[];
  workflows: Array<{ id: string; name: string; inputs: Array<{ name: string; type: string }> }>;
  initial: WebhookTrigger | null;     // null = creating new
  origin: string;
  onSave: (payload: Omit<WebhookTrigger, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
}

const OPS: TriggerPredicate['op'][] = ['==', '!=', 'contains', 'matches'];

export function TriggerForm({
  plugins, workflows, initial, origin, onSave, onCancel,
}: TriggerFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [pluginId, setPluginId] = useState(initial?.pluginId ?? 'generic');
  const [eventType, setEventType] = useState(initial?.eventType ?? '');
  const [workflowId, setWorkflowId] = useState(initial?.workflowId ?? '');
  const [match, setMatch] = useState<TriggerPredicate[]>(initial?.match ?? []);
  const [inputs, setInputs] = useState<Record<string, string>>(initial?.inputs ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const plugin = plugins.find((p) => p.id === pluginId);
  const event = plugin?.events.find((e) => e.type === eventType);
  const fields = event?.fields ?? [];
  const workflow = workflows.find((w) => w.id === workflowId);

  const url = useMemo(
    () => initial ? `${origin}/api/webhook/${initial.id}` : '',
    [initial, origin],
  );

  function handleSetPlugin(next: string) {
    setPluginId(next);
    setEventType('');
  }

  function handleAddPredicate() {
    setMatch((m) => [...m, { lhs: '', op: '==', rhs: '' }]);
  }

  function handleRemovePredicate(idx: number) {
    setMatch((m) => m.filter((_, i) => i !== idx));
  }

  function handleUpdatePredicate(idx: number, key: keyof TriggerPredicate, value: string) {
    setMatch((m) => m.map((p, i) => i === idx ? { ...p, [key]: value } : p));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const declaredInputNames = new Set(workflow?.inputs.map((i) => i.name) ?? []);
      const filteredInputs: Record<string, string> = {};
      for (const [k, v] of Object.entries(inputs)) {
        if (declaredInputNames.has(k) && v.length > 0) filteredInputs[k] = v;
      }
      await onSave({
        name,
        enabled,
        workflowId,
        pluginId,
        eventType: plugin?.eventHeader ? (eventType || undefined) : undefined,
        match,
        inputs: filteredInputs,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="trg-form">
      <label className="trg-form-row">
        <span className="trg-form-label">Name</span>
        <input
          className="trg-form-input"
          type="text"
          placeholder="trigger name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="trg-form-row">
        <span className="trg-form-label">Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </label>

      <label className="trg-form-row">
        <span className="trg-form-label">Plugin</span>
        <select
          className="trg-form-select"
          aria-label="Plugin"
          value={pluginId}
          onChange={(e) => handleSetPlugin(e.target.value)}
        >
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </label>

      {plugin?.eventHeader && (
        <label className="trg-form-row">
          <span className="trg-form-label">Event</span>
          <select
            className="trg-form-select"
            aria-label="Event"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option value="">— select —</option>
            {plugin.events.map((ev) => (
              <option key={ev.type} value={ev.type}>{ev.displayName}</option>
            ))}
          </select>
        </label>
      )}

      <label className="trg-form-row">
        <span className="trg-form-label">Target</span>
        <select
          className="trg-form-select"
          aria-label="Target"
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
        >
          <option value="">— select —</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </label>

      {initial && (
        <div className="trg-form-row">
          <span className="trg-form-label">URL</span>
          <code className="trg-form-url">{url}</code>
        </div>
      )}

      <section className="trg-form-section">
        <header className="trg-form-section-head">
          <span>Match (all must pass)</span>
          <button type="button" className="trg-form-add" onClick={handleAddPredicate}>+ Add predicate</button>
        </header>
        {match.map((p, idx) => (
          <div className="trg-form-predicate" key={idx}>
            <FieldPicker
              fields={fields}
              value={p.lhs}
              onChange={(v) => handleUpdatePredicate(idx, 'lhs', v)}
              ariaLabel={`Predicate ${idx + 1} lhs`}
            />
            <select
              className="trg-form-select"
              aria-label={`Predicate ${idx + 1} op`}
              value={p.op}
              onChange={(e) => handleUpdatePredicate(idx, 'op', e.target.value)}
            >
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input
              className="trg-form-input"
              type="text"
              value={p.rhs}
              onChange={(e) => handleUpdatePredicate(idx, 'rhs', e.target.value)}
              aria-label={`Predicate ${idx + 1} rhs`}
            />
            <button type="button" className="trg-form-remove" onClick={() => handleRemovePredicate(idx)}>×</button>
          </div>
        ))}
      </section>

      <section className="trg-form-section">
        <header className="trg-form-section-head">Inputs (from workflow)</header>
        {(workflow?.inputs ?? []).map((inp) => (
          <div className="trg-form-input-row" key={inp.name}>
            <span className="trg-form-input-name">{inp.name}</span>
            <FieldPicker
              fields={fields}
              value={inputs[inp.name] ?? ''}
              onChange={(v) => setInputs((s) => ({ ...s, [inp.name]: v }))}
              ariaLabel={`Input ${inp.name}`}
            />
          </div>
        ))}
        {(!workflow || workflow.inputs.length === 0) && (
          <p className="trg-form-hint">Selected workflow declares no inputs.</p>
        )}
      </section>

      {error && <div className="trg-form-error">{error}</div>}

      <div className="trg-form-actions">
        <button type="button" className="trg-form-save" disabled={saving} onClick={handleSave}>Save trigger</button>
        <button type="button" className="trg-form-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
