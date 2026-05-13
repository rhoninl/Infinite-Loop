import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { triggerIndex } from './trigger-index';
import { saveTrigger } from './trigger-store';
import type { WebhookTrigger } from '../shared/trigger';

const tmpWfDir = path.join(os.tmpdir(), `infinite-loop-tidx-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infinite-loop-tidx-tr-${process.pid}`);

async function writeWorkflow(id: string, inputs: unknown[] = []) {
  await fs.writeFile(
    path.join(tmpWfDir, `${id}.json`),
    JSON.stringify({
      id, name: id, version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs,
    }),
  );
}

function baseTrigger(id: string, overrides: Partial<WebhookTrigger> = {}): Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> {
  return {
    id, name: id, enabled: true,
    workflowId: 'wf-a', pluginId: 'generic',
    match: [], inputs: {},
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  await writeWorkflow('wf-a');
  triggerIndex.invalidate();
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
});

describe('triggerIndex (Dispatch v2)', () => {
  test('returns undefined for unknown id', async () => {
    expect(await triggerIndex.lookup('absent_id_000000000000')).toBeUndefined();
  });

  test('finds a saved trigger by id', async () => {
    await saveTrigger(baseTrigger('idAAAAAAAAAAAAAAAAAAAA'));
    const hit = await triggerIndex.lookup('idAAAAAAAAAAAAAAAAAAAA');
    expect(hit?.workflowId).toBe('wf-a');
    expect(hit?.trigger.id).toBe('idAAAAAAAAAAAAAAAAAAAA');
  });

  test('saveTrigger invalidates the index automatically', async () => {
    await saveTrigger(baseTrigger('idBBBBBBBBBBBBBBBBBBBB'));
    expect(await triggerIndex.lookup('idBBBBBBBBBBBBBBBBBBBB')).toBeDefined();
    // (saveTrigger calls triggerIndex.invalidate(); no manual call needed)
  });
});
