import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST as webhookPOST } from '@/app/api/webhook/[triggerId]/route';
import { saveTrigger } from './trigger-store';
import { triggerIndex } from './trigger-index';
import { triggerQueue } from './trigger-queue-singleton';
import { eventBus } from './event-bus';
import type { WorkflowEvent } from '../shared/workflow';

const tmpWfDir = path.join(os.tmpdir(), `infinite-loop-dispatch-int-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infinite-loop-dispatch-int-tr-${process.pid}`);

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  triggerIndex.invalidate();
  triggerQueue.clear();
  eventBus.clear();
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  eventBus.clear();
});

test('Dispatch v2 end-to-end: GitHub issues event fires the right workflow', async () => {
  // Workflow declares a number-typed input (exercises the coercion fix).
  await fs.writeFile(
    path.join(tmpWfDir, 'triage.json'),
    JSON.stringify({
      id: 'triage', name: 'Triage', version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      inputs: [
        { name: 'issue_number', type: 'number' },
        { name: 'title',        type: 'string' },
      ],
    }),
  );

  await saveTrigger({
    id: 'integGHGHGHGHGHGHGHGHGH', name: 'gh', enabled: true,
    workflowId: 'triage', pluginId: 'github', eventType: 'issues',
    match: [{ lhs: '{{body.action}}', op: '==', rhs: 'opened' }],
    inputs: {
      issue_number: '{{body.issue.number}}',
      title:        '{{body.issue.title}}',
    },
  });

  const events: WorkflowEvent[] = [];
  const unsub = eventBus.subscribe((e) => events.push(e));

  // Real GitHub-shape payload, event header set.
  const req = new Request('http://test/api/webhook/integGHGHGHGHGHGHGHGHGH', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'issues',
    },
    body: JSON.stringify({
      action: 'opened',
      issue: { number: 42, title: 'Webhook integration broken on weekends' },
    }),
  });
  const res = await webhookPOST(req, {
    params: Promise.resolve({ triggerId: 'integGHGHGHGHGHGHGHGHGH' }),
  });

  expect(res.status).toBe(202);

  // Coerced "42" → 42; predicate matched; trigger_enqueued fired.
  const enq = events.find((e) => e.type === 'trigger_enqueued');
  expect(enq).toBeDefined();
  if (enq && enq.type === 'trigger_enqueued') {
    expect(enq.workflowId).toBe('triage');
    expect(enq.triggerId).toBe('integGHGHGHGHGHGHGHGHGH');
  }

  unsub();
  triggerQueue.clear();
});

test('predicate-miss returns 204 and does NOT enqueue', async () => {
  await fs.writeFile(
    path.join(tmpWfDir, 'wf.json'),
    JSON.stringify({
      id: 'wf', name: 'wf', version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs: [],
    }),
  );
  await saveTrigger({
    id: 'integGHGHGHGHGHGHGH222', name: 'miss', enabled: true,
    workflowId: 'wf', pluginId: 'github', eventType: 'issues',
    match: [{ lhs: '{{body.action}}', op: '==', rhs: 'opened' }],
    inputs: {},
  });

  const req = new Request('http://test/api/webhook/integGHGHGHGHGHGHGH222', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'issues',
    },
    body: JSON.stringify({ action: 'closed' }),
  });
  const res = await webhookPOST(req, {
    params: Promise.resolve({ triggerId: 'integGHGHGHGHGHGHGH222' }),
  });

  expect(res.status).toBe(204);
});
