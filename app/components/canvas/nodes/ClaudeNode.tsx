'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'claude';
const PREVIEW_MAX = 40;

interface ClaudeData {
  _state?: string;
  config?: { prompt?: string; cwd?: string; timeoutMs?: number };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function ClaudeNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as ClaudeData;
  const state = d._state ?? 'idle';
  const prompt = d.config?.prompt ?? '';
  const preview = prompt ? truncate(prompt, PREVIEW_MAX) : '(no prompt)';

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="claude node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title">CLAUDE</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body wf-node-body-italic">{preview}</div>
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
