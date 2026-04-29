import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    expect(list[0].bin).toBe('a-bin');
  });

  it('resolveBin honors INFLOOP_PROVIDER_BIN_<ID> and INFLOOP_CLAUDE_BIN alias', async () => {
    const { resolveBin } = await import('./loader');
    const claudeManifest = {
      id: 'claude',
      label: 'Claude',
      description: 'd',
      bin: 'claude',
      args: ['{prompt}'],
      outputFormat: 'plain',
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
