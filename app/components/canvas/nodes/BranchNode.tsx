'use client';

import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'branch';
const PREVIEW_MAX = 40;

type ChipColor = 'default' | 'success' | 'danger' | 'warning';

function chipColor(state: string): ChipColor {
  if (state === 'live') return 'warning';
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'danger';
  return 'default';
}

interface BranchData {
  _state?: string;
  label?: string;
  config?: { lhs?: string; op?: string; rhs?: string };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function brief(d: BranchData): { preview: string; full: string } {
  const cfg = d.config ?? {};
  const lhs = cfg.lhs ?? '';
  const op = cfg.op ?? '==';
  const rhs = cfg.rhs ?? '';
  if (!lhs && !rhs) return { preview: '(unconfigured)', full: '(unconfigured)' };
  const full = `${lhs || '∅'} ${op} ${rhs || '∅'}`;
  return { preview: truncate(full, PREVIEW_MAX), full };
}

export default function BranchNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BranchData;
  const state = d._state ?? 'idle';
  const { preview, full } = brief(d);
  const bodyTitle = full !== preview ? full : undefined;
  const title = d.label?.trim() || 'BRANCH';

  return (
    <Card
      className="wf-node"
      shadow="none"
      radius="none"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="branch node"
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
      <CardBody className="wf-node-body wf-node-body-italic !p-0" title={bodyTitle}>
        {preview}
      </CardBody>
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: '32%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: '56%' }}
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
