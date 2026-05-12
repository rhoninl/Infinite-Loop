'use client';

import { Fragment, useState } from 'react';
import type { WorkflowEvent } from '../../lib/shared/workflow';
import { groupEventsByNode, type NodeCard } from '../../lib/client/group-events';

/** Strings in resolvedConfig/outputs above this length get a "show more"
 * affordance instead of dumping the full content (useful for big prompts). */
const LONG_STRING_LIMIT = 200;

/** Render header → per-node cards → footer for an already-collected event
 * stream. Both the live RunView and the recorded RunHistory detail view
 * use this so the layout stays in lock-step.
 *
 * `filterNodeId` (recorded view only): when set, only the matching node card
 * is rendered; header/footer rows are suppressed so the view focuses on the
 * single card. `onCardActivate` (recorded view only): invoked when the user
 * clicks a node card's header, in addition to the existing fold toggle. */
export function GroupedEventLog({
  events,
  filterNodeId,
  onCardActivate,
  showIO,
}: {
  events: WorkflowEvent[];
  filterNodeId?: string;
  onCardActivate?: (nodeId: string) => void;
  /** Recorded-history view only: surface each node card's resolvedConfig +
   * outputs inside a collapsible "i/o" block at the top of the card body. */
  showIO?: boolean;
}) {
  const grouped = groupEventsByNode(events);
  const cards = filterNodeId
    ? grouped.cards.filter((c) => c.nodeId === filterNodeId)
    : grouped.cards;
  const showSurround = !filterNodeId;
  return (
    <>
      {showSurround
        ? grouped.header.map((ev, idx) => (
            <EventRow key={`h-${idx}`} ev={ev} />
          ))
        : null}
      {cards.map((card) => (
        <NodeCardView
          key={card.nodeId}
          card={card}
          onActivate={onCardActivate}
          showIO={showIO}
        />
      ))}
      {showSurround
        ? grouped.footer.map((ev, idx) => (
            <EventRow key={`f-${idx}`} ev={ev} />
          ))
        : null}
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

export function NodeCardView({
  card,
  onActivate,
  showIO,
}: {
  card: NodeCard;
  onActivate?: (nodeId: string) => void;
  showIO?: boolean;
}) {
  const eventBody = renderCardEvents(card);
  // When showIO is on we also fold the input/output block into the body so the
  // header's expand-toggle reveals it. Cards that finished cleanly with no
  // stdout/error events (common for start/end/condition) only have i/o, but
  // that's still a reason to show the toggle.
  const io = showIO ? deriveCardIO(card) : null;
  const hasIO = !!io;
  const hasBody = eventBody.length > 0 || hasIO;

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

  // Single-click semantics chosen during brainstorming: header click both
  // locates the canvas card AND toggles fold. We make the header a button
  // whenever there's *anything* to click on — either body to fold, or an
  // activate handler. Cards with no body and no handler keep the plain
  // <header> so we don't introduce a useless focusable element.
  const interactive = hasBody || !!onActivate;

  return (
    <section
      className="event-card"
      data-state={card.status}
      aria-label={`node card ${card.nodeId}`}
    >
      {interactive ? (
        <button
          type="button"
          className="event-card-head event-card-head-toggle"
          aria-expanded={hasBody ? open : undefined}
          aria-controls={hasBody ? `card-body-${card.nodeId}` : undefined}
          aria-label={
            hasBody
              ? `${open ? 'collapse' : 'expand'} node card ${card.nodeId}`
              : `locate node ${card.nodeId} on canvas`
          }
          onClick={() => {
            if (onActivate) onActivate(card.nodeId);
            if (hasBody) setOpen((v) => !v);
          }}
        >
          {head}
          {hasBody ? (
            <span className="event-card-fold" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
          ) : null}
        </button>
      ) : (
        <header className="event-card-head">{head}</header>
      )}
      {hasBody && open ? (
        <div className="event-card-body" id={`card-body-${card.nodeId}`}>
          {hasIO ? <IoBlock io={io!} /> : null}
          {eventBody}
        </div>
      ) : null}
    </section>
  );
}

/** Pull the latest resolvedConfig / outputs off a card's event stream. For
 * loop iterations we deliberately keep only the most recent values — the
 * card itself already merges N iterations into one, and showing the latest
 * matches what landed in final scope. Returns null when neither side has
 * anything to render. */
function deriveCardIO(
  card: NodeCard,
): { input: Record<string, unknown> | null; output: Record<string, unknown> | null } | null {
  let input: Record<string, unknown> | null = null;
  let output: Record<string, unknown> | null = null;
  for (const ev of card.events) {
    if (ev.type === 'node_started') input = ev.resolvedConfig;
    else if (ev.type === 'node_finished') output = ev.outputs;
  }
  const hasInput = input && Object.keys(input).length > 0;
  const hasOutput = output && Object.keys(output).length > 0;
  if (!hasInput && !hasOutput) return null;
  return { input: hasInput ? input : null, output: hasOutput ? output : null };
}

function IoBlock({
  io,
}: {
  io: { input: Record<string, unknown> | null; output: Record<string, unknown> | null };
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="iob" aria-label="node i/o">
      <button
        type="button"
        className="iob-toggle"
        aria-expanded={open}
        aria-label={`${open ? 'collapse' : 'expand'} i/o`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="iob-toggle-label">i/o</span>
        <span className="iob-toggle-hint">
          {io.input ? 'input' : ''}
          {io.input && io.output ? ' · ' : ''}
          {io.output ? 'output' : ''}
        </span>
        <span className="iob-toggle-fold" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="iob-body">
          {io.input ? (
            <div className="iob-section" aria-label="input">
              <span className="iob-section-label">input</span>
              <pre className="iob-json">
                <JsonValue value={io.input} depth={0} />
              </pre>
            </div>
          ) : null}
          {io.output ? (
            <div className="iob-section" aria-label="output">
              <span className="iob-section-label">output</span>
              <pre className="iob-json">
                <JsonValue value={io.output} depth={0} />
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Recursive JSON renderer. The point isn't to replicate JSON.stringify —
 * it's to keep long strings (LLM prompts, big outputs) from blowing out the
 * panel. Strings over LONG_STRING_LIMIT collapse to a preview with a per-
 * value show/hide toggle; everything else is rendered structurally so the
 * indentation tracks naturally. */
function JsonValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) return <span className="iob-tok-null">null</span>;
  if (typeof value === 'string') return <JsonString value={value} />;
  if (typeof value === 'number')
    return <span className="iob-tok-num">{String(value)}</span>;
  if (typeof value === 'boolean')
    return <span className="iob-tok-bool">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    const childIndent = '  '.repeat(depth + 1);
    const closeIndent = '  '.repeat(depth);
    return (
      <>
        <span>[</span>
        {'\n'}
        {value.map((v, i) => (
          <Fragment key={i}>
            {childIndent}
            <JsonValue value={v} depth={depth + 1} />
            {i < value.length - 1 ? ',' : ''}
            {'\n'}
          </Fragment>
        ))}
        {closeIndent}
        <span>]</span>
      </>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span>{'{}'}</span>;
    const childIndent = '  '.repeat(depth + 1);
    const closeIndent = '  '.repeat(depth);
    return (
      <>
        <span>{'{'}</span>
        {'\n'}
        {entries.map(([k, v], i) => (
          <Fragment key={k}>
            {childIndent}
            <span className="iob-tok-key">{JSON.stringify(k)}</span>
            {': '}
            <JsonValue value={v} depth={depth + 1} />
            {i < entries.length - 1 ? ',' : ''}
            {'\n'}
          </Fragment>
        ))}
        {closeIndent}
        <span>{'}'}</span>
      </>
    );
  }
  // Functions, symbols, undefined — shouldn't reach here from JSON payloads,
  // but fall back gracefully rather than throwing on bad data.
  return <span>{JSON.stringify(value) ?? String(value)}</span>;
}

function JsonString({ value }: { value: string }) {
  const isLong = value.length > LONG_STRING_LIMIT;
  const [open, setOpen] = useState(false);
  if (!isLong) {
    return <span className="iob-tok-str">{JSON.stringify(value)}</span>;
  }
  const preview = value.slice(0, LONG_STRING_LIMIT);
  return (
    <span className="iob-tok-str">
      {open ? JSON.stringify(value) : JSON.stringify(preview) + '…'}
      <button
        type="button"
        className="iob-show-more"
        aria-label={open ? 'show less' : 'show more'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? ' [less]' : ' [more]'}
      </button>
    </span>
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
