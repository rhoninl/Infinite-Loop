import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeExecutor } from './judge';
import { _resetProviderCache } from '../providers/loader';
import type { NodeExecutorContext } from '../../shared/workflow';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = resolve(here, '../../../tests/fixtures/fake-claude.sh');

let providersDir: string;
let prevProvidersDir: string | undefined;

const judgeEnvVars = [
  'FAKE_CLAUDE_JUDGE_WINNER',
  'FAKE_CLAUDE_JUDGE_SCORES',
  'FAKE_CLAUDE_JUDGE_BAD',
  'FAKE_STDOUT_LINES',
  'FAKE_EXIT_CODE',
];

function clearJudgeEnv(): void {
  for (const k of judgeEnvVars) delete process.env[k];
}

beforeEach(() => {
  providersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinite-loop-judge-test-'));
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
  process.env.INFLOOP_PROVIDER_BIN_CLAUDE = FAKE_BIN;
  // Make sure the script is executable; tests bring up a fresh checkout.
  fs.chmodSync(FAKE_BIN, 0o755);
  clearJudgeEnv();
});

afterEach(async () => {
  if (prevProvidersDir === undefined) {
    delete process.env.INFLOOP_PROVIDERS_DIR;
  } else {
    process.env.INFLOOP_PROVIDERS_DIR = prevProvidersDir;
  }
  delete process.env.INFLOOP_PROVIDER_BIN_CLAUDE;
  clearJudgeEnv();
  await fsp.rm(providersDir, { recursive: true, force: true });
  _resetProviderCache();
});

function makeCtx(
  config: unknown,
  signal?: AbortSignal,
): NodeExecutorContext {
  return {
    config,
    scope: {},
    defaultCwd: process.cwd(),
    signal: signal ?? new AbortController().signal,
  };
}

describe('judgeExecutor', () => {
  it('routes the happy path to the next branch with parsed verdict', async () => {
    process.env.FAKE_CLAUDE_JUDGE_WINNER = '1';
    process.env.FAKE_CLAUDE_JUDGE_SCORES = '3,9,4';
    const out = await judgeExecutor.execute(
      makeCtx({
        criteria: 'best haiku',
        candidates: ['cand a', 'cand b', 'cand c'],
      }),
    );
    expect(out.branch).toBe('next');
    expect(out.outputs).toMatchObject({
      winner_index: 1,
      winner: 'cand b',
      scores: [3, 9, 4],
      reasoning: 'fake',
    });
  });

  it('errors when fewer than 2 candidates are provided', async () => {
    const out = await judgeExecutor.execute(
      makeCtx({
        criteria: 'pick best',
        candidates: ['only one'],
      }),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs).toMatchObject({
      errorMessage: expect.stringMatching(/at least 2 candidates/),
    });
  });

  it('errors when winner_index is out of range', async () => {
    process.env.FAKE_CLAUDE_JUDGE_WINNER = '5';
    process.env.FAKE_CLAUDE_JUDGE_SCORES = '5,5';
    const out = await judgeExecutor.execute(
      makeCtx({
        criteria: 'c',
        candidates: ['x', 'y'],
      }),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs).toMatchObject({
      errorMessage: expect.stringMatching(/judge failed/),
      raw: expect.any(String),
    });
  });

  it('returns the error branch with raw output after retry on bad JSON', async () => {
    process.env.FAKE_CLAUDE_JUDGE_BAD = '1';
    const out = await judgeExecutor.execute(
      makeCtx({
        criteria: 'c',
        candidates: ['x', 'y'],
      }),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs).toMatchObject({
      errorMessage: expect.stringMatching(/judge failed/),
      raw: expect.stringContaining('not json'),
    });
  });

  it('exits cleanly with the error branch when the abort signal fires', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await judgeExecutor.execute(
      makeCtx(
        {
          criteria: 'c',
          candidates: ['x', 'y'],
        },
        ctrl.signal,
      ),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs).toMatchObject({ errorMessage: 'aborted' });
  });

  it('errors with a clear message when providerId is unknown', async () => {
    const out = await judgeExecutor.execute(
      makeCtx({
        criteria: 'c',
        candidates: ['x', 'y'],
        providerId: 'does-not-exist',
      }),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs).toMatchObject({
      errorMessage: expect.stringMatching(/unknown provider/),
    });
  });
});
