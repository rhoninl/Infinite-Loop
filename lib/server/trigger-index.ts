import type { WebhookTrigger, Workflow } from '../shared/workflow';
import { listWorkflows, getWorkflow } from './workflow-store';

export interface TriggerIndexHit {
  workflowId: string;
  trigger: WebhookTrigger;
}

/** In-memory index of all webhook trigger ids across the workflow store.
 *
 *  Built lazily on first lookup; served from cache until `invalidate()` is
 *  called. `workflow-store` calls `invalidate()` on every save/delete.
 *
 *  Pinned to globalThis the same way event-bus does so Next.js dev mode
 *  (HMR) doesn't produce duplicate caches. */
class TriggerIndex {
  private cache: Map<string, TriggerIndexHit> | null = null;
  private building: Promise<Map<string, TriggerIndexHit>> | null = null;

  async lookup(id: string): Promise<TriggerIndexHit | undefined> {
    const map = await this.ensure();
    return map.get(id);
  }

  invalidate(): void {
    this.cache = null;
    this.building = null;
  }

  private async ensure(): Promise<Map<string, TriggerIndexHit>> {
    if (this.cache) return this.cache;
    if (this.building) return this.building;

    this.building = (async () => {
      const summaries = await listWorkflows();
      const map = new Map<string, TriggerIndexHit>();
      for (const summary of summaries) {
        let wf: Workflow;
        try {
          wf = await getWorkflow(summary.id);
        } catch {
          continue;
        }
        for (const t of wf.triggers ?? []) {
          if (!map.has(t.id)) map.set(t.id, { workflowId: wf.id, trigger: t });
        }
      }
      this.cache = map;
      this.building = null;
      return map;
    })();

    return this.building;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __infloopTriggerIndex: TriggerIndex | undefined;
}

export const triggerIndex: TriggerIndex =
  globalThis.__infloopTriggerIndex ?? new TriggerIndex();
if (!globalThis.__infloopTriggerIndex) {
  globalThis.__infloopTriggerIndex = triggerIndex;
}
