'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'end';

interface EndData {
  _state?: string;
  label?: string;
  config?: { outcome?: 'succeeded' | 'failed' };
}

export default function EndNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as EndData;
  const state = d._state ?? 'idle';
  const outcome = d.config?.outcome ?? 'succeeded';
  const title = d.label?.trim() || 'END';

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="end node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title">{title}</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body wf-node-body-italic">→ {outcome}</div>
    </div>
  );
}
