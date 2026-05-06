'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'condition';
const PREVIEW_MAX = 40;

interface ConditionData {
  _state?: string;
  label?: string;
  config?: {
    kind?: 'sentinel' | 'command' | 'judge';
    sentinel?: { pattern?: string };
    command?: { cmd?: string };
    judge?: { rubric?: string };
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function brief(d: ConditionData): { preview: string; full: string } {
  const kind = d.config?.kind;
  if (!kind) return { preview: '(unconfigured)', full: '(unconfigured)' };
  let full: string;
  if (kind === 'sentinel') {
    const pat = d.config?.sentinel?.pattern ?? '';
    full = `sentinel · ${pat || '(no pattern)'}`;
  } else if (kind === 'command') {
    const cmd = d.config?.command?.cmd ?? '';
    full = `command · ${cmd || '(no cmd)'}`;
  } else {
    const rubric = d.config?.judge?.rubric ?? '';
    full = `judge · ${rubric || '(no rubric)'}`;
  }
  return { preview: truncate(full, PREVIEW_MAX), full };
}

export default function ConditionNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as ConditionData;
  const state = d._state ?? 'idle';
  const { preview, full } = brief(d);
  const bodyTitle = full !== preview ? full : undefined;
  const title = d.label?.trim() || 'CONDITION';

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="condition node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title">{title}</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body wf-node-body-italic" title={bodyTitle}>
        {preview}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="met"
        style={{ top: '32%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="not_met"
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
