import { describe, it, expect } from 'bun:test';
import { groupEventsByNode } from './group-events';
import type { WorkflowEvent } from '../shared/workflow';

describe('groupEventsByNode', () => {
  it('puts run_started in header and run_finished in footer', () => {
    const events: WorkflowEvent[] = [
      { type: 'run_started', workflowId: 'w', workflowName: 'W' },
      { type: 'run_finished', status: 'succeeded', scope: {} },
    ];
    const out = groupEventsByNode(events);
    expect(out.header).toHaveLength(1);
    expect(out.header[0].type).toBe('run_started');
    expect(out.footer).toHaveLength(1);
    expect(out.footer[0].type).toBe('run_finished');
    expect(out.cards).toHaveLength(0);
  });

  it('groups every per-node event into one card per nodeId, in first-seen order', () => {
    const events: WorkflowEvent[] = [
      { type: 'run_started', workflowId: 'w', workflowName: 'W' },
      { type: 'node_started', nodeId: 'a', nodeType: 'agent', resolvedConfig: {} },
      { type: 'stdout_chunk', nodeId: 'a', line: 'one' },
      { type: 'node_started', nodeId: 'b', nodeType: 'condition', resolvedConfig: {} },
      { type: 'stdout_chunk', nodeId: 'a', line: 'two' },
      {
        type: 'node_finished',
        nodeId: 'a',
        nodeType: 'agent',
        branch: 'next',
        outputs: {},
        durationMs: 42,
      },
    ];
    const { cards } = groupEventsByNode(events);
    expect(cards.map((c) => c.nodeId)).toEqual(['a', 'b']);

    const a = cards[0];
    expect(a.events.map((e) => e.type)).toEqual([
      'node_started',
      'stdout_chunk',
      'stdout_chunk',
      'node_finished',
    ]);
    expect(a.status).toBe('finished');
    expect(a.branch).toBe('next');
    expect(a.durationMs).toBe(42);
    expect(a.nodeType).toBe('agent');

    const b = cards[1];
    expect(b.status).toBe('running');
  });

  it('places nodeId-bearing errors inside the matching card', () => {
    const events: WorkflowEvent[] = [
      { type: 'node_started', nodeId: 'a', nodeType: 'agent', resolvedConfig: {} },
      { type: 'error', nodeId: 'a', message: 'boom' },
    ];
    const { cards } = groupEventsByNode(events);
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('errored');
    expect(cards[0].events.at(-1)?.type).toBe('error');
  });

  it('routes run-level errors (no nodeId) to the footer regardless of position', () => {
    // Before any card.
    const before = groupEventsByNode([
      { type: 'run_started', workflowId: 'w', workflowName: 'W' },
      { type: 'error', message: 'pre-node boom' },
    ]);
    expect(before.cards).toHaveLength(0);
    expect(before.header.map((e) => e.type)).toEqual(['run_started']);
    expect(before.footer.map((e) => e.type)).toEqual(['error']);

    // After at least one card exists.
    const after = groupEventsByNode([
      { type: 'node_started', nodeId: 'a', nodeType: 'agent', resolvedConfig: {} },
      { type: 'error', message: 'global boom' },
    ]);
    expect(after.cards).toHaveLength(1);
    expect(after.footer.map((e) => e.type)).toEqual(['error']);
  });
});
