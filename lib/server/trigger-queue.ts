import type { Workflow } from '../shared/workflow';
import type { ResolvedInputs } from '../shared/resolve-run-inputs';
import { eventBus } from './event-bus';

export interface QueuedRun {
  queueId: string;
  workflow: Workflow;
  resolvedInputs: ResolvedInputs;
  triggerId: string;
  receivedAt: number;
}

export interface TriggerQueueDeps {
  /** Returns the new run's id on success. Throws if the engine is busy. */
  engineStart: (wf: Workflow, opts: { resolvedInputs: ResolvedInputs }) => Promise<string>;
  /** Re-fetch the freshest workflow JSON by id. Used to detect deletions. */
  loadWorkflow: (id: string) => Promise<Workflow>;
  maxQueue?: number;
}

function isBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /run is already active|busy/i.test(err.message);
}

export class TriggerQueue {
  private q: QueuedRun[] = [];
  private nextId = 0;
  private draining = false;
  private engineStart: TriggerQueueDeps['engineStart'];
  private loadWorkflow: TriggerQueueDeps['loadWorkflow'];
  private maxQueue: number;

  constructor(deps: TriggerQueueDeps) {
    this.engineStart = deps.engineStart;
    this.loadWorkflow = deps.loadWorkflow;
    this.maxQueue = deps.maxQueue ?? 100;
  }

  size(): number { return this.q.length; }

  peek(): QueuedRun | undefined { return this.q[0]; }

  enqueue(item: Omit<QueuedRun, 'queueId'>): { queueId: string; position: number } {
    if (this.q.length >= this.maxQueue) {
      const err = new Error('trigger queue is full');
      (err as Error & { code?: string }).code = 'QUEUE_FULL';
      throw err;
    }
    const queueId = `q-${Date.now()}-${++this.nextId}`;
    const full: QueuedRun = { queueId, ...item };
    this.q.push(full);
    const position = this.q.length;
    eventBus.emit({
      type: 'trigger_enqueued',
      queueId,
      triggerId: full.triggerId,
      workflowId: full.workflow.id,
      position,
      receivedAt: full.receivedAt,
    });
    return { queueId, position };
  }

  /** Pull the head item and try to start it. If the engine is busy, re-prepend
   *  and bail. Continues until the queue is empty or the engine refuses. */
  async drain(): Promise<void> {
    if (this.draining) return;
    if (this.q.length === 0) return;
    this.draining = true;
    try {
      while (this.q.length > 0) {
        const head = this.q.shift()!;

        let workflow: Workflow;
        try {
          workflow = await this.loadWorkflow(head.workflow.id);
        } catch {
          eventBus.emit({
            type: 'trigger_dropped',
            queueId: head.queueId,
            triggerId: head.triggerId,
            reason: 'workflow-deleted',
          });
          continue;
        }

        try {
          const runId = await this.engineStart(workflow, {
            resolvedInputs: head.resolvedInputs,
          });
          eventBus.emit({
            type: 'trigger_started',
            queueId: head.queueId,
            triggerId: head.triggerId,
            workflowId: workflow.id,
            runId,
          });
        } catch (err) {
          if (isBusyError(err)) {
            this.q.unshift(head); // wait for next settle
            return;
          }
          eventBus.emit({
            type: 'trigger_dropped',
            queueId: head.queueId,
            triggerId: head.triggerId,
            reason: 'engine-start-failed',
          });
          console.error('[trigger-queue] engineStart failed:', err);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  clear(): void {
    this.q = [];
    this.draining = false;
  }
}
