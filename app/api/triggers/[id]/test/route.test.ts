import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST } from './route';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

const tmpWfDir = path.join(os.tmpdir(), `infinite-loop-api-test-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infinite-loop-api-test-tr-${process.pid}`);

async function writeWorkflow(id: string) {
  await fs.writeFile(
    path.join(tmpWfDir, `${id}.json`),
    JSON.stringify({
      id, name: id, version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs: [],
    }),
  );
}

async function seedTrigger() {
  const { saveTrigger } = await import('@/lib/server/trigger-store');
  return saveTrigger({
    id: 'idTESTTESTTESTTESTTEST', name: 't', enabled: true,
    workflowId: 'wf-a', pluginId: 'generic', match: [], inputs: {},
  });
}

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  await writeWorkflow('wf-a');
  triggerQueue.clear();
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  triggerQueue.clear();
});

describe('POST /api/triggers/[id]/test', () => {
  test('echoes status 202 when the synthetic payload triggers the workflow', async () => {
    await seedTrigger();
    const res = await POST(
      new Request('http://test/api/triggers/idTESTTESTTESTTESTTEST/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: { hello: 'world' } }),
      }),
      { params: Promise.resolve({ id: 'idTESTTESTTESTTESTTEST' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe(202);
  });

  test('404 for unknown trigger', async () => {
    const res = await POST(
      new Request('http://test/api/triggers/absent_id_000000000000/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: {} }),
      }),
      { params: Promise.resolve({ id: 'absent_id_000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
