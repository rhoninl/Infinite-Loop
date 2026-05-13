import { getWorkflow } from '@/lib/server/workflow-store';
import {
  resolveRunInputs,
  WorkflowInputError,
} from '@/lib/shared/resolve-run-inputs';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

export interface EnqueueToolOptions {
  workflowId: string;
  inputs: Record<string, unknown>;
}

export type EnqueueToolResult =
  | {
      status: 'queued';
      queueId: string;
      position: number;
      workflowId: string;
      triggerId: string;
    }
  | { status: 'error'; error: string };

function syntheticTriggerId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `mcp_${ts}_${rand}`;
}

export async function enqueueWorkflowTool(
  opts: EnqueueToolOptions,
): Promise<EnqueueToolResult> {
  let workflow;
  try {
    workflow = await getWorkflow(opts.workflowId);
  } catch {
    return {
      status: 'error',
      error: `Workflow "${opts.workflowId}" not found.`,
    };
  }

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

  const triggerId = syntheticTriggerId();

  let result;
  try {
    result = triggerQueue.enqueue({
      workflow,
      resolvedInputs,
      triggerId,
      receivedAt: Date.now(),
    });
  } catch (err) {
    if ((err as Error & { code?: string }).code === 'QUEUE_FULL') {
      return { status: 'error', error: 'Trigger queue is full. Try again later.' };
    }
    return {
      status: 'error',
      error: `Enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Kick the drain. drain() is self-guarded and a no-op while the engine is
  // busy; otherwise it will start the head item.
  void triggerQueue.drain();

  return {
    status: 'queued',
    queueId: result.queueId,
    position: result.position,
    workflowId: workflow.id,
    triggerId,
  };
}
