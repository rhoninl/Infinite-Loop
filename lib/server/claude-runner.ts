import { spawn } from 'node:child_process';
import type { RunnerOptions, RunnerResult } from '../shared/types';

const SIGKILL_GRACE_MS = 2000;

/**
 * Spawns the Claude CLI binary, streams stdout line-by-line to the optional
 * callback, accumulates stdout/stderr, and enforces both a per-iteration
 * timeout and an external AbortSignal. Always resolves; never rejects.
 */
export async function runClaude(opts: RunnerOptions): Promise<RunnerResult> {
  const bin = process.env.INFLOOP_CLAUDE_BIN ?? 'claude';
  const startedAt = Date.now();

  return new Promise<RunnerResult>((resolve) => {
    // detached:true puts the child in its own process group so we can kill
    // the whole group (including grandchildren like `sleep`) on timeout/abort.
    // Without this, an orphaned grandchild keeps the stdio pipes open and
    // the 'close' event is delayed until the grandchild exits naturally.
    const child = spawn(bin, ['--print', opts.prompt], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const cleanup = (): void => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      opts.signal.removeEventListener('abort', onAbort);
    };

    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid == null) return;
      try {
        // Negative PID targets the whole process group.
        process.kill(-child.pid, signal);
      } catch {
        // Group may already be gone; fall back to a direct child kill.
        try {
          child.kill(signal);
        } catch {
          // ignore — already gone
        }
      }
    };

    const scheduleSigkill = (): void => {
      if (killTimer) return;
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
      }, SIGKILL_GRACE_MS);
    };

    const onTimeout = (): void => {
      timedOut = true;
      killGroup('SIGTERM');
      scheduleSigkill();
    };

    const onAbort = (): void => {
      killGroup('SIGTERM');
      scheduleSigkill();
    };

    if (opts.signal.aborted) {
      onAbort();
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (opts.timeoutMs > 0) {
      timeoutTimer = setTimeout(onTimeout, opts.timeoutMs);
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      // Emit each chunk as it arrives instead of buffering for `\n`. Real
      // `claude --print` running under a pipe block-buffers its stdout and
      // can sit on KBs of output before flushing a newline; line-buffered
      // emission means the user sees nothing live. A chunk may contain
      // partial or multiple lines; the consumer renders with white-space:
      // pre-wrap so visual line breaks survive.
      if (chunk.length > 0) opts.onStdoutChunk?.(chunk);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    child.on('error', (err) => {
      // Spawn failure (e.g., binary not found): surface via stderr so the
      // caller can diagnose, then resolve with exitCode=null.
      stderr += (stderr.length > 0 ? '\n' : '') + `runClaude spawn error: ${err.message}`;
      finish(null);
    });

    child.on('close', (code) => {
      // Node sets code to null when the child was killed by a signal.
      finish(code);
    });
  });
}
