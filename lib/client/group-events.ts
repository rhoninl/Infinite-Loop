import type { NodeType, WorkflowEvent } from '../shared/workflow';

/**
 * Per-node "card": every event that pertains to a single node in the run,
 * preserved in arrival order. The terminal status/branch is filled in once
 * `node_finished` arrives; before that the card is treated as live.
 */
export interface NodeCard {
  nodeId: string;
  nodeType?: NodeType;
  events: WorkflowEvent[];
  status: 'pending' | 'running' | 'finished' | 'errored';
  branch?: string;
  durationMs?: number;
}

/**
 * Partition a flat event stream into a run header, an ordered list of
 * per-node cards, and a run footer. Mental model: header = run start,
 * footer = run terminal + any global (no-nodeId) errors, cards = per-node.
 *
 * Cards are ordered by first appearance — that matches the order events
 * actually came in for the user.
 *
 * Loop iterations are intentionally merged: a node hit N times in a Loop
 * still produces ONE card with all of its events. Splitting per
 * (nodeId, loopIteration) is a key change here, not a structural rewrite.
 */
export function groupEventsByNode(events: WorkflowEvent[]): {
  header: WorkflowEvent[];
  cards: NodeCard[];
  footer: WorkflowEvent[];
} {
  const header: WorkflowEvent[] = [];
  const footer: WorkflowEvent[] = [];
  const order: string[] = [];
  const byId = new Map<string, NodeCard>();

  for (const ev of events) {
    const nodeId = eventNodeId(ev);

    if (ev.type === 'run_started') {
      header.push(ev);
      continue;
    }
    if (ev.type === 'run_finished') {
      footer.push(ev);
      continue;
    }
    if (!nodeId) {
      // Run-level event without a nodeId — only `error` reaches here. Park
      // it in the footer regardless of position so the header stays a
      // single-purpose "run started" zone.
      footer.push(ev);
      continue;
    }

    let card = byId.get(nodeId);
    if (!card) {
      card = {
        nodeId,
        nodeType: ev.type === 'node_started' ? ev.nodeType : undefined,
        events: [],
        status: 'pending',
      };
      byId.set(nodeId, card);
      order.push(nodeId);
    }
    card.events.push(ev);

    if (ev.type === 'node_started') {
      card.nodeType = ev.nodeType;
      card.status = 'running';
    } else if (ev.type === 'node_finished') {
      card.status = 'finished';
      card.branch = ev.branch;
      card.durationMs = ev.durationMs;
    } else if (ev.type === 'error') {
      card.status = 'errored';
    }
  }

  return { header, cards: order.map((id) => byId.get(id)!), footer };
}

/** Extract the nodeId an event applies to, or undefined for run-level events. */
export function eventNodeId(ev: WorkflowEvent): string | undefined {
  switch (ev.type) {
    case 'node_started':
    case 'node_finished':
    case 'stdout_chunk':
    case 'condition_checked':
    case 'template_warning':
      return ev.nodeId;
    case 'error':
      return ev.nodeId;
    default:
      return undefined;
  }
}
