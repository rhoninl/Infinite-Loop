'use client';

import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from '@xyflow/react';

const NODE_TYPE = 'parallel';
const MIN_W = 280;
const MIN_H = 160;

interface ParallelData {
  _state?: string;
  label?: string;
  config?: {
    mode?: 'wait-all' | 'race' | 'quorum';
    quorumN?: number;
    onError?: 'fail-fast' | 'best-effort';
  };
}

export default function ParallelNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as ParallelData;
  const state = d._state ?? 'idle';
  const mode = d.config?.mode ?? 'wait-all';
  const onError = d.config?.onError ?? 'fail-fast';
  const quorumN = d.config?.quorumN;
  const title = d.label?.trim() || 'PARALLEL';

  // Append the quorum threshold to the meta line only when it's actually in
  // play, so the header stays compact for the common wait-all / race modes.
  const metaTail =
    mode === 'quorum' && typeof quorumN === 'number' ? ` (n=${quorumN})` : '';

  return (
    <div
      className="wf-node wf-node-group"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="parallel node"
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
          {mode}
          {metaTail} · {onError}
        </span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      {/* Children are rendered by xyflow as separate sub-nodes via parentId. */}
      <Handle
        type="source"
        position={Position.Right}
        id="all_done"
        style={{ top: '25%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="first_done"
        style={{ top: '45%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="quorum_met"
        style={{ top: '65%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="error"
        style={{ top: '85%' }}
      />
    </div>
  );
}
