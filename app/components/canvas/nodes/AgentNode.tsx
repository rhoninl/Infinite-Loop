'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import ProviderIcon from '../../icons/ProviderIcon';

const NODE_TYPE = 'agent';
const PREVIEW_MAX = 40;
const TITLE_ICON_SIZE = 16;

interface AgentData {
  _state?: string;
  label?: string;
  config?: { providerId?: string; prompt?: string; cwd?: string; timeoutMs?: number };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function AgentNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as AgentData;
  const state = d._state ?? 'idle';
  const prompt = d.config?.prompt ?? '';
  const provider = d.config?.providerId ?? 'claude';
  const full = prompt || '(no prompt)';
  const preview = truncate(full, PREVIEW_MAX);
  // Surface the full prompt on hover when it's been truncated, so users can
  // peek without opening the config panel.
  const bodyTitle = full !== preview ? full : undefined;
  const customLabel = d.label?.trim();

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="agent node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        {/* Brand icon takes the title slot. When a custom display name is
         * set on the node, it sits to the right of the icon; without one,
         * the icon stands alone. We keep .wf-node-title on the wrapper so
         * the per-state / per-node-type color rules still tint icon + text
         * via currentColor (ProviderIcon's mask-image uses currentColor). */}
        <span
          className="wf-node-title wf-node-title-icon"
          aria-label={customLabel ? `${customLabel} (${provider} agent)` : `${provider} agent`}
        >
          <ProviderIcon providerId={provider} size={TITLE_ICON_SIZE} />
          {customLabel ? (
            <span className="wf-node-title-text">{customLabel}</span>
          ) : null}
        </span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body wf-node-body-italic" title={bodyTitle}>
        {preview}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="next"
        style={{ top: '40%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="error"
        style={{ top: '72%' }}
      />
    </div>
  );
}
