'use client';

import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from '@xyflow/react';

const NODE_TYPE = 'loop';
const MIN_W = 240;
const MIN_H = 140;

interface LoopData {
  _state?: string;
  label?: string;
  config?: {
    maxIterations?: number;
    mode?: 'while-not-met' | 'unbounded';
    infinite?: boolean;
  };
}

export default function LoopNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as LoopData;
  const state = d._state ?? 'idle';
  const maxIter = d.config?.maxIterations ?? 0;
  const mode = d.config?.mode ?? 'while-not-met';
  const infinite = d.config?.infinite === true;
  const iterLabel = infinite ? '∞' : String(maxIter);
  const title = d.label?.trim() || 'LOOP';

  return (
    <div
      className="wf-node wf-node-group"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="loop node"
    >
      <NodeResizer
        minWidth={MIN_W}
        minHeight={MIN_H}
        isVisible={!!selected}
        lineClassName="wf-resize-line"
        handleClassName="wf-resize-handle"
      />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-group-head">
        <span className="wf-node-title">{title}</span>
        <span className="wf-node-group-meta wf-node-body-italic">
          ×{iterLabel} · {mode}
        </span>
      </div>
      {/* Children are rendered by xyflow as separate sub-nodes via parentId. */}
      <Handle type="source" position={Position.Right} id="next" />
    </div>
  );
}
