'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'branch';
const PREVIEW_MAX = 40;

interface BranchData {
  _state?: string;
  config?: { lhs?: string; op?: string; rhs?: string };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function brief(d: BranchData): string {
  const cfg = d.config ?? {};
  const lhs = cfg.lhs ?? '';
  const op = cfg.op ?? '==';
  const rhs = cfg.rhs ?? '';
  if (!lhs && !rhs) return '(unconfigured)';
  return truncate(`${lhs || '∅'} ${op} ${rhs || '∅'}`, PREVIEW_MAX);
}

export default function BranchNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BranchData;
  const state = d._state ?? 'idle';

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="branch node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title">BRANCH</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body wf-node-body-italic">{brief(d)}</div>
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
    </div>
  );
}
