import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST } from '@/app/api/webhook/[triggerId]/route';
import { triggerIndex } from './trigger-index';
import { triggerQueue } from './trigger-queue-singleton';
import { eventBus } from './event-bus';
import { saveTrigger } from './trigger-store';
import type { WorkflowEvent } from '../shared/workflow';

const tmpWfDir = path.join(os.tmpdir(), `infinite-loop-webhook-int-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infinite-loop-webhook-int-tr-${process.pid}`);

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

const TID = 'integ_idAAAAAAAAAAAAAAAAA';

describe('webhook integration', () => {
  test('end-to-end: webhook hit emits trigger_enqueued event', async () => {
    await fs.writeFile(
      path.join(tmpWfDir, 'wf-int.json'),
      JSON.stringify({
        id: 'wf-int', name: 'integration', version: 1, createdAt: 0, updatedAt: 0,
        nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
        edges: [],
        inputs: [{ name: 'msg', type: 'string', default: '' }],
      }),
    );
    await saveTrigger({
      id: TID, name: 'integ', enabled: true,
      workflowId: 'wf-int', pluginId: 'generic',
      match: [{ lhs: '{{body.ok}}', op: '==', rhs: 'yes' }],
      inputs: { msg: '{{body.message}}' },
    });

    const events: WorkflowEvent[] = [];
    const unsub = eventBus.subscribe((e) => events.push(e));

    const req = new Request(`http://test/api/webhook/${TID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: 'yes', message: 'hello' }),
    });
    const res = await POST(req, { params: Promise.resolve({ triggerId: TID }) });

    expect(res.status).toBe(202);

    const enq = events.find((e) => e.type === 'trigger_enqueued');
    expect(enq).toBeDefined();
    if (enq && enq.type === 'trigger_enqueued') {
      expect(enq.triggerId).toBe(TID);
      expect(enq.workflowId).toBe('wf-int');
    }

    unsub();
  });
});
