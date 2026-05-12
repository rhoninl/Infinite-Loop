import { getRun, listRuns as storeListRuns } from '@/lib/server/run-store';
import { workflowEngine } from '@/lib/server/workflow-engine';
import { filterOutputs } from './filter-outputs';

export async function getRunStatus(args: {
  workflowId: string;
  runId: string;
}): Promise<{
  status: string;
  runId?: string;
  durationMs?: number;
  outputs?: Record<string, unknown>;
  errorMessage?: string;
  error?: string;
}> {
  // Try the persisted run store first; fall through to engine snapshot.
  try {
    const run = await getRun(args.workflowId, args.runId);
    return {
      status: run.status,
      runId: run.runId,
      durationMs: run.durationMs,
      outputs: filterOutputs(run.scope as Record<string, unknown>),
      errorMessage: run.errorMessage,
    };
  } catch {
    // Not in the store — check engine snapshot.
  }

  const snap = workflowEngine.getState();
  if (snap.runId === args.runId && snap.workflowId === args.workflowId) {
    return {
      status: snap.status,
      runId: snap.runId,
      durationMs:
        snap.finishedAt != null && snap.startedAt != null
          ? snap.finishedAt - snap.startedAt
          : undefined,
      outputs: filterOutputs(snap.scope as Record<string, unknown>),
      errorMessage: snap.errorMessage,
    };
  }

  return { status: 'error', error: `Run ${args.runId} not found.` };
}

export async function listRuns(args: {
  workflowId?: string;
}): Promise<{ runs: unknown[] }> {
  const runs = await storeListRuns(args.workflowId);
  return { runs };
}

export async function cancelRun(args: {
  workflowId: string;
  runId: string;
}): Promise<{ cancelled: boolean; reason?: string }> {
  const snap = workflowEngine.getState();

  if (snap.status !== 'running') {
    return { cancelled: false, reason: `No run is active.` };
  }
  if (snap.runId !== args.runId) {
    return {
      cancelled: false,
      reason: `Run ${args.runId} is no longer tracked by the engine.`,
    };
  }

  workflowEngine.stop();
  return { cancelled: true };
}
