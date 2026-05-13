import { TriggerQueue } from './trigger-queue';
import { workflowEngine } from './workflow-engine';
import { getWorkflow } from './workflow-store';
import { eventBus } from './event-bus';
import type { Workflow } from '../shared/workflow';
import type { ResolvedInputs } from '../shared/resolve-run-inputs';

// CONTRACT: workflowEngine.start() must assign snapshot.runId synchronously
// (before its first await). Verified in workflow-engine.ts as of 2026-05-13.
// Lines 129 and 143-150 of workflow-engine.ts set this.currentRunId and
// this.snapshot.runId synchronously; the first await is at line 182
// (walkFrom). The void-kick-and-read pattern below is therefore safe.
async function engineStartAdapter(
  wf: Workflow,
  opts: { resolvedInputs: ResolvedInputs },
): Promise<string> {
  // engine.start() flips status to 'running' and assigns currentRunId in its
  // first synchronous block before any await. Kick it off without awaiting,
  // then read the runId from the snapshot.
  void workflowEngine.start(wf, opts).catch((err) => {
    console.error('[trigger-queue] engine.start rejected later:', err);
  });
  const runId = workflowEngine.getState().runId;
  if (!runId) {
    throw new Error('engine.start did not assign a runId');
  }
  return runId;
}

function createSingleton(): TriggerQueue {
  const q = new TriggerQueue({
    engineStart: engineStartAdapter,
    loadWorkflow: getWorkflow,
    maxQueue: 100,
  });

  // Drain whenever a run settles.
  eventBus.subscribe((ev) => {
    if (ev.type === 'run_finished') {
      void q.drain();
    }
  });

  // Best-effort drain at module load in case items were enqueued during a
  // recent terminal-state transition. Safe — drain() is self-guarded.
  void q.drain();

  return q;
}

declare global {
  // eslint-disable-next-line no-var
  var __infloopTriggerQueue: TriggerQueue | undefined;
}

export const triggerQueue: TriggerQueue =
  globalThis.__infloopTriggerQueue ?? createSingleton();
if (!globalThis.__infloopTriggerQueue) {
  globalThis.__infloopTriggerQueue = triggerQueue;
}
