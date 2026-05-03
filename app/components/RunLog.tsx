'use client';

import { useState } from 'react';
import type { WorkflowEvent } from '../../lib/shared/workflow';
import { groupEventsByNode, type NodeCard } from '../../lib/client/group-events';

/** Render header → per-node cards → footer for an already-collected event
 * stream. Both the live RunView and the recorded RunHistory detail view
 * use this so the layout stays in lock-step. */
export function GroupedEventLog({ events }: { events: WorkflowEvent[] }) {
  const grouped = groupEventsByNode(events);
  return (
    <>
      {grouped.header.map((ev, idx) => (
        <EventRow key={`h-${idx}`} ev={ev} />
      ))}
      {grouped.cards.map((card) => (
        <NodeCardView key={card.nodeId} card={card} />
      ))}
      {grouped.footer.map((ev, idx) => (
        <EventRow key={`f-${idx}`} ev={ev} />
      ))}
    </>
  );
}

/** One log row — shape mirrors the original `run-view-log-row` markup so the
 * `event log` aria container still contains the type+payload text both views'
 * tests rely on. */
export function EventRow({ ev }: { ev: WorkflowEvent }) {
  if (ev.type === 'stdout_chunk') {
    return (
      <div className="run-view-log-row is-stdout">
        <span className="stdout-prefix">{ev.nodeId} │</span>
        <span className="stdout-line">{ev.line}</span>
      </div>
    );
  }
  return (
    <div className="run-view-log-row">
      <span className="run-view-log-type">{ev.type}</span>
      <span className="run-view-log-payload">{formatPayload(ev)}</span>
    </div>
  );
}

export function NodeCardView({ card }: { card: NodeCard }) {
  const body = renderCardEvents(card);
  const hasBody = body.length > 0;

  // Initial fold: open if the card is running/errored or has no terminal state
  // yet, closed if it already finished cleanly. Once the user toggles, their
  // choice sticks — we do NOT re-derive from card.status on later renders, so
  // a card that reaches `finished` while the user is reading it stays open.
  const [open, setOpen] = useState(() => card.status !== 'finished');

  const head = (
    <>
      <span className="event-card-id">{card.nodeId}</span>
      {card.nodeType ? (
        <span className="event-card-kind">{card.nodeType}</span>
      ) : null}
      <span className="event-card-status" data-state={card.status}>
        {card.status}
        {card.branch ? ` → ${card.branch}` : ''}
        {typeof card.durationMs === 'number'
          ? ` · ${(card.durationMs / 1000).toFixed(2)}s`
          : ''}
      </span>
    </>
  );

  return (
    <section
      className="event-card"
      data-state={card.status}
      aria-label={`node card ${card.nodeId}`}
    >
      {hasBody ? (
        <button
          type="button"
          className="event-card-head event-card-head-toggle"
          aria-expanded={open}
          aria-controls={`card-body-${card.nodeId}`}
          aria-label={`${open ? 'collapse' : 'expand'} node card ${card.nodeId}`}
          onClick={() => setOpen((v) => !v)}
        >
          {head}
          <span className="event-card-fold" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
      ) : (
        <header className="event-card-head">{head}</header>
      )}
      {hasBody && open ? (
        <div className="event-card-body" id={`card-body-${card.nodeId}`}>
          {body}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Render the per-card body. Two cleanups vs. a flat row-per-event:
 * - `node_started` / `node_finished` are dropped because the card header
 *   already shows kind, status, branch, and duration. Re-printing them in
 *   the body is pure noise.
 * - Consecutive `stdout_chunk` events collapse into one block with a single
 *   nodeId prefix. The provider runner emits chunks that may be partial
 *   tokens (claude-stream-json) or full newline-terminated lines (plain),
 *   and concatenating them with no separator reconstructs the source text
 *   either way. Without this, partial tokens get visually shredded across
 *   rows mid-word.
 */
function renderCardEvents(card: NodeCard): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let pending: { nodeId: string; text: string } | null = null;
  const flush = () => {
    if (!pending) return;
    out.push(
      <StdoutBlock
        key={`stdout-${out.length}`}
        nodeId={pending.nodeId}
        text={pending.text}
      />,
    );
    pending = null;
  };

  for (let i = 0; i < card.events.length; i++) {
    const ev = card.events[i];
    if (ev.type === 'node_started' || ev.type === 'node_finished') continue;
    if (ev.type === 'stdout_chunk') {
      if (!pending) pending = { nodeId: ev.nodeId, text: '' };
      pending.text += ev.line;
      continue;
    }
    flush();
    out.push(<EventRow key={`row-${i}`} ev={ev} />);
  }
  flush();
  return out;
}

function StdoutBlock({ nodeId, text }: { nodeId: string; text: string }) {
  return (
    <div className="run-view-log-row is-stdout">
      <span className="stdout-prefix">{nodeId} │</span>
      <span className="stdout-line">{text}</span>
    </div>
  );
}

export function formatPayload(ev: WorkflowEvent): string {
  switch (ev.type) {
    case 'run_started':
      return `${ev.workflowName} (${ev.workflowId})`;
    case 'node_started':
      return ev.nodeId;
    case 'node_finished':
      return `${ev.nodeId} → ${ev.branch}`;
    case 'condition_checked':
      return `${ev.nodeId} met:${ev.met ? 'Y' : 'N'} ${ev.detail}`;
    case 'template_warning':
      return `${ev.nodeId} missingKey:${ev.missingKey}`;
    case 'error':
      return ev.nodeId ? `${ev.nodeId} ${ev.message}` : ev.message;
    case 'run_finished':
      return ev.status;
    default:
      return '';
  }
}
