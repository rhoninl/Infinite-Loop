'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { LuCode } from 'react-icons/lu';

const NODE_TYPE = 'script';
const PREVIEW_MAX = 48;
const TITLE_ICON_SIZE = 16;

interface ScriptData {
  _state?: string;
  label?: string;
  config?: {
    language?: 'ts' | 'py';
    code?: string;
    inputs?: Record<string, string>;
    outputs?: string[];
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** A function-signature preview: `run(a, b) → output1, output2`. Reads
 * straight off the node's declared inputs/outputs so the user can tell
 * what the script's contract is without opening the config panel. */
function signaturePreview(
  inputs: Record<string, string> | undefined,
  outputs: string[] | undefined,
): string {
  const argList = inputs ? Object.keys(inputs).join(', ') : '';
  const outList = outputs && outputs.length > 0 ? outputs.join(', ') : '∅';
  return `run(${argList}) → ${outList}`;
}

export default function ScriptNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as ScriptData;
  const state = d._state ?? 'idle';
  const language: 'ts' | 'py' = d.config?.language ?? 'ts';
  const full = signaturePreview(d.config?.inputs, d.config?.outputs);
  const preview = truncate(full, PREVIEW_MAX);
  const bodyTitle = full !== preview ? full : undefined;
  const title = d.label?.trim() || 'SCRIPT';

  return (
    <div
      className="wf-node"
      data-node-type={NODE_TYPE}
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      aria-label="script node"
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="wf-node-head">
        <span className="wf-node-title wf-node-title-icon">
          <LuCode size={TITLE_ICON_SIZE} aria-hidden="true" />
          <span className="wf-node-title-text">{title}</span>
        </span>
        <span className="wf-node-state-dot" data-state={state} aria-hidden="true" />
      </div>
      <div
        className="wf-node-agent"
        aria-label={`language ${language}`}
        title={language === 'ts' ? 'TypeScript via Bun' : 'Python via python3'}
      >
        <span className="wf-node-agent-glyph" aria-hidden="true">
          ⤳
        </span>
        <span className="wf-node-agent-name">
          {language === 'ts' ? 'typescript' : 'python'}
        </span>
      </div>
      <div className="wf-node-body" title={bodyTitle}>
        {preview}
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
        style={{ top: '72%' }}
      />
    </div>
  );
}
