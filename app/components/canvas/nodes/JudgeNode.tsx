'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'judge';
const CRITERIA_PREVIEW_MAX = 60;

interface JudgeData {
  _state?: string;
  label?: string;
  config?: {
    criteria?: string;
    candidates?: string[];
    providerId?: string;
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function JudgeNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as JudgeData;
  const state = d._state ?? 'idle';
  const title = d.label?.trim() || 'JUDGE';
  const n = (d.config?.candidates ?? []).length;
  const provider = d.config?.providerId ?? 'claude';
  const criteria = d.config?.criteria ?? '';
  const preview = criteria ? truncate(criteria, CRITERIA_PREVIEW_MAX) : '';
  // Only surface the full criteria via title when truncation actually
  // hid characters, matching AgentNode/BranchNode hover-peek convention.
  const criteriaTitle = preview !== criteria ? criteria : undefined;

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="judge node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title">{title}</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body">
        <div>
          ⚖ {n} candidates · {provider}
        </div>
        <div className="wf-node-body-italic" title={criteriaTitle}>
          {preview || '(no criteria)'}
        </div>
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
        style={{ top: '75%' }}
      />
    </div>
  );
}
