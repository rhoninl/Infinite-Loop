import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { runClaude } from './claude-runner';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.resolve(HERE, '../../tests/fixtures/fake-claude.sh');

function neverAbort(): AbortSignal {
  return new AbortController().signal;
}

describe('runClaude', () => {
  beforeEach(() => {
    process.env.INFLOOP_CLAUDE_BIN = FAKE_CLAUDE;
    // Reset fixture knobs between tests.
    delete process.env.FAKE_STDOUT_LINES;
    delete process.env.FAKE_DELAY_MS_BETWEEN_LINES;
    delete process.env.FAKE_SLEEP_MS_BEFORE_EXIT;
    delete process.env.FAKE_EXIT_CODE;
    delete process.env.FAKE_STDERR;
  });

  it('streams stdout as raw chunks and reports a clean exit', async () => {
    process.env.FAKE_STDOUT_LINES = 'alpha\nbravo\ncharlie';

    const chunks: string[] = [];
    const result = await runClaude({
      prompt: 'ignored',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: neverAbort(),
      onStdoutChunk: (chunk) => chunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    // The runner emits whatever the OS delivers — a chunk may contain one
    // line, several, or part of one. The contract is "fired with non-empty
    // raw stdout chunks as they arrive". We assert at least one chunk fired
    // and the joined chunks equal the full stdout.
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toBe(result.stdout);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('bravo');
    expect(result.stdout).toContain('charlie');
    expect(result.stderr).toBe('');
  });

  it('marks timedOut=true and SIGKILLs after grace when the child overruns timeoutMs', async () => {
    process.env.FAKE_SLEEP_MS_BEFORE_EXIT = '5000';

    const start = Date.now();
    const result = await runClaude({
      prompt: 'ignored',
      cwd: process.cwd(),
      timeoutMs: 200,
      signal: neverAbort(),
    });
    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(true);
    // SIGTERM should suffice for a sleeping bash; we still budget for the
    // 2s SIGKILL grace window plus jitter.
    expect(elapsed).toBeLessThan(3000);
    // exitCode is null when the child is killed by signal (no numeric code).
    expect(result.exitCode).toBeNull();
  }, 10_000);

  it('honors AbortSignal: caller cancellation kills the child but reports timedOut=false', async () => {
    process.env.FAKE_SLEEP_MS_BEFORE_EXIT = '5000';

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const start = Date.now();
    const result = await runClaude({
      prompt: 'ignored',
      cwd: process.cwd(),
      timeoutMs: 60_000, // intentionally large so abort, not timeout, ends the run
      signal: controller.signal,
    });
    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(false);
    expect(elapsed).toBeLessThan(3000);
    expect(result.exitCode).toBeNull();
  }, 10_000);

  it('propagates a non-zero exit code with timedOut=false', async () => {
    process.env.FAKE_EXIT_CODE = '7';
    process.env.FAKE_STDOUT_LINES = 'hello';

    const result = await runClaude({
      prompt: 'ignored',
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: neverAbort(),
    });

    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('hello');
  });
});
