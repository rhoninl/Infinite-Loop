import type { InflooopClient } from './inflooop-client';
import { filterOutputs } from './filter-outputs';

export async function getRunStatus(
  client: InflooopClient,
  args: { workflowId: string; runId: string },
): Promise<{
  status: string;
  runId?: string;
  durationMs?: number;
  outputs?: Record<string, unknown>;
  errorMessage?: string;
  error?: string;
}> {
  const r = await client.getRun(args.workflowId, args.runId);
  if (!r.ok) {
    if (r.kind === 'not-found') {
      return { status: 'error', error: `Run ${args.runId} not found.` };
    }
    if (r.kind === 'unauthorized') {
      return { status: 'error', error: 'Unauthorized — check INFLOOP_API_TOKEN.' };
    }
    return { status: 'error', error: `HTTP error fetching run.` };
  }
  const run = r.run;
  return {
    status: run.status,
    runId: run.runId,
    durationMs:
      run.finishedAt != null && run.startedAt != null
        ? run.finishedAt - run.startedAt
        : undefined,
    outputs: filterOutputs(run.scope),
    errorMessage: run.errorMessage,
  };
}

export async function listRuns(
  client: InflooopClient,
  args: { workflowId?: string },
): Promise<{ runs?: unknown[] }> {
  const out = (await client.listRuns(args.workflowId)) as { runs?: unknown[] };
  return { runs: out.runs };
}

export async function cancelRun(
  client: InflooopClient,
  args: { workflowId: string; runId: string },
): Promise<{ cancelled: boolean; reason?: string }> {
  const polled = await client.getRun(args.workflowId, args.runId);
  if (!polled.ok) {
    return {
      cancelled: false,
      reason:
        polled.kind === 'not-found'
          ? `Run ${args.runId} is no longer tracked by the engine.`
          : `Could not check run status (${polled.kind}).`,
    };
  }
  if (polled.run.status !== 'running') {
    return {
      cancelled: false,
      reason: `Run already settled with status "${polled.run.status}".`,
    };
  }
  const stop = await client.cancelRun();
  if (!stop.ok) {
    return { cancelled: false, reason: `Stop call failed (${stop.kind}).` };
  }
  return { cancelled: true };
}
