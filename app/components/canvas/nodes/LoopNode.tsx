'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'loop';

interface LoopData {
  _state?: string;
  config?: {
    maxIterations?: number;
    mode?: 'while-not-met' | 'unbounded';
  };
}

export default function LoopNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as LoopData;
  const state = d._state ?? 'idle';
  const maxIter = d.config?.maxIterations ?? 0;
  const mode = d.config?.mode ?? 'while-not-met';

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="loop node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title">LOOP</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body wf-node-body-italic">
        maxIterations: {maxIter} · {mode}
      </div>
      <Handle type="source" position={Position.Right} id="next" />
    </div>
  );
}
