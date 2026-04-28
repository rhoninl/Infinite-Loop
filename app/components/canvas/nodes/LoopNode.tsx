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
      className="wf-node wf-node-group"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="loop node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-group-head">
        <span className="wf-node-title">LOOP</span>
        <span className="wf-node-group-meta wf-node-body-italic">
          ×{maxIter} · {mode}
        </span>
      </div>
      {/* Children are rendered by xyflow as separate sub-nodes via parentId. */}
      <Handle type="source" position={Position.Right} id="next" />
    </div>
  );
}
