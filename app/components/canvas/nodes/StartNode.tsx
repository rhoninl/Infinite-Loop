'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'start';

interface StartData {
  _state?: string;
}

export default function StartNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as StartData;
  const state = d._state ?? 'idle';

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="start node"
    >
      <div className="wf-node-head">
        <span className="wf-node-title">START</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body">begin</div>
      <Handle type="source" position={Position.Right} id="next" />
    </div>
  );
}
