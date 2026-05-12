import { eventBus } from '@/lib/server/event-bus';
import { getRun } from '@/lib/server/run-store';
import { workflowEngine } from '@/lib/server/workflow-engine';
import { getWorkflow } from '@/lib/server/workflow-store';
import {
  resolveRunInputs,
  WorkflowInputError,
} from '@/lib/shared/resolve-run-inputs';
import type { RunFinishedEvent } from '@/lib/shared/workflow';
import { filterOutputs } from './filter-outputs';

export interface RunToolOptions {
  workflowId: string;
  inputs: Record<string, unknown>;
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

export async function runWorkflowTool(opts: RunToolOptions): Promise<RunToolResult> {
  // Load workflow.
  let workflow;
  try {
    workflow = await getWorkflow(opts.workflowId);
  } catch {
    return {
      status: 'error',
      error: `Workflow "${opts.workflowId}" not found.`,
    };
  }

  // Validate inputs.
  let resolvedInputs;
  try {
    resolvedInputs = resolveRunInputs(workflow.inputs ?? [], opts.inputs);
  } catch (err) {
    if (err instanceof WorkflowInputError) {
      return {
        status: 'error',
        error: `Invalid input "${err.field}": ${err.reason}`,
      };
    }
    return {
      status: 'error',
      error: `Input validation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Check if the engine is busy.
  const currentState = workflowEngine.getState();
  if (currentState.status === 'running') {
    return {
      status: 'error',
      error:
        `InfLoop engine is busy with another run` +
        (currentState.runId
          ? ` (runId=${currentState.runId}, workflowId=${currentState.workflowId ?? '?'})`
          : '') +
        `. Use inflooop_get_run_status to track it, or retry later.`,
    };
  }

  // Subscribe to the run_finished event BEFORE starting.
  let settleResolve!: (ev: RunFinishedEvent) => void;
  const settlePromise = new Promise<RunFinishedEvent>((resolve) => {
    settleResolve = resolve;
  });

  const unsub = eventBus.subscribe((ev) => {
    if (ev.type === 'run_finished') {
      settleResolve(ev as RunFinishedEvent);
    }
  });

  // Kick off the run without awaiting.
  void workflowEngine.start(workflow, { resolvedInputs }).catch((err) => {
    console.error('[mcp/run-tool] engine.start failed:', err);
  });

  // Read the runId synchronously from the snapshot — start() writes it before
  // any await inside the engine.
  const snapshot = workflowEngine.getState();
  const runId = snapshot.runId;

  if (!runId) {
    unsub();
    return { status: 'error', error: 'Engine did not produce a runId.' };
  }

  // Race between settle and timeout.
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), opts.timeoutMs),
  );

  const settled = await Promise.race([settlePromise, timeoutPromise]);
  unsub();

  if (settled === null) {
    // Timeout — run still going; caller can poll.
    return {
      status: 'timeout',
      runId,
      error:
        `Run did not settle within ${opts.timeoutMs}ms. ` +
        `Use inflooop_get_run_status with runId=${runId} to check later.`,
    };
  }

  // Run settled. Try to get the persisted record (may still be async-writing);
  // fall back to the settle event's scope if not persisted yet.
  try {
    const record = await getRun(opts.workflowId, runId);
    return {
      status: record.status,
      runId,
      durationMs: record.durationMs,
      outputs: filterOutputs(record.scope),
      errorMessage: record.errorMessage,
    };
  } catch {
    // Not persisted yet — use the settle event payload.
    const finishedSnap = workflowEngine.getState();
    const durationMs =
      finishedSnap.finishedAt != null && finishedSnap.startedAt != null
        ? finishedSnap.finishedAt - finishedSnap.startedAt
        : undefined;
    return {
      status: settled.status,
      runId,
      durationMs,
      outputs: filterOutputs(settled.scope),
      errorMessage: finishedSnap.errorMessage,
    };
  }
}
