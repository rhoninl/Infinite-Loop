import { TriggerQueue } from './trigger-queue';
import { workflowEngine, type WorkflowEngine } from './workflow-engine';
import { getWorkflow } from './workflow-store';
import { touchLastFired } from './trigger-store';
import { eventBus } from './event-bus';
// Side-effect: register the queueHistory event-bus subscription at the same
// point the queue itself is wired, so history mirrors every queue event
// regardless of which entry point (MCP route, webhook, /api/triggers, …)
// happens to load the queue first.
import './queue-history';
import type { Workflow } from '../shared/workflow';
import type { ResolvedInputs } from '../shared/resolve-run-inputs';

// CONTRACT: workflowEngine.start() must assign snapshot.runId synchronously
// (before its first await). Verified in workflow-engine.ts as of 2026-05-13.
// Lines 129 and 143-150 of workflow-engine.ts set this.currentRunId and
// this.snapshot.runId synchronously; the first await is at line 182
// (walkFrom). The void-kick-and-read pattern below is therefore safe on the
// happy path.
//
// The busy path is NOT safe with void-kick alone: start() rejects
// synchronously BEFORE assigning a new runId (line 116-117), the void's
// .catch() swallows the rejection, and the subsequent getState().runId
// returns the in-flight run's runId. drain() would then think the start
// succeeded and silently drop the queued item. Pre-check the busy state
// here and throw a busy-shaped error so drain() re-prepends and waits.
export async function engineStartAdapter(
  engine: WorkflowEngine,
  wf: Workflow,
  opts: { resolvedInputs: ResolvedInputs },
): Promise<string> {
  if (engine.getState().status === 'running') {
    throw new Error('a run is already active');
  }
  // engine.start() flips status to 'running' and assigns currentRunId in its
  // first synchronous block before any await. Kick it off without awaiting,
  // then read the runId from the snapshot.
  void engine.start(wf, opts).catch((err) => {
    console.error('[trigger-queue] engine.start rejected later:', err);
  });
  const runId = engine.getState().runId;
  if (!runId) {
    throw new Error('engine.start did not assign a runId');
  }
  return runId;
}

function createSingleton(): TriggerQueue {
  const q = new TriggerQueue({
    engineStart: (wf, opts) => engineStartAdapter(workflowEngine, wf, opts),
    loadWorkflow: getWorkflow,
    touchLastFired: (id) => touchLastFired(id),
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
