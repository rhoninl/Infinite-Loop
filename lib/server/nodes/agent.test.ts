import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentExecutor } from './agent';
import { _resetProviderCache } from '../providers/loader';
import type { NodeExecutorContext } from '../../shared/workflow';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = resolve(here, '../../../tests/fixtures/fake-claude.sh');

let providersDir: string;
let prevProvidersDir: string | undefined;

beforeEach(() => {
  providersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infloop-agent-test-'));
  prevProvidersDir = process.env.INFLOOP_PROVIDERS_DIR;
  process.env.INFLOOP_PROVIDERS_DIR = providersDir;
  fs.writeFileSync(
    path.join(providersDir, 'claude.json'),
    JSON.stringify({
      id: 'claude',
      label: 'Claude',
      description: 'fake',
      bin: 'claude',
      args: ['{prompt}'],
      outputFormat: 'plain',
    }),
  );
  _resetProviderCache();
});

afterEach(async () => {
  if (prevProvidersDir === undefined) {
    delete process.env.INFLOOP_PROVIDERS_DIR;
  } else {
    process.env.INFLOOP_PROVIDERS_DIR = prevProvidersDir;
  }
  await fsp.rm(providersDir, { recursive: true, force: true });
  _resetProviderCache();
});

function ctx(config: unknown): NodeExecutorContext {
  return {
    config,
    scope: {},
    defaultCwd: process.cwd(),
    signal: new AbortController().signal,
  };
}

describe('agentExecutor', () => {
  it('routes invalid configs to the error branch', async () => {
    const out = await agentExecutor.execute(ctx({}));
    expect(out.branch).toBe('error');
    expect(out.outputs).toMatchObject({ errorMessage: expect.any(String) });
  });

  it('errors when the providerId is unknown', async () => {
    const out = await agentExecutor.execute(
      ctx({
        providerId: 'does-not-exist',
        prompt: 'p',
        cwd: '/tmp',
        timeoutMs: 1000,
      }),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs).toMatchObject({
      errorMessage: expect.stringMatching(/unknown provider/),
    });
  });

  it('runs the resolved provider and routes to next on exit 0', async () => {
    process.env.INFLOOP_PROVIDER_BIN_CLAUDE = FAKE_BIN;
    process.env.FAKE_STDOUT_LINES = 'ok';
    try {
      const out = await agentExecutor.execute(
        ctx({
          providerId: 'claude',
          prompt: 'p',
          cwd: process.cwd(),
          timeoutMs: 5000,
        }),
      );
      expect(out.branch).toBe('next');
      expect(out.outputs).toMatchObject({ exitCode: 0 });
    } finally {
      delete process.env.INFLOOP_PROVIDER_BIN_CLAUDE;
      delete process.env.FAKE_STDOUT_LINES;
    }
  });
});
