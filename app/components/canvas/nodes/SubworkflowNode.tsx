'use client';

import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'subworkflow';

type ChipColor = 'default' | 'success' | 'danger' | 'warning';

function chipColor(state: string): ChipColor {
  if (state === 'live') return 'warning';
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'danger';
  return 'default';
}

interface SubworkflowData {
  _state?: string;
  label?: string;
  config?: {
    workflowId?: string;
    inputs?: Record<string, string>;
    outputs?: Record<string, string>;
  };
}

export default function SubworkflowNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as SubworkflowData;
  const state = d._state ?? 'idle';
  const title = d.label?.trim() || 'SUBWORKFLOW';
  const wfId = d.config?.workflowId?.trim() ?? '';
  const nIn = Object.keys(d.config?.inputs ?? {}).length;
  const nOut = Object.keys(d.config?.outputs ?? {}).length;

  return (
    <Card
      className="wf-node"
      shadow="none"
      radius="none"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="subworkflow node"
    >
      <Handle type="target" position={Position.Left} id="in" />
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
      <CardBody className="wf-node-body !p-0">
        <div>
          →{' '}
          {wfId ? wfId : <span className="wf-node-body-italic">(unset)</span>}
        </div>
        <div className="wf-node-body-italic">
          inputs: {nIn} · outputs: {nOut}
        </div>
      </CardBody>
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
    </Card>
  );
}
