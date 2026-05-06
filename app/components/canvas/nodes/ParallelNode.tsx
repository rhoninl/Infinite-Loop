'use client';

import { Card, CardHeader, Chip } from '@heroui/react';
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from '@xyflow/react';

const NODE_TYPE = 'parallel';
const MIN_W = 280;
const MIN_H = 160;

type ChipColor = 'default' | 'success' | 'danger' | 'warning';

function chipColor(state: string): ChipColor {
  if (state === 'live') return 'warning';
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'danger';
  return 'default';
}

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
  const showChip = state === 'live' || state === 'succeeded' || state === 'failed';

  // Append the quorum threshold to the meta line only when it's actually in
  // play, so the header stays compact for the common wait-all / race modes.
  const metaTail =
    mode === 'quorum' && typeof quorumN === 'number' ? ` (n=${quorumN})` : '';

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
          {mode}
          {metaTail} · {onError}
        </span>
        {showChip ? (
          <Chip
            size="sm"
            variant="dot"
            color={chipColor(state)}
            aria-label={`state ${state}`}
            data-state={state}
            className="wf-node-state-chip h-auto border-0 px-0"
          >
            {state}
          </Chip>
        ) : null}
      </CardHeader>
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
    </Card>
  );
}
