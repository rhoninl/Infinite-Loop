'use client';

import React from 'react';
import type { Workflow, WebhookTrigger } from '@/lib/shared/workflow';

export interface TriggersPanelProps {
  workflow: Workflow;
  origin: string;
}

export function TriggersPanel({ workflow, origin }: TriggersPanelProps) {
  const triggers = workflow.triggers ?? [];

  if (triggers.length === 0) {
    return (
      <p className="field-hint" style={{ color: 'var(--fg-dim)' }}>
        No triggers configured. Add a <code style={{ fontFamily: 'var(--mono)' }}>triggers[]</code> entry to the workflow JSON to expose a webhook URL.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {triggers.map((t) => (
        <TriggerRow key={t.id} trigger={t} origin={origin} />
      ))}
      <p className="field-hint" style={{ color: 'var(--fg-dim)', marginTop: 4 }}>
        To add or edit a trigger, edit the workflow JSON file.
      </p>
    </div>
  );
}

function TriggerRow({ trigger, origin }: { trigger: WebhookTrigger; origin: string }) {
  const url = `${origin}/api/webhook/${trigger.id}`;
  const lastFired =
    trigger.lastFiredAt == null
      ? 'Never fired'
      : `Last fired: ${formatRelative(trigger.lastFiredAt)}`;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 500 }}>{trigger.name}</span>
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--mono)',
            padding: '1px 6px',
            borderRadius: 10,
            background: trigger.enabled ? 'var(--status-ok-bg, #d1fae5)' : 'var(--fg-muted, #e5e7eb)',
            color: trigger.enabled ? 'var(--status-ok-fg, #065f46)' : 'var(--fg-soft)',
          }}
        >
          {trigger.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          padding: '3px 6px',
          borderRadius: 3,
          border: '1px solid var(--border)',
          background: 'var(--bg-alt, rgba(0,0,0,0.04))',
          wordBreak: 'break-all',
        }}
      >
        {url}
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{lastFired}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>
        Matches: {trigger.match.length} predicate{trigger.match.length === 1 ? '' : 's'} &middot;{' '}
        Inputs: {Object.keys(trigger.inputs).length} mapped
      </div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  return `${d} d ago`;
}
