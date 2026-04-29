import { spawn } from 'node:child_process';
import type { RunnerOptions, RunnerResult } from '../../shared/types';
import { parsers } from './parsers/index';
import { resolveBin } from './loader';
import type { ProviderManifest } from './types';

const SIGKILL_GRACE_MS = 2000;

/**
 * Spawn a provider's CLI binary, stream stdout line-by-line through the
 * provider's parser, accumulate stdout/stderr, and enforce a per-iteration
 * timeout + external AbortSignal. Always resolves; never rejects.
 *
 * The spawn/process-group/timeout/abort scaffolding is provider-agnostic.
 * What changes per provider:
 *   - the binary (manifest.bin, env-overridable via INFLOOP_PROVIDER_BIN_<ID>)
 *   - argv (manifest.args with `{prompt}` substituted, or stdin delivery)
 *   - line parsing (manifest.outputFormat → parsers[key])
 */
export async function runProvider(
  manifest: ProviderManifest,
  opts: RunnerOptions,
): Promise<RunnerResult> {
  const bin = resolveBin(manifest);
  const promptVia = manifest.promptVia ?? 'arg';
  const args =
    promptVia === 'stdin'
      ? manifest.args
      : manifest.args.map((a) => a.replace(/\{prompt\}/g, opts.prompt));
  const parser = parsers[manifest.outputFormat];
  if (!parser) {
    // Loader validates this, but guard runtime injection too.
    return {
      exitCode: null,
      stdout: '',
      stderr: `runProvider: unknown outputFormat "${manifest.outputFormat}"`,
      durationMs: 0,
      timedOut: false,
    };
  }

  const startedAt = Date.now();

  return new Promise<RunnerResult>((resolve) => {
    // detached:true puts the child in its own process group so we can kill
    // the whole group (including grandchildren like `sleep`) on timeout/abort.
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: [promptVia === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: true,
    });

    if (promptVia === 'stdin' && child.stdin) {
      child.stdin.setDefaultEncoding('utf8');
      child.stdin.write(opts.prompt);
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';
    let lineBuf = '';
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
        process.kill(-child.pid, signal);
      } catch {
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

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      lineBuf += chunk;
      let nl: number;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const lineWithNl = lineBuf.slice(0, nl + 1);
        const lineTrimmed = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (lineTrimmed.length === 0) continue;

        const classified = parser(lineTrimmed);
        let emit = '';
        if (classified.kind === 'json') {
          emit = classified.text;
        } else {
          emit = lineWithNl;
        }
        if (emit.length > 0) {
          stdout += emit;
          opts.onStdoutChunk?.(emit);
        }
      }
    });

    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
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
      stderr +=
        (stderr.length > 0 ? '\n' : '') +
        `runProvider(${manifest.id}) spawn error: ${err.message}`;
      finish(null);
    });

    child.on('close', (code) => {
      // Flush any trailing partial line so providers that don't end with a
      // newline (e.g. a one-line `codex exec` reply, or stdin-mode echo
      // tests) still surface their output.
      if (lineBuf.length > 0) {
        const tail = lineBuf;
        const trimmed = tail.trim();
        lineBuf = '';
        if (trimmed.length > 0) {
          const classified = parser(trimmed);
          const emit = classified.kind === 'json' ? classified.text : tail;
          if (emit.length > 0) {
            stdout += emit;
            opts.onStdoutChunk?.(emit);
          }
        }
      }
      finish(code);
    });
  });
}
