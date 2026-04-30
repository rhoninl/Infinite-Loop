import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IterationRecord } from '../../shared/types';
import { commandStrategy } from './command';

const stubIter: IterationRecord = {
  n: 1,
  exitCode: 0,
  stdout: '',
  stderr: '',
  durationMs: 0,
  timedOut: false,
};

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infloop-cmd-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
});

describe('commandStrategy', () => {
  it('returns met=true when the command exits 0', async () => {
    const result = await commandStrategy.evaluate(
      stubIter,
      { cmd: 'true' },
      process.cwd(),
    );
    expect(result.met).toBe(true);
    expect(result.detail).toBe('exit 0');
  });

  it('returns met=false with exit code detail on non-zero exit', async () => {
    const result = await commandStrategy.evaluate(
      stubIter,
      { cmd: 'false' },
      process.cwd(),
    );
    expect(result.met).toBe(false);
    expect(result.detail).toMatch(/^exit \d+$/);
    // `false` exits with 1 on POSIX systems
    expect(result.detail).toContain('exit 1');
  });

  it('returns met=false when the command is not found', async () => {
    const result = await commandStrategy.evaluate(
      stubIter,
      { cmd: 'this-command-definitely-does-not-exist-xyz123' },
      process.cwd(),
    );
    expect(result.met).toBe(false);
    // Via shell, command-not-found yields exit 127. If a non-shell path is
    // taken it would surface as a "check error". Either is acceptable.
    expect(result.detail).toMatch(/^(exit \d+|check error: .+)$/);
  });

  it('honors cwd: marker present', async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'marker.txt'), 'hi');

    const result = await commandStrategy.evaluate(
      stubIter,
      { cmd: 'test -f marker.txt' },
      dir,
    );
    expect(result.met).toBe(true);
    expect(result.detail).toBe('exit 0');
  });

  it('honors cwd: marker absent', async () => {
    const dir = makeTmpDir();
    const result = await commandStrategy.evaluate(
      stubIter,
      { cmd: 'test -f marker.txt' },
      dir,
    );
    expect(result.met).toBe(false);
    expect(result.detail).toMatch(/^exit \d+$/);
  });

  it('returns met=false with descriptive detail on invalid config', async () => {
    const r1 = await commandStrategy.evaluate(stubIter, {}, process.cwd());
    expect(r1).toEqual({ met: false, detail: 'invalid command config' });

    const r2 = await commandStrategy.evaluate(
      stubIter,
      { cmd: 123 },
      process.cwd(),
    );
    expect(r2).toEqual({ met: false, detail: 'invalid command config' });

    const r3 = await commandStrategy.evaluate(stubIter, null, process.cwd());
    expect(r3).toEqual({ met: false, detail: 'invalid command config' });
  });
});
