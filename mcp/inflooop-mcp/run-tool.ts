import type { InflooopClient, PersistedRun } from './inflooop-client';
import { filterOutputs } from './filter-outputs';

export interface RunToolOptions {
  workflowId: string;
  inputs: Record<string, unknown>;
  pollIntervalMs: number;
  timeoutMs: number;
}

export interface RunToolResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'timeout' | 'error';
  runId?: string;
  durationMs?: number;
  outputs?: Record<string, unknown>;
  errorMessage?: string;
  error?: string;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function jitter(baseMs: number): number {
  // ±20% jitter so concurrent MCP servers don't lock-step the API.
  const delta = baseMs * 0.4 * (Math.random() - 0.5);
  return Math.max(50, Math.round(baseMs + delta));
}

export async function runWorkflowTool(
  client: InflooopClient,
  opts: RunToolOptions,
): Promise<RunToolResult> {
  const start = await client.startRun(opts.workflowId, opts.inputs);
  if (!start.ok) {
    if (start.kind === 'busy') {
      return {
        status: 'error',
        error:
          `InfLoop engine is busy with another run` +
          (start.runId ? ` (runId=${start.runId}, workflowId=${start.workflowId ?? '?'})` : '') +
          `. Use inflooop_get_run_status to track it, or retry later.`,
      };
    }
    if (start.kind === 'invalid-inputs') {
      return {
        status: 'error',
        error: `Invalid input "${start.field ?? '?'}": ${start.reason ?? 'rejected'}`,
      };
    }
    if (start.kind === 'not-found') {
      return {
        status: 'error',
        error:
          `Workflow "${opts.workflowId}" not found. ` +
          `If you added it recently, restart the MCP server to refresh.`,
      };
    }
    if (start.kind === 'unauthorized') {
      return { status: 'error', error: 'Unauthorized — check INFLOOP_API_TOKEN.' };
    }
    return {
      status: 'error',
      error: `HTTP ${start.status}: ${start.message}`,
    };
  }

  const runId = start.runId;
  const deadline = Date.now() + opts.timeoutMs;

  while (true) {
    const polled = await client.getRun(opts.workflowId, runId);
    if (!polled.ok) {
      // 404 here means the engine has moved on (started a new run, or
      // restarted). We intentionally do NOT retry — bounded latency
      // matters more than catching transient races, and the user can
      // re-invoke the tool to start a fresh run.
      return {
        status: 'error',
        runId,
        error:
          polled.kind === 'not-found'
            ? `Run ${runId} no longer tracked (engine may have restarted).`
            : polled.kind === 'unauthorized'
              ? 'Unauthorized — check INFLOOP_API_TOKEN.'
              : `HTTP error fetching run status.`,
      };
    }

    const run: PersistedRun = polled.run;
    if (TERMINAL.has(run.status)) {
      return {
        status: run.status as 'succeeded' | 'failed' | 'cancelled',
        runId,
        durationMs:
          run.finishedAt != null && run.startedAt != null
            ? run.finishedAt - run.startedAt
            : undefined,
        outputs: filterOutputs(run.scope),
        errorMessage: run.errorMessage,
      };
    }

    if (Date.now() >= deadline) break;
    await new Promise((res) => setTimeout(res, jitter(opts.pollIntervalMs)));
  }

  return {
    status: 'timeout',
    runId,
    error:
      `Run did not settle within ${opts.timeoutMs}ms. ` +
      `Use inflooop_get_run_status with runId=${runId} to check later.`,
  };
}
