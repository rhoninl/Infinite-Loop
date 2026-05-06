'use client';

import { Card, CardHeader } from '@heroui/react';
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

/**
 * Foundation stub for the parallel container. Mirrors LoopNode's container
 * shape so the canvas renders cleanly while the real visual treatment lands
 * in unit U3.
 */
export default function ParallelNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as ParallelData;
  const state = d._state ?? 'idle';
  const mode = d.config?.mode ?? 'wait-all';
  const onError = d.config?.onError ?? 'fail-fast';
  const title = d.label?.trim() || 'PARALLEL';

  return (
    <Card
      className="wf-node wf-node-group"
      shadow="none"
      radius="none"
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
      <CardHeader className="wf-node-group-head !p-0">
        <span className="wf-node-title">{title}</span>
        <span className="wf-node-group-meta wf-node-body-italic">
          {mode} · {onError}
        </span>
      </CardHeader>
      <Handle type="source" position={Position.Right} id="all_done" />
      <Handle
        type="source"
        position={Position.Right}
        id="first_done"
        style={{ top: '40%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="quorum_met"
        style={{ top: '60%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="error"
        style={{ top: '80%' }}
      />
    </Card>
  );
}
