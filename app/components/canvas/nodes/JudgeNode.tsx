'use client';

import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'judge';
const CRITERIA_PREVIEW_MAX = 60;

type ChipColor = 'default' | 'success' | 'danger' | 'warning';

function chipColor(state: string): ChipColor {
  if (state === 'live') return 'warning';
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'danger';
  return 'default';
}

interface JudgeData {
  _state?: string;
  label?: string;
  config?: {
    criteria?: string;
    candidates?: string[];
    providerId?: string;
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function JudgeNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as JudgeData;
  const state = d._state ?? 'idle';
  const title = d.label?.trim() || 'JUDGE';
  const n = (d.config?.candidates ?? []).length;
  const provider = d.config?.providerId ?? 'claude';
  const criteria = d.config?.criteria ?? '';
  const preview = criteria ? truncate(criteria, CRITERIA_PREVIEW_MAX) : '';
  // Only surface the full criteria via title when truncation actually
  // hid characters, matching AgentNode/BranchNode hover-peek convention.
  const criteriaTitle = preview !== criteria ? criteria : undefined;

  return (
    <Card
      className="wf-node"
      shadow="none"
      radius="none"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="judge node"
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
          ⚖ {n} candidates · {provider}
        </div>
        <div className="wf-node-body-italic" title={criteriaTitle}>
          {preview || '(no criteria)'}
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
