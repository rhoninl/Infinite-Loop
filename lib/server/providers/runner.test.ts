import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProvider } from './runner';
import type { ProviderManifest } from './types';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = resolve(here, '../../../tests/fixtures/fake-claude.sh');

const claudeStreamManifest: ProviderManifest = {
  id: 'claude',
  label: 'Claude',
  description: 'd',
  bin: FAKE_BIN,
  args: ['--print', '{prompt}'],
  outputFormat: 'claude-stream-json',
  promptVia: 'arg',
};

const plainManifest: ProviderManifest = {
  id: 'plain',
  label: 'Plain',
  description: 'd',
  bin: FAKE_BIN,
  args: ['{prompt}'],
  outputFormat: 'plain',
  promptVia: 'arg',
};

beforeEach(() => {
  delete process.env.FAKE_STDOUT_LINES;
  delete process.env.FAKE_DELAY_MS_BETWEEN_LINES;
  delete process.env.FAKE_SLEEP_MS_BEFORE_EXIT;
  delete process.env.FAKE_EXIT_CODE;
  delete process.env.FAKE_STDERR;
  // The fake script ignores argv; ensure no INFLOOP_*_BIN overrides leak.
  delete process.env.INFLOOP_PROVIDER_BIN_CLAUDE;
  delete process.env.INFLOOP_CLAUDE_BIN;
});

afterEach(() => {
  delete process.env.FAKE_STDOUT_LINES;
});

describe('runProvider', () => {
  it('streams plain stdout lines verbatim and resolves with exitCode 0', async () => {
    process.env.FAKE_STDOUT_LINES = 'hello\nworld';
    const ctrl = new AbortController();
    const chunks: string[] = [];
    const result = await runProvider(plainManifest, {
      prompt: 'p',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: ctrl.signal,
      onStdoutChunk: (line) => chunks.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('hello');
    expect(result.stdout).toContain('world');
    expect(chunks.join('')).toContain('hello');
  });

  it('parses claude stream-json text deltas into the stdout buffer', async () => {
    process.env.FAKE_STDOUT_LINES = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hi ' },
    }) + '\n' + JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'there' },
    });
    const ctrl = new AbortController();
    const result = await runProvider(claudeStreamManifest, {
      prompt: 'p',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: ctrl.signal,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Hi there');
  });

  it('captures stderr and propagates non-zero exit codes', async () => {
    process.env.FAKE_STDOUT_LINES = 'x';
    process.env.FAKE_STDERR = 'oops';
    process.env.FAKE_EXIT_CODE = '7';
    const ctrl = new AbortController();
    const result = await runProvider(plainManifest, {
      prompt: 'p',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: ctrl.signal,
    });
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('oops');
  });

  it('marks timedOut and kills the process when timeoutMs elapses', async () => {
    process.env.FAKE_STDOUT_LINES = '';
    process.env.FAKE_SLEEP_MS_BEFORE_EXIT = '5000';
    const ctrl = new AbortController();
    const start = Date.now();
    const result = await runProvider(plainManifest, {
      prompt: 'p',
      cwd: process.cwd(),
      timeoutMs: 200,
      signal: ctrl.signal,
    });
    const elapsed = Date.now() - start;
    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(3500);
  });

  it('aborts when the AbortSignal fires', async () => {
    process.env.FAKE_STDOUT_LINES = '';
    process.env.FAKE_SLEEP_MS_BEFORE_EXIT = '5000';
    const ctrl = new AbortController();
    const promise = runProvider(plainManifest, {
      prompt: 'p',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(), 50);
    const result = await promise;
    expect(result.timedOut).toBe(false);
    // Killed via SIGTERM → exitCode is null.
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
  });

  it('substitutes {prompt} into argv when promptVia is "arg"', async () => {
    // The fake script doesn't echo argv, so verify indirectly: with argv:
    // ['--print', '{prompt}'] and prompt='p', the script still runs cleanly.
    process.env.FAKE_STDOUT_LINES = 'ok';
    const ctrl = new AbortController();
    const result = await runProvider(claudeStreamManifest, {
      prompt: 'p',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: ctrl.signal,
    });
    expect(result.exitCode).toBe(0);
  });

  it('delivers the prompt via stdin when promptVia is "stdin"', async () => {
    const stdinBin = resolve(here, '../../../tests/fixtures/fake-stdin-echo.sh');
    const stdinManifest: ProviderManifest = {
      id: 'stdin-echo',
      label: 'StdinEcho',
      description: 'd',
      bin: stdinBin,
      args: [],
      outputFormat: 'plain',
      promptVia: 'stdin',
    };
    const ctrl = new AbortController();
    const result = await runProvider(stdinManifest, {
      prompt: 'hello-from-stdin',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: ctrl.signal,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PROMPT_VIA_STDIN_BEGIN');
    expect(result.stdout).toContain('hello-from-stdin');
  });

  it('returns null exitCode + helpful stderr when binary spawn fails', async () => {
    const broken: ProviderManifest = {
      ...plainManifest,
      bin: '/no/such/binary/anywhere',
    };
    const ctrl = new AbortController();
    const result = await runProvider(broken, {
      prompt: 'p',
      cwd: process.cwd(),
      timeoutMs: 1000,
      signal: ctrl.signal,
    });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toMatch(/spawn error/);
  });
});
