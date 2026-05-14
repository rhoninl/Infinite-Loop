import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPlugins } from './loader';

const tmpDir = path.join(os.tmpdir(), `infloop-plugins-${process.pid}`);

async function writePlugin(name: string, body: unknown) {
  await fs.writeFile(
    path.join(tmpDir, `${name}.json`),
    JSON.stringify(body),
    'utf8',
  );
}

beforeEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadPlugins', () => {
  test('returns the built-in Generic plugin even when dir is empty', async () => {
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'generic')).toBeDefined();
  });

  test('loads a valid plugin from disk', async () => {
    await writePlugin('github', {
      id: 'github',
      displayName: 'GitHub',
      eventHeader: 'x-github-event',
      events: [
        {
          type: 'push',
          displayName: 'Push',
          fields: [{ path: 'body.ref', type: 'string' }],
        },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    const gh = plugins.find((p) => p.id === 'github');
    expect(gh).toBeDefined();
    expect(gh?.events[0].type).toBe('push');
  });

  test('rejects a plugin missing id', async () => {
    await writePlugin('bad', {
      displayName: 'Bad',
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    // Built-in Generic still present, bad one filtered out
    expect(plugins.find((p) => p.id === 'generic')).toBeDefined();
    expect(plugins.find((p) => p.displayName === 'Bad')).toBeUndefined();
  });

  test('rejects a plugin with non-unique event types', async () => {
    await writePlugin('dup', {
      id: 'dup',
      displayName: 'Dup',
      events: [
        { type: 'a', displayName: 'A', fields: [] },
        { type: 'a', displayName: 'A2', fields: [] },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'dup')).toBeUndefined();
  });

  test('rejects a field with unknown type', async () => {
    await writePlugin('weird', {
      id: 'weird',
      displayName: 'Weird',
      events: [
        {
          type: 'x',
          displayName: 'X',
          fields: [{ path: 'body.x', type: 'mystery' }],
        },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'weird')).toBeUndefined();
  });

  test('a user plugin can NOT override the built-in generic id', async () => {
    await writePlugin('generic', {
      id: 'generic',
      displayName: 'NotGeneric',
      events: [{ type: 'any', displayName: 'Any', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    const g = plugins.find((p) => p.id === 'generic');
    expect(g?.displayName).toBe('Generic'); // built-in wins
  });

  test('loads a plugin with a valid signature block and lowercases the header', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'X-Frogo-Event',
      signature: {
        header: 'X-Frogo-Signature',
        scheme: 'hmac-sha256',
        format: 'sha256=<hex>',
      },
      events: [
        {
          type: 'task.created',
          displayName: 'Task created',
          fields: [{ path: 'body.event', type: 'string' }],
        },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    const f = plugins.find((p) => p.id === 'frogo');
    expect(f).toBeDefined();
    expect(f?.eventHeader).toBe('x-frogo-event');
    expect(f?.signature?.header).toBe('x-frogo-signature');
    expect(f?.signature?.scheme).toBe('hmac-sha256');
    expect(f?.signature?.format).toBe('sha256=<hex>');
  });

  test('rejects a plugin with an unsupported signature scheme', async () => {
    await writePlugin('bad-scheme', {
      id: 'badscheme',
      displayName: 'Bad',
      eventHeader: 'x-e',
      signature: { header: 'x-sig', scheme: 'md5', format: 'hex' },
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'badscheme')).toBeUndefined();
  });

  test('rejects a plugin with an unknown signature format', async () => {
    await writePlugin('bad-format', {
      id: 'badformat',
      displayName: 'Bad',
      eventHeader: 'x-e',
      signature: { header: 'x-sig', scheme: 'hmac-sha256', format: 'pem' },
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'badformat')).toBeUndefined();
  });

  test('rejects a plugin where signature is present but header is missing', async () => {
    await writePlugin('no-header', {
      id: 'noheader',
      displayName: 'Bad',
      eventHeader: 'x-e',
      signature: { scheme: 'hmac-sha256', format: 'hex' },
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'noheader')).toBeUndefined();
  });
});

describe('loadPlugins — real frogo.json from repo', () => {
  test('the shipped webhook-plugins/frogo.json loads cleanly', async () => {
    const repoPluginsDir = path.resolve(__dirname, '..', '..', '..', 'webhook-plugins');
    const plugins = await loadPlugins(repoPluginsDir);
    const frogo = plugins.find((p) => p.id === 'frogo');
    expect(frogo).toBeDefined();
    expect(frogo?.signature?.header).toBe('x-frogo-signature');
    expect(frogo?.signature?.scheme).toBe('hmac-sha256');
    expect(frogo?.signature?.format).toBe('sha256=<hex>');
    expect(frogo?.events.find((e) => e.type === 'task.created')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'task.updated')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'task.deleted')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'task.commented')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'ping')).toBeDefined();
  });
});
