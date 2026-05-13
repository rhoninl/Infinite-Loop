import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GET, PUT, DELETE } from './route';

const tmpWfDir = path.join(os.tmpdir(), `infinite-loop-api-tr-id-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infinite-loop-api-tr-id-tr-${process.pid}`);

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

async function seedTrigger(id: string) {
  const { saveTrigger } = await import('@/lib/server/trigger-store');
  return saveTrigger({
    id, name: id, enabled: true, workflowId: 'wf-a',
    pluginId: 'generic', match: [], inputs: {},
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
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
});

describe('GET /api/triggers/[id]', () => {
  test('returns the trigger', async () => {
    await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    const res = await GET(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA'),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trigger.id).toBe('idAAAAAAAAAAAAAAAAAAAA');
  });

  test('404 for unknown id', async () => {
    const res = await GET(
      new Request('http://test/api/triggers/absent_id_000000000000'),
      { params: Promise.resolve({ id: 'absent_id_000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/triggers/[id]', () => {
  test('updates the trigger and preserves createdAt', async () => {
    const orig = await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    await new Promise((r) => setTimeout(r, 5));
    const res = await PUT(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...orig, name: 'renamed' }),
      }),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trigger.name).toBe('renamed');
    expect(json.trigger.createdAt).toBe(orig.createdAt);
    expect(json.trigger.updatedAt).toBeGreaterThan(orig.updatedAt);
  });

  test('400 when body tries to change the id', async () => {
    await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    const res = await PUT(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'idDIFFERENTDIFFERENT12', name: 'x', enabled: true,
          workflowId: 'wf-a', pluginId: 'generic', match: [], inputs: {},
        }),
      }),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/triggers/[id]', () => {
  test('removes the trigger', async () => {
    await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    const res = await DELETE(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(204);
    const { listTriggers } = await import('@/lib/server/trigger-store');
    expect(await listTriggers()).toHaveLength(0);
  });

  test('404 for unknown id', async () => {
    const res = await DELETE(
      new Request('http://test/api/triggers/absent_id_000000000000', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'absent_id_000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
