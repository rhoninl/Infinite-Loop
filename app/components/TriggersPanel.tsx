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
      <p className="field-hint">
        No triggers configured. Add a <code className="bni-code">triggers[]</code>{' '}
        entry to the workflow JSON to expose a webhook URL.
      </p>
    );
  }

  return (
    <div className="trg-list">
      {triggers.map((t) => (
        <TriggerRow key={t.id} trigger={t} origin={origin} />
      ))}
      <p className="field-hint trg-foot">
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
  const chipClass = trigger.enabled
    ? 'trg-chip trg-chip-enabled'
    : 'trg-chip trg-chip-disabled';

  return (
    <div className="trg-row">
      <div className="trg-row-head">
        <span className="trg-row-name">{trigger.name}</span>
        <span className={chipClass}>
          {trigger.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div className="trg-url">{url}</div>
      <div className="trg-meta">{lastFired}</div>
      <div className="trg-meta">
        Matches: {trigger.match.length} predicate
        {trigger.match.length === 1 ? '' : 's'} &middot; Inputs:{' '}
        {Object.keys(trigger.inputs).length} mapped
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
