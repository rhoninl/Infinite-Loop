'use client';

import { NodeResizer, type NodeProps } from '@xyflow/react';

const NODE_TYPE = 'sidenote';
const MIN_W = 160;
const MIN_H = 80;

interface SidenoteData {
  label?: string;
  config?: { text?: string };
}

/**
 * Sticky-note annotation. No handles → can't be connected → engine never
 * reaches it. Resizable so users can pin a paragraph next to a complex part
 * of the graph. Edited via the right-side ConfigPanel.
 */
export default function SidenoteNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as SidenoteData;
  const text = d.config?.text ?? '';
  const title = d.label?.trim() || 'NOTE';

  return (
    <div
      className="wf-node wf-sidenote"
      data-node-type={NODE_TYPE}
      data-selected={selected ? 'true' : 'false'}
      aria-label="sidenote"
    >
      <NodeResizer
        minWidth={MIN_W}
        minHeight={MIN_H}
        isVisible={!!selected}
        lineClassName="wf-resize-line"
        handleClassName="wf-resize-handle"
      />
      <div className="wf-sidenote-head">
        <span className="wf-sidenote-glyph" aria-hidden="true">
          ✎
        </span>
        <span className="wf-sidenote-title">{title}</span>
      </div>
      <div className="wf-sidenote-body">
        {text.trim() ? text : <span className="wf-sidenote-placeholder">(empty note)</span>}
      </div>
    </div>
  );
}
