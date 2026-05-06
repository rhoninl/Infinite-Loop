'use client';

import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'start';

type ChipColor = 'default' | 'success' | 'danger' | 'warning';

function chipColor(state: string): ChipColor {
  if (state === 'live') return 'warning';
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'danger';
  return 'default';
}

interface StartData {
  _state?: string;
  label?: string;
}

export default function StartNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as StartData;
  const state = d._state ?? 'idle';
  const title = d.label?.trim() || 'START';

  return (
    <Card
      className="wf-node"
      shadow="none"
      radius="none"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="start node"
    >
      <CardHeader className="wf-node-head !p-0">
        <span className="wf-node-title">{title}</span>
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
      </CardHeader>
      <CardBody className="wf-node-body !p-0">begin</CardBody>
      <Handle type="source" position={Position.Right} id="next" />
    </Card>
  );
}
