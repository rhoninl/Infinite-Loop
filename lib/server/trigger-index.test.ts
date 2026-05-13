import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { triggerIndex } from './trigger-index';

const tmpDir = path.join(os.tmpdir(), `infloop-trigger-index-${process.pid}`);

async function writeWorkflow(id: string, triggers: unknown[] = []) {
  const file = path.join(tmpDir, `${id}.json`);
  await fs.writeFile(
    file,
    JSON.stringify({
      id,
      name: id,
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      triggers,
    }),
  );
}

beforeEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpDir;
  triggerIndex.invalidate();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('triggerIndex', () => {
  test('returns undefined for unknown id', async () => {
    expect(await triggerIndex.lookup('absent')).toBeUndefined();
  });

  test('finds a trigger by id', async () => {
    await writeWorkflow('wf-a', [
      { id: 'abc123abc123abc123', name: 't1', enabled: true, match: [], inputs: {} },
    ]);
    const hit = await triggerIndex.lookup('abc123abc123abc123');
    expect(hit?.workflowId).toBe('wf-a');
    expect(hit?.trigger.name).toBe('t1');
  });

  test('invalidate forces a re-scan', async () => {
    await writeWorkflow('wf-a', [
      { id: 'idA1234567890abcdef', name: 't', enabled: true, match: [], inputs: {} },
    ]);
    await triggerIndex.lookup('idA1234567890abcdef'); // primes
    await writeWorkflow('wf-a', []); // remove trigger
    triggerIndex.invalidate();
    expect(await triggerIndex.lookup('idA1234567890abcdef')).toBeUndefined();
  });

  test('handles a workflow with no triggers field', async () => {
    await writeWorkflow('wf-a');
    expect(await triggerIndex.lookup('anything')).toBeUndefined();
  });
});
