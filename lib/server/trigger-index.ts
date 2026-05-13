import type { WebhookTrigger } from '../shared/trigger';
import { listTriggers } from './trigger-store';

export interface TriggerIndexHit {
  workflowId: string;
  trigger: WebhookTrigger;
}

/** In-memory index over `trigger-store.listTriggers()`. Built lazily on first
 *  lookup; trigger-store calls `invalidate()` on every save/delete. */
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
      const all = await listTriggers();
      const map = new Map<string, TriggerIndexHit>();
      for (const t of all) {
        if (!map.has(t.id)) {
          map.set(t.id, { workflowId: t.workflowId, trigger: t });
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
