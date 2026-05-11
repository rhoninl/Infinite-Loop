'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'subworkflow';

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
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="subworkflow node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title">{title}</span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div className="wf-node-body">
        <div>
          →{' '}
          {wfId ? wfId : <span className="wf-node-body-italic">(unset)</span>}
        </div>
        <div className="wf-node-body-italic">
          inputs: {nIn} · outputs: {nOut}
        </div>
      </div>
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
    </div>
  );
}
