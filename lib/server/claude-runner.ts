import { spawn } from 'node:child_process';
import type { RunnerOptions, RunnerResult } from '../shared/types';

const SIGKILL_GRACE_MS = 2000;

/**
 * Try to interpret a line as a claude stream-json event and pull the
 * human-readable text out of it. Returns:
 *   - `null` if the line parses as a known structural event with no text
 *     content we care about (message_start, system init, tool_use, etc.).
 *   - `''` for the same.
 *   - the extracted text otherwise.
 *
 * Returns the parse outcome via discriminator so the caller can fall back
 * to "emit the raw line + newline" for non-JSON output (e.g. test fixtures
 * that don't speak stream-json).
 */
type StreamLineResult =
  | { kind: 'json'; text: string }
  | { kind: 'plain' };

function classifyStreamLine(line: string): StreamLineResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'plain' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'plain' };
  const obj = parsed as Record<string, unknown>;

  // Anthropic Messages API streaming events:
  //   {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
  if (obj.type === 'content_block_delta') {
    const delta = obj.delta as Record<string, unknown> | undefined;
    if (delta && delta.type === 'text_delta' && typeof delta.text === 'string') {
      return { kind: 'json', text: delta.text };
    }
    return { kind: 'json', text: '' };
  }

  // claude's wrapper "stream_event" shape:
  //   {"type":"stream_event","event":{<inner anthropic event>}}
  if (obj.type === 'stream_event' && obj.event && typeof obj.event === 'object') {
    const inner = classifyStreamLine(JSON.stringify(obj.event));
    return inner.kind === 'json' ? inner : { kind: 'json', text: '' };
  }

  // A complete assistant message:
  //   {"type":"assistant","message":{"content":[{"type":"text","text":"…"}]}}
  if (obj.type === 'assistant' || obj.type === 'message') {
    const msg = (obj.message as Record<string, unknown> | undefined) ?? obj;
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const parts = content
        .filter(
          (c): c is { type: string; text: string } =>
            !!c &&
            typeof c === 'object' &&
            (c as { type?: unknown }).type === 'text' &&
            typeof (c as { text?: unknown }).text === 'string',
        )
        .map((c) => c.text);
      if (parts.length > 0) return { kind: 'json', text: parts.join('') };
    }
    return { kind: 'json', text: '' };
  }

  // Any other recognised JSON structural event — drop silently.
  return { kind: 'json', text: '' };
}

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
    //
    // --output-format=stream-json + --include-partial-messages makes claude
    // emit one JSON-line event per token/delta as it generates, instead of
    // block-buffering the whole response and dumping it at flush time. We
    // parse those events into plain text below so the consumer (Condition
    // sentinel matching, the human-readable RunView log) sees a clean text
    // stream while everything stays live.
    const child = spawn(
      bin,
      [
        '--print',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        opts.prompt,
      ],
      {
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );

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
      lineBuf += chunk;
      let nl: number;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const lineWithNl = lineBuf.slice(0, nl + 1);
        const lineTrimmed = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (lineTrimmed.length === 0) continue;

        const classified = classifyStreamLine(lineTrimmed);
        let emit = '';
        if (classified.kind === 'json') {
          // Real claude stream-json: emit only the text deltas; structural
          // events (message_start, content_block_start, ...) are silenced
          // so the user-facing stdout is just the assistant's prose.
          emit = classified.text;
        } else {
          // Not JSON (e.g. fake-claude in tests, or stderr accidentally
          // routed to stdout): surface the line as-is, preserving its
          // newline so downstream sentinel matchers see the original shape.
          emit = lineWithNl;
        }
        if (emit.length > 0) {
          stdout += emit;
          opts.onStdoutChunk?.(emit);
        }
      }
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
