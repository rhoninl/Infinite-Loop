/** Trigger and webhook-plugin types. Moved out of workflow.ts in Dispatch v2 —
 *  triggers are now top-level entities with a `workflowId` pointer. */

export type TriggerPredicateOp = '==' | '!=' | 'contains' | 'matches';

export interface TriggerPredicate {
  lhs: string;
  op: TriggerPredicateOp;
  rhs: string;
}

/** Webhook trigger. Lives in `triggers/<id>.json`. URL: POST /api/webhook/<id>. */
export interface WebhookTrigger {
  id: string;
  name: string;
  enabled: boolean;
  /** Workflow this trigger fires. Validated against the workflow store on save. */
  workflowId: string;
  /** Plugin describing the webhook source. "generic" for free-form templating;
   *  "github" / other plugin ids drive schema-aware authoring. */
  pluginId: string;
  /** Required when the plugin has `eventHeader`; matched against headers[eventHeader]
   *  before user predicates. */
  eventType?: string;
  /** AND-joined predicates evaluated against the webhook scope. Empty = always fires. */
  match: TriggerPredicate[];
  /** Maps workflow input names to templated strings evaluated against the webhook scope. */
  inputs: Record<string, string>;
  /** Updated when a real (non-test) fire reaches the engine. UI-only. */
  lastFiredAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

/* ─── webhook plugins ─────────────────────────────────────────────────────── */

export type PluginFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface PluginField {
  /** Templating-resolvable dotted path, e.g. "body.issue.number". */
  path: string;
  type: PluginFieldType;
  description?: string;
}

export interface PluginEvent {
  /** Identifier the webhook source sends in `eventHeader` (when defined). */
  type: string;
  displayName: string;
  fields: PluginField[];
  /** Sample payload used by the Test-fire modal's "Pre-fill" button. */
  examplePayload?: unknown;
}

export interface WebhookPlugin {
  id: string;
  displayName: string;
  icon?: string;
  /** Header whose value selects which `events[i]` to match. When set, the webhook
   *  route requires `headers[eventHeader] == trigger.eventType` before evaluating
   *  user predicates. When unset (Generic), no implicit filter. */
  eventHeader?: string;
  events: PluginEvent[];
}
