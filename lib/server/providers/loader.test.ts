import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

let tmpDir: string;
let prevDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infloop-providers-'));
  prevDir = process.env.INFLOOP_PROVIDERS_DIR;
  process.env.INFLOOP_PROVIDERS_DIR = tmpDir;
});

afterEach(async () => {
  if (prevDir === undefined) {
    delete process.env.INFLOOP_PROVIDERS_DIR;
  } else {
    process.env.INFLOOP_PROVIDERS_DIR = prevDir;
  }
  await fsp.rm(tmpDir, { recursive: true, force: true });
  // Drop the loader's cache between tests.
  const { _resetProviderCache } = await import('./loader');
  _resetProviderCache();
});

function writeManifest(name: string, body: object | string): void {
  fs.writeFileSync(
    path.join(tmpDir, name),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

describe('providers/loader', () => {
  it('returns [] for an empty / missing directory', async () => {
    const { loadProviders } = await import('./loader');
    expect(await loadProviders()).toEqual([]);
  });

  it('loads valid manifests sorted by label', async () => {
    writeManifest('z.json', {
      id: 'z-prov',
      label: 'Zeta',
      description: 'd',
      bin: 'z',
      args: ['{prompt}'],
      outputFormat: 'plain',
    });
    writeManifest('a.json', {
      id: 'a-prov',
      label: 'Alpha',
      description: 'd',
      bin: 'a',
      args: ['{prompt}'],
      outputFormat: 'plain',
    });
    const { loadProviders } = await import('./loader');
    const list = await loadProviders();
    expect(list.map((m) => m.id)).toEqual(['a-prov', 'z-prov']);
  });

  it('skips malformed JSON without throwing', async () => {
    writeManifest('broken.json', '{not valid');
    writeManifest('ok.json', {
      id: 'ok',
      label: 'Ok',
      description: 'd',
      bin: 'x',
      args: ['{prompt}'],
      outputFormat: 'plain',
    });
    const { loadProviders } = await import('./loader');
    const list = await loadProviders();
    expect(list.map((m) => m.id)).toEqual(['ok']);
  });

  it('skips manifests with missing required fields', async () => {
    writeManifest('incomplete.json', { id: 'x', label: 'X' });
    writeManifest('ok.json', {
      id: 'ok',
      label: 'Ok',
      description: 'd',
      bin: 'x',
      args: ['{prompt}'],
      outputFormat: 'plain',
    });
    const { loadProviders } = await import('./loader');
    const list = await loadProviders();
    expect(list.map((m) => m.id)).toEqual(['ok']);
  });

  it('skips manifests with unknown outputFormat', async () => {
    writeManifest('weird.json', {
      id: 'w',
      label: 'W',
      description: 'd',
      bin: 'x',
      args: ['{prompt}'],
      outputFormat: 'made-up',
    });
    const { loadProviders } = await import('./loader');
    expect((await loadProviders()).map((m) => m.id)).toEqual([]);
  });

  it('skips duplicate ids (first wins, warn-not-throw)', async () => {
    writeManifest('a.json', {
      id: 'dup',
      label: 'A',
      description: 'd',
      bin: 'a-bin',
      args: ['{prompt}'],
      outputFormat: 'plain',
    });
    writeManifest('b.json', {
      id: 'dup',
      label: 'B',
      description: 'd',
      bin: 'b-bin',
      args: ['{prompt}'],
      outputFormat: 'plain',
    });
    const { loadProviders } = await import('./loader');
    const list = await loadProviders();
    expect(list).toHaveLength(1);
    // Sorted reads `a.json` before `b.json`; first-wins keeps `bin: 'a-bin'`.
    const winner = list[0];
    if (winner.transport !== 'cli') throw new Error('expected cli transport');
    expect(winner.bin).toBe('a-bin');
  });

  it('loads an http-transport manifest with auth + profiles', async () => {
    writeManifest('hermes.json', {
      id: 'hermes',
      label: 'Hermes',
      description: 'd',
      transport: 'http',
      baseUrl: 'https://hermes.example/v1/',
      endpoint: '/chat/completions',
      profilesEndpoint: '/models',
      auth: { type: 'bearer', envVar: 'INFLOOP_HERMES_TOKEN' },
      profiles: [{ id: 'hermes-3', label: 'Hermes 3' }],
      defaultProfile: 'hermes-3',
    });
    const { loadProviders } = await import('./loader');
    const list = await loadProviders();
    expect(list).toHaveLength(1);
    const m = list[0];
    expect(m.transport).toBe('http');
    if (m.transport !== 'http') throw new Error('unreachable'); // type narrow
    // Trailing slash should be stripped from baseUrl.
    expect(m.baseUrl).toBe('https://hermes.example/v1');
    expect(m.endpoint).toBe('/chat/completions');
    expect(m.auth?.envVar).toBe('INFLOOP_HERMES_TOKEN');
    expect(m.profiles).toEqual([{ id: 'hermes-3', label: 'Hermes 3' }]);
    expect(m.defaultProfile).toBe('hermes-3');
  });

  it('rejects an http manifest whose endpoint omits the leading slash', async () => {
    writeManifest('bad.json', {
      id: 'bad',
      label: 'Bad',
      description: 'd',
      transport: 'http',
      baseUrl: 'https://x/v1',
      endpoint: 'chat/completions',
    });
    const { loadProviders } = await import('./loader');
    expect(await loadProviders()).toEqual([]);
  });

  it('rejects an http manifest whose profilesEndpoint omits the leading slash', async () => {
    writeManifest('bad.json', {
      id: 'bad',
      label: 'Bad',
      description: 'd',
      transport: 'http',
      baseUrl: 'https://x/v1',
      endpoint: '/chat/completions',
      profilesEndpoint: 'models',
    });
    const { loadProviders } = await import('./loader');
    expect(await loadProviders()).toEqual([]);
  });

  it('rejects an http manifest missing baseUrl', async () => {
    writeManifest('bad.json', {
      id: 'bad',
      label: 'Bad',
      description: 'd',
      transport: 'http',
      endpoint: '/x',
    });
    const { loadProviders } = await import('./loader');
    expect(await loadProviders()).toEqual([]);
  });

  it('rejects an http manifest with non-bearer auth.type', async () => {
    writeManifest('bad.json', {
      id: 'bad',
      label: 'Bad',
      description: 'd',
      transport: 'http',
      baseUrl: 'https://x',
      endpoint: '/c',
      auth: { type: 'basic', envVar: 'X' },
    });
    const { loadProviders } = await import('./loader');
    expect(await loadProviders()).toEqual([]);
  });

  it('rejects a manifest with an unknown transport', async () => {
    writeManifest('bad.json', {
      id: 'bad',
      label: 'Bad',
      description: 'd',
      transport: 'grpc',
      baseUrl: 'https://x',
      endpoint: '/c',
    });
    const { loadProviders } = await import('./loader');
    expect(await loadProviders()).toEqual([]);
  });

  it('resolveBin honors INFLOOP_PROVIDER_BIN_<ID> and INFLOOP_CLAUDE_BIN alias', async () => {
    const { resolveBin } = await import('./loader');
    const claudeManifest = {
      id: 'claude',
      label: 'Claude',
      description: 'd',
      transport: 'cli' as const,
      bin: 'claude',
      args: ['{prompt}'],
      outputFormat: 'plain',
      promptVia: 'arg' as const,
    };
    const otherManifest = {
      ...claudeManifest,
      id: 'codex',
      bin: 'codex',
    };

    expect(resolveBin(claudeManifest)).toBe('claude');

    process.env.INFLOOP_CLAUDE_BIN = '/path/to/legacy';
    expect(resolveBin(claudeManifest)).toBe('/path/to/legacy');
    delete process.env.INFLOOP_CLAUDE_BIN;

    process.env.INFLOOP_PROVIDER_BIN_CLAUDE = '/path/to/new';
    expect(resolveBin(claudeManifest)).toBe('/path/to/new');
    delete process.env.INFLOOP_PROVIDER_BIN_CLAUDE;

    process.env.INFLOOP_PROVIDER_BIN_CODEX = '/path/to/codex';
    expect(resolveBin(otherManifest)).toBe('/path/to/codex');
    delete process.env.INFLOOP_PROVIDER_BIN_CODEX;
  });
});
