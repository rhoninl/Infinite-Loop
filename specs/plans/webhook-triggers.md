# Webhook Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic webhook ingress so each workflow can be triggered by an HTTP POST to a per-trigger unguessable URL, with Branch-style predicate matching, templated input mapping, and an in-memory FIFO queue.

**Architecture:** A new `triggers[]` array on `Workflow` declares one or more webhook triggers. A new route `POST /api/webhook/[triggerId]` looks the trigger up via an in-memory index, evaluates AND-joined predicates against `{headers, query, body}`, resolves templated `inputs` into the workflow's declared inputs, then enqueues the run on a new singleton `triggerQueue`. The queue drains by subscribing to engine terminal events. A read-only UI panel lists triggers per workflow with their URLs and last-fired-at; a top-bar badge shows queue depth.

**Tech Stack:** TypeScript on Bun, Next.js 15 App Router, HeroUI components, `bun:test`. No new runtime dependencies.

**Reference spec:** `specs/webhook-trigger.md`

---

## File Structure

**New files:**
- `lib/server/predicate.ts` — shared `lhs op rhs` evaluator, extracted from Branch
- `lib/server/predicate.test.ts`
- `lib/server/webhook-scope.ts` — turns an HTTP request into a `Scope` for templating
- `lib/server/webhook-scope.test.ts`
- `lib/server/trigger-index.ts` — in-memory `triggerId → {workflowId, trigger}` map with on-demand rebuild
- `lib/server/trigger-index.test.ts`
- `lib/server/trigger-queue.ts` — FIFO queue singleton
- `lib/server/trigger-queue.test.ts`
- `app/api/webhook/[triggerId]/route.ts`
- `app/api/webhook/[triggerId]/route.test.ts`
- `app/api/triggers/queue/route.ts`
- `app/api/triggers/queue/route.test.ts`
- `app/components/TriggersPanel.tsx`
- `app/components/TriggersPanel.test.tsx`
- `app/components/QueueBadge.tsx`
- `app/components/QueueBadge.test.tsx`

**Modified files:**
- `lib/shared/workflow.ts` — add `WebhookTrigger`, `TriggerPredicate`, `Workflow.triggers?`, new `WorkflowEvent` variants
- `lib/server/nodes/branch.ts` — delegate to `lib/server/predicate.ts`
- `lib/server/workflow-store.ts` — validate `triggers[]` field; reject cross-workflow `triggerId` collisions; invalidate trigger index on save/delete
- `lib/server/workflow-engine.ts` — emit `trigger_started` when starting a queued run; expose a hook the queue can subscribe to (or simply listen for `run_finished` on the event bus)
- `app/components/ConfigPanel.tsx` — render `<TriggersPanel>` when the workflow root is selected (or wherever existing workflow-level settings live)
- `app/page.tsx` — mount `<QueueBadge>` in the top bar
- `README.md` — document the webhook endpoint

---

### Task 1: Add trigger types to the workflow contract

**Files:**
- Modify: `lib/shared/workflow.ts` (append before `Workflow` interface)

- [ ] **Step 1: Add type declarations**

Add the following exports to `lib/shared/workflow.ts`, immediately after the existing `BranchConfig` block (around line 102):

```ts
/** Trigger predicate. Same `lhs op rhs` shape as Branch; both sides are
 *  templated against the webhook scope. */
export type TriggerPredicateOp = BranchOp;

export interface TriggerPredicate {
  lhs: string;
  op: TriggerPredicateOp;
  rhs: string;
}

/** Webhook trigger attached to a workflow. The `id` appears verbatim in the
 *  URL: POST /api/webhook/<id>. The id IS the auth token. */
export interface WebhookTrigger {
  id: string;
  name: string;
  enabled: boolean;
  /** AND-joined; empty array = always fires. */
  match: TriggerPredicate[];
  /** Maps workflow input names to templated strings evaluated against the
   *  webhook scope `{headers, query, body}`. Inputs not listed fall back to
   *  the workflow input's `default`. */
  inputs: Record<string, string>;
  /** Epoch ms; updated when the trigger most recently fired a run. */
  lastFiredAt?: number | null;
}
```

Add `triggers?: WebhookTrigger[]` to the `Workflow` interface (after `inputs?`):

```ts
export interface Workflow {
  // …existing fields…
  inputs?: WorkflowInputDecl[];
  /** Webhook triggers. Each declares a URL-shaped id, AND-joined predicates,
   *  and templated input mappings. See specs/webhook-trigger.md. */
  triggers?: WebhookTrigger[];
}
```

- [ ] **Step 2: Add new event variants**

In the same file, immediately before the `WorkflowEvent` union (around line 367), add three interfaces:

```ts
export interface TriggerEnqueuedEvent {
  type: 'trigger_enqueued';
  queueId: string;
  triggerId: string;
  workflowId: string;
  position: number;
  receivedAt: number;
}

export interface TriggerStartedEvent {
  type: 'trigger_started';
  queueId: string;
  triggerId: string;
  workflowId: string;
  runId: string;
}

export interface TriggerDroppedEvent {
  type: 'trigger_dropped';
  queueId: string;
  triggerId: string;
  reason: 'workflow-deleted' | 'queue-full' | 'engine-start-failed';
}
```

Extend the `WorkflowEvent` union to include all three:

```ts
export type WorkflowEvent =
  | RunStartedEvent
  | NodeStartedEvent
  | NodeFinishedEvent
  | StdoutChunkEvent
  | ConditionCheckedEvent
  | TemplateWarningEvent
  | ErrorEvent
  | RunFinishedEvent
  | TriggerEnqueuedEvent
  | TriggerStartedEvent
  | TriggerDroppedEvent;
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no usage of new types yet, no errors).

- [ ] **Step 4: Commit**

```bash
git add lib/shared/workflow.ts
git commit -m "types: WebhookTrigger + trigger_* events"
```

---

### Task 2: Extract predicate evaluator from Branch into a shared helper

**Files:**
- Create: `lib/server/predicate.ts`
- Create: `lib/server/predicate.test.ts`
- Modify: `lib/server/nodes/branch.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/server/predicate.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { evaluatePredicate } from './predicate';

describe('evaluatePredicate', () => {
  test('== matches identical strings', () => {
    expect(evaluatePredicate({ lhs: 'push', op: '==', rhs: 'push' }))
      .toEqual({ ok: true, result: true });
  });

  test('!= negates equality', () => {
    expect(evaluatePredicate({ lhs: 'a', op: '!=', rhs: 'b' }))
      .toEqual({ ok: true, result: true });
  });

  test('contains is a substring check', () => {
    expect(evaluatePredicate({ lhs: 'refs/heads/main', op: 'contains', rhs: 'main' }))
      .toEqual({ ok: true, result: true });
  });

  test('matches treats rhs as a regex', () => {
    expect(evaluatePredicate({ lhs: 'v1.2.3', op: 'matches', rhs: '^v\\d+\\.\\d+\\.\\d+$' }))
      .toEqual({ ok: true, result: true });
  });

  test('matches returns ok:false on invalid regex', () => {
    const v = evaluatePredicate({ lhs: 'x', op: 'matches', rhs: '[' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/invalid regex/);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test lib/server/predicate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

Create `lib/server/predicate.ts`:

```ts
import type { BranchOp } from '../shared/workflow';

export interface Predicate {
  lhs: string;
  op: BranchOp;
  rhs: string;
}

export type PredicateVerdict =
  | { ok: true; result: boolean }
  | { ok: false; error: string };

export function evaluatePredicate(p: Predicate): PredicateVerdict {
  switch (p.op) {
    case '==':
      return { ok: true, result: p.lhs === p.rhs };
    case '!=':
      return { ok: true, result: p.lhs !== p.rhs };
    case 'contains':
      return { ok: true, result: p.lhs.includes(p.rhs) };
    case 'matches':
      try {
        return { ok: true, result: new RegExp(p.rhs).test(p.lhs) };
      } catch (err) {
        return { ok: false, error: `invalid regex: ${(err as Error).message}` };
      }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/server/predicate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor branch.ts to use the helper**

Replace the body of `lib/server/nodes/branch.ts` with:

```ts
import { evaluatePredicate } from '../predicate';
import type {
  BranchConfig,
  NodeExecutor,
  NodeExecutorContext,
  NodeExecutorResult,
} from '../../shared/workflow';

function isBranchConfig(v: unknown): v is BranchConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as { lhs?: unknown; op?: unknown; rhs?: unknown };
  return (
    typeof c.lhs === 'string' &&
    typeof c.rhs === 'string' &&
    (c.op === '==' || c.op === '!=' || c.op === 'contains' || c.op === 'matches')
  );
}

export const branchExecutor: NodeExecutor = {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const cfg = ctx.config;
    if (!isBranchConfig(cfg)) {
      return { outputs: { error: 'invalid branch config' }, branch: 'error' };
    }
    const verdict = evaluatePredicate(cfg);
    if (!verdict.ok) {
      return {
        outputs: { error: verdict.error, lhs: cfg.lhs, rhs: cfg.rhs, op: cfg.op },
        branch: 'error',
      };
    }
    return {
      outputs: { result: verdict.result, lhs: cfg.lhs, rhs: cfg.rhs, op: cfg.op },
      branch: verdict.result ? 'true' : 'false',
    };
  },
};
```

- [ ] **Step 6: Run existing branch tests**

Run: `bun test lib/server/nodes/branch.test.ts 2>/dev/null || bun test --filter branch`
Expected: PASS (no behavior changes). If the file doesn't exist, run `bun test` to check nothing else broke.

- [ ] **Step 7: Commit**

```bash
git add lib/server/predicate.ts lib/server/predicate.test.ts lib/server/nodes/branch.ts
git commit -m "refactor: extract predicate evaluator from Branch node"
```

---

### Task 3: Build the webhook scope from a request

**Files:**
- Create: `lib/server/webhook-scope.ts`
- Create: `lib/server/webhook-scope.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/server/webhook-scope.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildWebhookScope } from './webhook-scope';

describe('buildWebhookScope', () => {
  test('lowercases header names', () => {
    const headers = new Headers({ 'X-Custom': 'value' });
    const scope = buildWebhookScope({ headers, url: 'http://x/', bodyText: '{}' });
    expect(scope.headers['x-custom']).toBe('value');
  });

  test('joins multi-value headers with comma', () => {
    const headers = new Headers();
    headers.append('x-multi', 'a');
    headers.append('x-multi', 'b');
    const scope = buildWebhookScope({ headers, url: 'http://x/', bodyText: '' });
    expect(scope.headers['x-multi']).toBe('a, b');
  });

  test('parses JSON body into nested scope', () => {
    const body = JSON.stringify({ ref: 'refs/heads/main', commits: [{ id: 'sha1' }] });
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/',
      bodyText: body,
    });
    expect(scope.body.ref).toBe('refs/heads/main');
    // arrays are walked by numeric string keys via the templating resolver
    expect((scope.body.commits as Array<{ id: string }>)[0].id).toBe('sha1');
  });

  test('non-JSON body surfaces as body.raw', () => {
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/',
      bodyText: 'plain text',
    });
    expect(scope.body.raw).toBe('plain text');
  });

  test('query parameters parsed into scope.query', () => {
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/?from=github&since=2026-01-01',
      bodyText: '{}',
    });
    expect(scope.query.from).toBe('github');
    expect(scope.query.since).toBe('2026-01-01');
  });

  test('empty bodyText yields empty body record', () => {
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/',
      bodyText: '',
    });
    expect(scope.body).toEqual({});
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test lib/server/webhook-scope.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/server/webhook-scope.ts`:

```ts
import type { Scope } from '../shared/workflow';

export interface WebhookScopeInput {
  headers: Headers;
  url: string;
  bodyText: string;
}

/** Build a templating scope from an HTTP request's parts.
 *
 *  - `headers` keys are lowercased; multi-value headers are joined with ", "
 *    (matches Node's `Headers#get` semantics).
 *  - `query` is parsed from the URL.
 *  - `body` is JSON.parse'd. If the body is empty, `body` is `{}`. If the body
 *    is non-JSON, `body` is `{ raw: <text> }`. If JSON parse yields a non-object
 *    (string/number/array at top level), the value lives under `body.value` and
 *    arrays are also accessible as `body.0`, `body.1`, ... (handled by spreading
 *    array indices as string keys onto the body record).
 *
 *  The templating resolver walks dotted paths through nested records natively,
 *  so `{{body.commits.0.id}}` works for JSON object bodies without a flatten
 *  helper. */
export function buildWebhookScope(input: WebhookScopeInput): Scope {
  const headers: Record<string, string> = {};
  for (const [name, value] of input.headers.entries()) {
    // The Headers iterator already lowercases names and joins multi-value
    // entries with ", " (Fetch spec). We just copy.
    headers[name.toLowerCase()] = value;
  }

  const url = new URL(input.url);
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    query[k] = v;
  }

  let body: Record<string, unknown> = {};
  if (input.bodyText.length > 0) {
    try {
      const parsed: unknown = JSON.parse(input.bodyText);
      if (parsed === null) {
        body = {};
      } else if (Array.isArray(parsed)) {
        // Preserve array shape for nested walks (parsed[0].x), and ALSO expose
        // numeric-string keys at the top level for {{body.0.x}}.
        body = { ...(parsed as unknown as Record<string, unknown>) };
      } else if (typeof parsed === 'object') {
        body = parsed as Record<string, unknown>;
      } else {
        body = { value: parsed };
      }
    } catch {
      body = { raw: input.bodyText };
    }
  }

  return { headers, query, body } as Scope;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/server/webhook-scope.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/webhook-scope.ts lib/server/webhook-scope.test.ts
git commit -m "feat: webhook scope builder from HTTP request"
```

---

### Task 4: Trigger index — fast lookup of triggerId across all workflows

**Files:**
- Create: `lib/server/trigger-index.ts`
- Create: `lib/server/trigger-index.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/server/trigger-index.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { triggerIndex } from './trigger-index';

const tmpDir = path.join(os.tmpdir(), `infloop-trigger-index-${process.pid}`);

async function writeWorkflow(id: string, triggers: unknown[] = []) {
  const file = path.join(tmpDir, `${id}.json`);
  await fs.writeFile(
    file,
    JSON.stringify({
      id,
      name: id,
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      triggers,
    }),
  );
}

beforeEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpDir;
  triggerIndex.invalidate();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('triggerIndex', () => {
  test('returns undefined for unknown id', async () => {
    expect(await triggerIndex.lookup('absent')).toBeUndefined();
  });

  test('finds a trigger by id', async () => {
    await writeWorkflow('wf-a', [
      { id: 'abc123abc123abc123', name: 't1', enabled: true, match: [], inputs: {} },
    ]);
    const hit = await triggerIndex.lookup('abc123abc123abc123');
    expect(hit?.workflowId).toBe('wf-a');
    expect(hit?.trigger.name).toBe('t1');
  });

  test('invalidate forces a re-scan', async () => {
    await writeWorkflow('wf-a', [
      { id: 'idA1234567890abcdef', name: 't', enabled: true, match: [], inputs: {} },
    ]);
    await triggerIndex.lookup('idA1234567890abcdef'); // primes
    await writeWorkflow('wf-a', []); // remove trigger
    triggerIndex.invalidate();
    expect(await triggerIndex.lookup('idA1234567890abcdef')).toBeUndefined();
  });

  test('handles a workflow with no triggers field', async () => {
    await writeWorkflow('wf-a'); // no triggers key
    expect(await triggerIndex.lookup('anything')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test lib/server/trigger-index.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/server/trigger-index.ts`:

```ts
import type { WebhookTrigger, Workflow } from '../shared/workflow';
import { listWorkflows, getWorkflow } from './workflow-store';

export interface TriggerIndexHit {
  workflowId: string;
  trigger: WebhookTrigger;
}

/** In-memory index of all webhook trigger ids across the workflow store.
 *
 *  Built lazily on first lookup, then served from cache until `invalidate()` is
 *  called. `workflow-store` calls `invalidate()` on every save and delete (see
 *  the workflow-store task).
 *
 *  This is a singleton because Next.js dev mode (HMR) can recompile the module
 *  graph; pin to globalThis the same way event-bus does. */
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
          continue; // unreadable file — skip
        }
        for (const t of wf.triggers ?? []) {
          // First wins on collision; workflow-store validation prevents this on save.
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
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/server/trigger-index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/trigger-index.ts lib/server/trigger-index.test.ts
git commit -m "feat: trigger-index for fast triggerId lookup"
```

---

### Task 5: Workflow-store validation for triggers and index invalidation

**Files:**
- Modify: `lib/server/workflow-store.ts`
- Modify: `lib/server/workflow-store.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `lib/server/workflow-store.test.ts` (read it first to learn the existing setup patterns):

```ts
describe('saveWorkflow trigger validation', () => {
  test('rejects an invalid trigger id format', async () => {
    const wf = baseWorkflow('wf-a');
    wf.triggers = [
      { id: 'too-short', name: 't', enabled: true, match: [], inputs: {} },
    ];
    await expect(saveWorkflow(wf)).rejects.toThrow(/trigger.*id/i);
  });

  test('rejects a trigger id collision across workflows', async () => {
    const wfA = baseWorkflow('wf-a');
    wfA.triggers = [
      { id: 'abcdefghijklmnopqrst12', name: 't', enabled: true, match: [], inputs: {} },
    ];
    await saveWorkflow(wfA);

    const wfB = baseWorkflow('wf-b');
    wfB.triggers = [
      { id: 'abcdefghijklmnopqrst12', name: 't', enabled: true, match: [], inputs: {} },
    ];
    await expect(saveWorkflow(wfB)).rejects.toThrow(/trigger.*collision/i);
  });

  test('rejects trigger.inputs key that is not a declared workflow input', async () => {
    const wf = baseWorkflow('wf-a');
    wf.inputs = [{ name: 'branch', type: 'string' }];
    wf.triggers = [
      {
        id: 'idAAAAAAAAAAAAAAAAAAAA',
        name: 't',
        enabled: true,
        match: [],
        inputs: { not_a_declared_input: '{{body.x}}' },
      },
    ];
    await expect(saveWorkflow(wf)).rejects.toThrow(/inputs.*not_a_declared_input/i);
  });

  test('rejects invalid predicate op', async () => {
    const wf = baseWorkflow('wf-a');
    wf.triggers = [
      {
        id: 'idBBBBBBBBBBBBBBBBBBBB',
        name: 't',
        enabled: true,
        match: [{ lhs: 'a', op: 'INVALID' as any, rhs: 'b' }],
        inputs: {},
      },
    ];
    await expect(saveWorkflow(wf)).rejects.toThrow(/op/);
  });

  test('invalidates the trigger index on save', async () => {
    const { triggerIndex } = await import('./trigger-index');
    const wf = baseWorkflow('wf-a');
    wf.triggers = [
      { id: 'idCCCCCCCCCCCCCCCCCCCC', name: 't', enabled: true, match: [], inputs: {} },
    ];
    await saveWorkflow(wf);
    expect(await triggerIndex.lookup('idCCCCCCCCCCCCCCCCCCCC')).toBeDefined();

    await saveWorkflow({ ...wf, triggers: [] });
    expect(await triggerIndex.lookup('idCCCCCCCCCCCCCCCCCCCC')).toBeUndefined();
  });
});
```

(If `baseWorkflow` doesn't already exist in the test file, define a tiny helper at the top of the describe block:
```ts
const baseWorkflow = (id: string): Workflow => ({
  id, name: id, version: 0,
  createdAt: 0, updatedAt: 0,
  nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
});
```
)

- [ ] **Step 2: Run failing tests**

Run: `bun test lib/server/workflow-store.test.ts`
Expected: FAIL (validation not implemented; index invalidation not wired).

- [ ] **Step 3: Implement trigger validation**

Edit `lib/server/workflow-store.ts`. Add a validator function near the existing `validateNodeConfig`:

```ts
const TRIGGER_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const ALLOWED_OPS = new Set(['==', '!=', 'contains', 'matches']);

function validateTriggers(wf: Workflow): void {
  const triggers = wf.triggers;
  if (triggers === undefined) return;
  if (!Array.isArray(triggers)) {
    throw new Error('invalid workflow: triggers must be an array');
  }

  const declaredInputNames = new Set((wf.inputs ?? []).map((i) => i.name));
  const seenIds = new Set<string>();

  for (const t of triggers) {
    if (!t || typeof t !== 'object') {
      throw new Error('invalid workflow: trigger entries must be objects');
    }
    if (typeof t.id !== 'string' || !TRIGGER_ID_RE.test(t.id)) {
      throw new Error(
        `invalid workflow: trigger id "${t.id}" must match /^[A-Za-z0-9_-]{16,32}$/`,
      );
    }
    if (seenIds.has(t.id)) {
      throw new Error(
        `invalid workflow: duplicate trigger id "${t.id}" within workflow`,
      );
    }
    seenIds.add(t.id);
    if (typeof t.name !== 'string' || t.name.length === 0) {
      throw new Error(`invalid workflow: trigger "${t.id}" name must be non-empty`);
    }
    if (typeof t.enabled !== 'boolean') {
      throw new Error(`invalid workflow: trigger "${t.id}" enabled must be boolean`);
    }
    if (!Array.isArray(t.match)) {
      throw new Error(`invalid workflow: trigger "${t.id}" match must be an array`);
    }
    for (const p of t.match) {
      if (
        !p || typeof p !== 'object' ||
        typeof p.lhs !== 'string' ||
        typeof p.rhs !== 'string' ||
        !ALLOWED_OPS.has(p.op)
      ) {
        throw new Error(
          `invalid workflow: trigger "${t.id}" predicate has invalid lhs/op/rhs`,
        );
      }
    }
    if (!t.inputs || typeof t.inputs !== 'object' || Array.isArray(t.inputs)) {
      throw new Error(`invalid workflow: trigger "${t.id}" inputs must be a record`);
    }
    for (const key of Object.keys(t.inputs)) {
      if (!declaredInputNames.has(key)) {
        throw new Error(
          `invalid workflow: trigger "${t.id}" inputs.${key} is not a declared workflow input`,
        );
      }
      if (typeof (t.inputs as Record<string, unknown>)[key] !== 'string') {
        throw new Error(
          `invalid workflow: trigger "${t.id}" inputs.${key} must be a templated string`,
        );
      }
    }
  }
}

/** Walks every other workflow on disk and asserts none of its trigger ids
 *  collide with `wf.triggers`. Skips entries whose `id` matches `wf.id` (the
 *  one being saved). */
async function validateNoCrossWorkflowTriggerCollisions(wf: Workflow): Promise<void> {
  const ids = new Set((wf.triggers ?? []).map((t) => t.id));
  if (ids.size === 0) return;
  const summaries = await listWorkflows();
  for (const summary of summaries) {
    if (summary.id === wf.id) continue;
    let other: Workflow;
    try {
      other = await getWorkflow(summary.id);
    } catch {
      continue;
    }
    for (const t of other.triggers ?? []) {
      if (ids.has(t.id)) {
        throw new Error(
          `invalid workflow: trigger id collision: "${t.id}" already used by workflow "${other.id}"`,
        );
      }
    }
  }
}
```

In `saveWorkflow`, call both validators **before** the existing `validateNoSubworkflowCycles(workflow)` call:

```ts
export async function saveWorkflow(workflow: Workflow): Promise<Workflow> {
  validateWorkflow(workflow);
  validateTriggers(workflow);
  await validateNoCrossWorkflowTriggerCollisions(workflow);
  await validateNoSubworkflowCycles(workflow);
  // …rest unchanged
}
```

At the very end of `saveWorkflow`, after the atomic rename and before `return saved`, invalidate the trigger index. Import it at the top of the file:

```ts
import { triggerIndex } from './trigger-index';
```

…and at the end of `saveWorkflow` (just before `return saved;`):

```ts
  triggerIndex.invalidate();
  return saved;
```

Do the same at the end of `deleteWorkflow` (just before the function returns):

```ts
  triggerIndex.invalidate();
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/server/workflow-store.test.ts`
Expected: PASS (new tests + all existing).

- [ ] **Step 5: Commit**

```bash
git add lib/server/workflow-store.ts lib/server/workflow-store.test.ts
git commit -m "feat: validate triggers on save and invalidate index"
```

---

### Task 6: Trigger queue

**Files:**
- Create: `lib/server/trigger-queue.ts`
- Create: `lib/server/trigger-queue.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/server/trigger-queue.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TriggerQueue } from './trigger-queue';
import type { Workflow } from '../shared/workflow';

function fakeWorkflow(id: string): Workflow {
  return {
    id, name: id, version: 1,
    createdAt: 0, updatedAt: 0,
    nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  };
}

describe('TriggerQueue', () => {
  let started: Array<{ workflowId: string; runId: string }>;
  let engineBusy: boolean;
  let nextRunId: number;
  let q: TriggerQueue;

  beforeEach(() => {
    started = [];
    engineBusy = false;
    nextRunId = 0;

    q = new TriggerQueue({
      engineStart: async (wf) => {
        if (engineBusy) {
          const err = new Error('a run is already active');
          throw err;
        }
        const runId = `run-${++nextRunId}`;
        started.push({ workflowId: wf.id, runId });
        return runId;
      },
      loadWorkflow: async (id) => fakeWorkflow(id),
      maxQueue: 3,
    });
  });

  afterEach(() => q.clear());

  test('enqueue returns sequential positions', () => {
    const a = q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    const b = q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 2,
    });
    expect(a.position).toBe(1);
    expect(b.position).toBe(2);
    expect(a.queueId).not.toBe(b.queueId);
  });

  test('drain pulls and starts when engine is idle', async () => {
    q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    await q.drain();
    expect(started).toHaveLength(1);
    expect(q.size()).toBe(0);
  });

  test('drain re-prepends on busy and waits', async () => {
    engineBusy = true;
    q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    await q.drain();
    expect(started).toHaveLength(0);
    expect(q.size()).toBe(1);

    engineBusy = false;
    await q.drain();
    expect(started).toHaveLength(1);
    expect(q.size()).toBe(0);
  });

  test('enqueue throws when at cap', () => {
    for (let i = 0; i < 3; i++) {
      q.enqueue({
        workflow: fakeWorkflow('w'), resolvedInputs: {},
        triggerId: 't', receivedAt: i,
      });
    }
    expect(() =>
      q.enqueue({
        workflow: fakeWorkflow('w'), resolvedInputs: {},
        triggerId: 't', receivedAt: 99,
      }),
    ).toThrow(/queue.*full|cap/i);
  });

  test('FIFO order', async () => {
    q.enqueue({
      workflow: fakeWorkflow('a'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    q.enqueue({
      workflow: fakeWorkflow('b'), resolvedInputs: {},
      triggerId: 't', receivedAt: 2,
    });
    await q.drain();
    await q.drain();
    expect(started.map((s) => s.workflowId)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test lib/server/trigger-queue.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/server/trigger-queue.ts`:

```ts
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
   *  and bail. Recursively continues on drop until the queue is empty or the
   *  engine refuses. */
  async drain(): Promise<void> {
    if (this.draining) return;
    if (this.q.length === 0) return;
    this.draining = true;
    try {
      while (this.q.length > 0) {
        const head = this.q.shift()!;

        // Re-fetch workflow to detect deletes while in queue.
        let workflow: Workflow;
        try {
          workflow = await this.loadWorkflow(head.workflow.id);
        } catch {
          // Workflow deleted (or transiently unreadable). Fall back to the
          // snapshot if reasonable; the spec says drop on missing.
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

/* Singleton — wired up in lib/server/trigger-queue-singleton.ts (next task). */
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/server/trigger-queue.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/trigger-queue.ts lib/server/trigger-queue.test.ts
git commit -m "feat: trigger queue with FIFO + busy re-prepend + drop on delete"
```

---

### Task 7: Wire the queue to the engine via a singleton

**Files:**
- Modify: `lib/server/workflow-engine.ts` — expose a way to call `start()` that returns the assigned runId
- Create: `lib/server/trigger-queue-singleton.ts`
- Create: `lib/server/trigger-queue-singleton.test.ts`

- [ ] **Step 1: Inspect the engine to find the shape of `start()`'s return**

Read `lib/server/workflow-engine.ts` around line 112. `start()` currently returns `Promise<void>` and assigns `this.currentRunId` synchronously before the async body runs. We need a way to read the runId synchronously after enqueueing the start.

The cleanest approach: don't change `start()`'s signature. Add a small adapter in the singleton that calls `start()` and reads `engine.getState().runId` right after:

- [ ] **Step 2: Write the failing test**

Create `lib/server/trigger-queue-singleton.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { triggerQueue } from './trigger-queue-singleton';

describe('triggerQueue singleton', () => {
  test('exists and exposes the TriggerQueue interface', () => {
    expect(typeof triggerQueue.enqueue).toBe('function');
    expect(typeof triggerQueue.drain).toBe('function');
    expect(typeof triggerQueue.size).toBe('function');
  });
});
```

Run: `bun test lib/server/trigger-queue-singleton.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the singleton**

Create `lib/server/trigger-queue-singleton.ts`:

```ts
import { TriggerQueue } from './trigger-queue';
import { workflowEngine } from './workflow-engine';
import { getWorkflow } from './workflow-store';
import { eventBus } from './event-bus';

/** Adapter: call engine.start() and surface the assigned runId.
 *  engine.start() is fire-and-forget; we kick it off, wait one microtask so
 *  the snapshot is updated, then read the runId. */
async function engineStartAdapter(wf: Parameters<typeof workflowEngine.start>[0], opts: Parameters<typeof workflowEngine.start>[1]): Promise<string> {
  // Synchronous-ish: engine.start() flips status to 'running' and assigns
  // currentRunId in its first synchronous block before any await. We invoke
  // without awaiting, then read.
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
  // recent terminal-state transition. Safe — drain() is idempotent and self-guarded.
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
```

Re-read `lib/server/workflow-engine.ts` around lines 112–150 to confirm `start()` assigns `this.snapshot.runId` synchronously before any `await`. The current code does this (the `this.snapshot = { status: 'running', runId: ..., ... }` block runs before `await this.walkFrom(...)`). The adapter relies on this. If a future change inserts an `await` before that assignment, this adapter breaks — add the following comment at the top of `engineStartAdapter`:

```ts
// CONTRACT: workflowEngine.start() must assign snapshot.runId synchronously
// (before its first await). Verified in workflow-engine.ts as of 2026-05-13.
```

Also confirm `workflowEngine` is the existing exported singleton. Check the bottom of `workflow-engine.ts`:

```bash
grep -n "export const workflowEngine\|export { workflowEngine" lib/server/workflow-engine.ts
```

If the symbol name differs (e.g. `engine`), adjust the import accordingly.

- [ ] **Step 4: Run tests**

Run: `bun test lib/server/trigger-queue-singleton.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/trigger-queue-singleton.ts lib/server/trigger-queue-singleton.test.ts
git commit -m "feat: trigger-queue singleton wired to engine + event bus"
```

---

### Task 8: Webhook route — request handling, predicates, enqueue

**Files:**
- Create: `app/api/webhook/[triggerId]/route.ts`
- Create: `app/api/webhook/[triggerId]/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/api/webhook/[triggerId]/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST } from './route';
import { triggerIndex } from '@/lib/server/trigger-index';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

const tmpDir = path.join(os.tmpdir(), `infloop-webhook-${process.pid}`);

async function writeWorkflow(id: string, triggers: unknown[], inputs: unknown[] = []) {
  const file = path.join(tmpDir, `${id}.json`);
  await fs.writeFile(file, JSON.stringify({
    id, name: id, version: 1, createdAt: 0, updatedAt: 0,
    nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
    inputs,
    triggers,
  }));
}

function mkReq(triggerId: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://test/api/webhook/${triggerId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpDir;
  triggerIndex.invalidate();
  triggerQueue.clear();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const goodId = 'idAAAAAAAAAAAAAAAAAAAA';

describe('POST /api/webhook/[triggerId]', () => {
  test('404 for unknown id', async () => {
    const res = await POST(mkReq('absent_id_000000000000'), { params: Promise.resolve({ triggerId: 'absent_id_000000000000' }) });
    expect(res.status).toBe(404);
  });

  test('404 for disabled trigger (same body as unknown)', async () => {
    await writeWorkflow('wf-a', [
      { id: goodId, name: 't', enabled: false, match: [], inputs: {} },
    ]);
    const res = await POST(mkReq(goodId, {}), { params: Promise.resolve({ triggerId: goodId }) });
    expect(res.status).toBe(404);
  });

  test('204 when predicates do not match', async () => {
    await writeWorkflow('wf-a', [
      {
        id: goodId, name: 't', enabled: true,
        match: [{ lhs: '{{body.event}}', op: '==', rhs: 'push' }],
        inputs: {},
      },
    ]);
    const res = await POST(
      mkReq(goodId, { event: 'pull_request' }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(204);
    expect(triggerQueue.size()).toBe(0);
  });

  test('202 when predicates match — enqueues', async () => {
    await writeWorkflow('wf-a', [
      {
        id: goodId, name: 't', enabled: true,
        match: [{ lhs: '{{body.event}}', op: '==', rhs: 'push' }],
        inputs: {},
      },
    ]);
    const res = await POST(
      mkReq(goodId, { event: 'push' }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.queued).toBe(true);
    expect(typeof json.queueId).toBe('string');
    expect(json.position).toBe(1);
  });

  test('422 when a required input is missing after mapping', async () => {
    await writeWorkflow(
      'wf-a',
      [
        {
          id: goodId, name: 't', enabled: true, match: [],
          inputs: { branch: '{{body.nonexistent}}' }, // resolves to ""
        },
      ],
      [{ name: 'branch', type: 'string' /* required, no default */ } as any],
    );
    // string type with empty string passes resolveRunInputs (it allows ""),
    // so for this test use type:number to force a coerce failure:
    await fs.writeFile(path.join(tmpDir, 'wf-b.json'), JSON.stringify({
      id: 'wf-b', name: 'wf-b', version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      inputs: [{ name: 'count', type: 'number' }],
      triggers: [{
        id: 'idBBBBBBBBBBBBBBBBBBBB', name: 't', enabled: true, match: [],
        inputs: { count: '{{body.x}}' }, // resolves to string ""; can't coerce
      }],
    }));
    triggerIndex.invalidate();
    const res = await POST(
      mkReq('idBBBBBBBBBBBBBBBBBBBB', {}),
      { params: Promise.resolve({ triggerId: 'idBBBBBBBBBBBBBBBBBBBB' }) },
    );
    expect(res.status).toBe(422);
  });

  test('413 when content-length exceeds 1 MiB', async () => {
    await writeWorkflow('wf-a', [
      { id: goodId, name: 't', enabled: true, match: [], inputs: {} },
    ]);
    const big = 'x'.repeat(1024 * 1024 + 1);
    const res = await POST(
      mkReq(goodId, big, { 'content-length': String(big.length) }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(413);
  });

  test('503 when the queue is at cap', async () => {
    await writeWorkflow('wf-a', [
      { id: goodId, name: 't', enabled: true, match: [], inputs: {} },
    ]);
    // Saturate the queue. Default cap = 100; cheap to fill.
    for (let i = 0; i < 100; i++) {
      triggerQueue.enqueue({
        workflow: { id: 'wf-a', name: 'x', version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any,
        resolvedInputs: {},
        triggerId: goodId,
        receivedAt: i,
      });
    }
    const res = await POST(mkReq(goodId, {}), { params: Promise.resolve({ triggerId: goodId }) });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test app/api/webhook/[triggerId]/route.test.ts`
Expected: FAIL (route not implemented).

- [ ] **Step 3: Implement the route**

Create `app/api/webhook/[triggerId]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { triggerIndex } from '@/lib/server/trigger-index';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';
import { buildWebhookScope } from '@/lib/server/webhook-scope';
import { evaluatePredicate } from '@/lib/server/predicate';
import { resolve as resolveTemplate } from '@/lib/server/templating';
import { resolveRunInputs, WorkflowInputError } from '@/lib/shared/resolve-run-inputs';
import { getWorkflow } from '@/lib/server/workflow-store';
import type { TriggerPredicate, WebhookTrigger, Workflow, Scope } from '@/lib/shared/workflow';

// NOTE: This route deliberately bypasses INFLOOP_API_TOKEN. The unguessable
// `triggerId` in the path is the auth credential. Every other route uses
// requireAuth(); this is the one explicit exception.

const MAX_BODY_BYTES = 1024 * 1024;

interface RouteParams {
  params: Promise<{ triggerId: string }>;
}

function notFound() {
  return NextResponse.json({ error: 'not-found' }, { status: 404 });
}

export async function POST(req: Request, { params }: RouteParams): Promise<Response> {
  const { triggerId } = await params;

  // Body size guard via content-length header (read before consuming body).
  const lenHeader = req.headers.get('content-length');
  if (lenHeader) {
    const len = Number.parseInt(lenHeader, 10);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload-too-large' }, { status: 413 });
    }
  }

  const hit = await triggerIndex.lookup(triggerId);
  if (!hit) return notFound();
  if (!hit.trigger.enabled) return notFound();

  let workflow: Workflow;
  try {
    workflow = await getWorkflow(hit.workflowId);
  } catch {
    return notFound();
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: 'bad-body' }, { status: 400 });
  }
  if (bodyText.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload-too-large' }, { status: 413 });
  }

  const scope = buildWebhookScope({
    headers: req.headers,
    url: req.url,
    bodyText,
  });

  if (!matchesAllPredicates(hit.trigger.match, scope)) {
    return new Response(null, { status: 204 });
  }

  let suppliedInputs: Record<string, string>;
  try {
    suppliedInputs = resolveTriggerInputs(hit.trigger, scope);
  } catch (err) {
    console.error('[webhook] inputs resolve failed:', err);
    return NextResponse.json({ error: 'inputs-template-failed' }, { status: 500 });
  }

  let resolvedInputs;
  try {
    resolvedInputs = resolveRunInputs(workflow.inputs ?? [], suppliedInputs);
  } catch (err) {
    if (err instanceof WorkflowInputError) {
      return NextResponse.json(
        {
          error: 'invalid-inputs',
          field: err.field,
          reason: err.reason,
          ...(err.expected ? { expected: err.expected } : {}),
          ...(err.got ? { got: err.got } : {}),
        },
        { status: 422 },
      );
    }
    throw err;
  }

  try {
    const { queueId, position } = triggerQueue.enqueue({
      workflow,
      resolvedInputs,
      triggerId,
      receivedAt: Date.now(),
    });
    // Best-effort kick — if the engine happens to be idle, drain right away.
    void triggerQueue.drain();
    return NextResponse.json(
      { queued: true, queueId, position },
      { status: 202 },
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'QUEUE_FULL') {
      return NextResponse.json(
        { error: 'queue-full' },
        { status: 503, headers: { 'Retry-After': '30' } },
      );
    }
    throw err;
  }
}

function matchesAllPredicates(match: TriggerPredicate[], scope: Scope): boolean {
  for (const p of match) {
    const lhs = resolveTemplate(p.lhs, scope).text;
    const rhs = resolveTemplate(p.rhs, scope).text;
    const verdict = evaluatePredicate({ lhs, op: p.op, rhs });
    if (!verdict.ok) return false;       // invalid regex etc. → treat as no-match
    if (verdict.result === false) return false;
  }
  return true;
}

function resolveTriggerInputs(t: WebhookTrigger, scope: Scope): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, tmpl] of Object.entries(t.inputs)) {
    out[k] = resolveTemplate(tmpl, scope).text;
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test app/api/webhook/[triggerId]/route.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook
git commit -m "feat(api): POST /api/webhook/[triggerId] route"
```

---

### Task 9: Queue inspector route

**Files:**
- Create: `app/api/triggers/queue/route.ts`
- Create: `app/api/triggers/queue/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/api/triggers/queue/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GET } from './route';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

beforeEach(() => triggerQueue.clear());
afterEach(() => triggerQueue.clear());

describe('GET /api/triggers/queue', () => {
  test('returns size 0 when empty', async () => {
    const res = await GET(new Request('http://test/api/triggers/queue'));
    const json = await res.json();
    expect(json.size).toBe(0);
    expect(json.head).toBeUndefined();
  });

  test('returns head when non-empty', async () => {
    triggerQueue.enqueue({
      workflow: { id: 'w', name: 'x', version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any,
      resolvedInputs: {},
      triggerId: 'idAAAAAAAAAAAAAAAAAAAA',
      receivedAt: 1,
    });
    const res = await GET(new Request('http://test/api/triggers/queue'));
    const json = await res.json();
    expect(json.size).toBe(1);
    expect(json.head.workflowId).toBe('w');
    expect(json.head.triggerId).toBe('idAAAAAAAAAAAAAAAAAAAA');
    expect(json.head.position).toBe(1);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test app/api/triggers/queue/route.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `app/api/triggers/queue/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;

  const size = triggerQueue.size();
  const head = triggerQueue.peek();
  return NextResponse.json({
    size,
    head: head
      ? { triggerId: head.triggerId, workflowId: head.workflow.id, position: 1 }
      : undefined,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `bun test app/api/triggers/queue/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/triggers/queue
git commit -m "feat(api): GET /api/triggers/queue inspector"
```

---

### Task 10: TriggersPanel — read-only UI for workflow settings

**Files:**
- Create: `app/components/TriggersPanel.tsx`
- Create: `app/components/TriggersPanel.test.tsx`

- [ ] **Step 1: Inspect the existing settings render path**

Read `app/components/ConfigPanel.tsx` to find where workflow-root settings render (look for a branch like `if (selectedNode === null && workflow)` or similar). Identify the JSX position where `<TriggersPanel workflow={workflow} />` should be inserted. Note the file path and line range for the modify step below.

- [ ] **Step 2: Write failing tests**

Create `app/components/TriggersPanel.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { TriggersPanel } from './TriggersPanel';
import type { Workflow } from '@/lib/shared/workflow';

const wf: Workflow = {
  id: 'wf-a', name: 'A', version: 1, createdAt: 0, updatedAt: 0,
  nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
  triggers: [
    {
      id: 'idAAAAAAAAAAAAAAAAAAAA',
      name: 'push-to-main',
      enabled: true,
      match: [{ lhs: '{{headers.x-github-event}}', op: '==', rhs: 'push' }],
      inputs: { branch: '{{body.ref}}' },
      lastFiredAt: null,
    },
    {
      id: 'idBBBBBBBBBBBBBBBBBBBB',
      name: 'pr-opened',
      enabled: false,
      match: [],
      inputs: {},
      lastFiredAt: 1_700_000_000_000,
    },
  ],
};

describe('TriggersPanel', () => {
  test('renders empty state when no triggers', () => {
    render(<TriggersPanel workflow={{ ...wf, triggers: [] }} origin="http://localhost:3000" />);
    expect(screen.getByText(/no triggers/i)).toBeTruthy();
  });

  test('renders one row per trigger with the URL', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText('push-to-main')).toBeTruthy();
    expect(screen.getByText('pr-opened')).toBeTruthy();
    expect(screen.getByText(/http:\/\/localhost:3000\/api\/webhook\/idAAAA/)).toBeTruthy();
    expect(screen.getByText(/http:\/\/localhost:3000\/api\/webhook\/idBBBB/)).toBeTruthy();
  });

  test('shows Enabled/Disabled chips', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText(/Enabled/)).toBeTruthy();
    expect(screen.getByText(/Disabled/)).toBeTruthy();
  });

  test('shows Last fired and Never fired', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText(/Never fired/i)).toBeTruthy();
    expect(screen.getByText(/Last fired/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `bun test app/components/TriggersPanel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

Create `app/components/TriggersPanel.tsx`:

```tsx
'use client';

import React from 'react';
import { Card, CardBody, Chip, Snippet } from '@heroui/react';
import type { Workflow, WebhookTrigger } from '@/lib/shared/workflow';

export interface TriggersPanelProps {
  workflow: Workflow;
  /** Base URL the webhook endpoint lives at, e.g. window.location.origin. */
  origin: string;
}

export function TriggersPanel({ workflow, origin }: TriggersPanelProps) {
  const triggers = workflow.triggers ?? [];

  if (triggers.length === 0) {
    return (
      <div className="text-sm opacity-70 px-2 py-3">
        No triggers configured. Add a <code>triggers[]</code> entry to the workflow JSON to expose a webhook URL.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {triggers.map((t) => (
        <TriggerRow key={t.id} trigger={t} origin={origin} />
      ))}
      <div className="text-xs opacity-60 px-2 pt-2">
        To add or edit a trigger, edit the workflow JSON file.
      </div>
    </div>
  );
}

function TriggerRow({ trigger, origin }: { trigger: WebhookTrigger; origin: string }) {
  const url = `${origin}/api/webhook/${trigger.id}`;
  const lastFired =
    trigger.lastFiredAt == null
      ? 'Never fired'
      : `Last fired: ${formatRelative(trigger.lastFiredAt)}`;
  return (
    <Card>
      <CardBody className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{trigger.name}</span>
          <Chip color={trigger.enabled ? 'success' : 'default'} size="sm" variant="flat">
            {trigger.enabled ? 'Enabled' : 'Disabled'}
          </Chip>
        </div>
        <Snippet symbol="" variant="bordered" size="sm">
          {url}
        </Snippet>
        <div className="text-xs opacity-70">{lastFired}</div>
        <div className="text-xs opacity-60">
          Matches: {trigger.match.length} predicate{trigger.match.length === 1 ? '' : 's'} ·{' '}
          Inputs: {Object.keys(trigger.inputs).length} mapped
        </div>
      </CardBody>
    </Card>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  return `${d} d ago`;
}
```

- [ ] **Step 5: Run tests**

Run: `bun test app/components/TriggersPanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Mount the panel in ConfigPanel**

Open `app/components/ConfigPanel.tsx`. Find the branch that renders when no node is selected (workflow-root settings — search for a render block that shows workflow `inputs` editor or workflow name editor; that's where workflow-level settings live).

Add an import at the top:

```tsx
import { TriggersPanel } from './TriggersPanel';
```

Inside the workflow-root render block, append:

```tsx
<section className="mt-4">
  <h3 className="text-sm font-semibold mb-2">Triggers</h3>
  <TriggersPanel workflow={workflow} origin={typeof window === 'undefined' ? '' : window.location.origin} />
</section>
```

(Adjust the exact JSX shape to match the surrounding section pattern in ConfigPanel — e.g. if other sections use a different heading component.)

- [ ] **Step 7: Run typecheck + all tests**

```bash
bun run typecheck
bun test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/components/TriggersPanel.tsx app/components/TriggersPanel.test.tsx app/components/ConfigPanel.tsx
git commit -m "feat(ui): read-only TriggersPanel in workflow settings"
```

---

### Task 11: QueueBadge — top-bar indicator for queued triggers

**Files:**
- Create: `app/components/QueueBadge.tsx`
- Create: `app/components/QueueBadge.test.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Write failing tests**

Create `app/components/QueueBadge.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { QueueBadge } from './QueueBadge';

function mockFetchResponse(payload: unknown) {
  // @ts-expect-error globalThis.fetch override
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => payload,
  });
}

describe('QueueBadge', () => {
  test('renders nothing when queue is empty', async () => {
    mockFetchResponse({ size: 0 });
    const { container } = render(<QueueBadge pollMs={50} />);
    await waitFor(() => {
      expect(container.textContent).toBe('');
    });
  });

  test('renders count when queue is non-empty', async () => {
    mockFetchResponse({ size: 3, head: { triggerId: 't', workflowId: 'w', position: 1 } });
    render(<QueueBadge pollMs={50} />);
    await waitFor(() => {
      expect(screen.getByText(/3 queued/i)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test app/components/QueueBadge.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `app/components/QueueBadge.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Chip } from '@heroui/react';

export interface QueueBadgeProps {
  /** Poll interval; default 3000 ms. */
  pollMs?: number;
}

export function QueueBadge({ pollMs = 3000 }: QueueBadgeProps) {
  const [size, setSize] = useState(0);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const res = await fetch('/api/triggers/queue');
        if (!res.ok) return;
        const json = (await res.json()) as { size: number };
        if (alive) setSize(json.size);
      } catch {
        // network blip — ignore
      }
    }

    void tick();
    const handle = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [pollMs]);

  if (size === 0) return null;

  return (
    <Chip size="sm" color="warning" variant="flat">
      {size} queued
    </Chip>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `bun test app/components/QueueBadge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount in page.tsx**

Read `app/page.tsx` and find the top-bar JSX (search for "Run" button or the workflow menu). Add an import:

```tsx
import { QueueBadge } from './components/QueueBadge';
```

Insert `<QueueBadge />` in the top-bar layout adjacent to existing status indicators (e.g. next to the Run/Stop buttons).

- [ ] **Step 6: Typecheck + full test run**

```bash
bun run typecheck
bun test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/QueueBadge.tsx app/components/QueueBadge.test.tsx app/page.tsx
git commit -m "feat(ui): top-bar QueueBadge polling /api/triggers/queue"
```

---

### Task 12: README — document the webhook endpoint

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a section after "Triggering workflows from agents (MCP)"**

Open `README.md`. Find the heading `## Triggering workflows from agents (MCP)`. Immediately after the end of that section (just before `## Tech stack`), insert:

````markdown
## Triggering workflows from webhooks

Each saved workflow can declare one or more **webhook triggers** in its JSON
file. A trigger exposes a unique URL; when an HTTP POST hits that URL,
InfLoop evaluates the trigger's match predicates against the request and, on
a match, queues a workflow run with templated inputs.

### Configuring a trigger

Add a `triggers[]` array to your workflow JSON:

```jsonc
{
  "id": "code-review",
  "inputs": [
    { "name": "branch", "type": "string" },
    { "name": "sha", "type": "string" }
  ],
  "triggers": [
    {
      "id": "abcdef1234567890ABCDEF",
      "name": "github-push-main",
      "enabled": true,
      "match": [
        { "lhs": "{{headers.x-github-event}}", "op": "==",       "rhs": "push" },
        { "lhs": "{{body.ref}}",                "op": "matches", "rhs": "^refs/heads/main$" }
      ],
      "inputs": {
        "branch": "{{body.ref}}",
        "sha":    "{{body.after}}"
      }
    }
  ]
}
```

- **`id`** — appears verbatim in the URL: `POST http://localhost:3000/api/webhook/<id>`.
  Must match `^[A-Za-z0-9_-]{16,32}$` and be unique across all workflows. Generate one with:
  ```bash
  bun -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"
  ```
- **`enabled`** — set to `false` to park a trigger without removing it.
- **`match[]`** — AND-joined predicates. The webhook scope exposes `headers.<name>`
  (lowercased), `query.<name>`, and `body.<dotted.json.path>`. Empty match array = always fire.
- **`inputs`** — maps workflow input names to templated strings. Inputs not listed here
  fall back to their declared `default`.

### Behavior

- Match succeeds → `202` with `{ queued: true, queueId, position }`. The run is queued
  in memory and started when the engine is idle.
- Match fails → `204 No Content`. (The request was well-formed; the trigger chose to ignore it.)
- Unknown / disabled trigger id → `404 not-found`.
- Body > 1 MiB → `413 payload-too-large`.
- Queue at cap (100) → `503 queue-full` with `Retry-After: 30`.

### Security

The unguessable `triggerId` in the URL is the authentication. There is no separate token
or HMAC verification in v1 — anyone with the URL can fire the trigger. Treat trigger URLs
like passwords; rotate by editing the workflow JSON to swap the id.

`INFLOOP_API_TOKEN` does NOT apply to the webhook route (external services can't send
custom auth headers). It does still gate every other route.

### Limitations

- Queued items are lost on process restart. The webhook caller already received `202`, so
  from its perspective the event was accepted; the upstream service is responsible for
  retry semantics if it cares.
- The engine runs one workflow at a time; concurrent webhook hits queue in FIFO order.
````

- [ ] **Step 2: Verify the README still renders**

```bash
bun run typecheck
```

(README has no impact on typecheck; this is just a final sanity check that nothing else broke.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): webhook trigger endpoint usage"
```

---

### Task 13: Full integration smoke test

**Files:**
- Create: `lib/server/webhook-integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `lib/server/webhook-integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST } from '@/app/api/webhook/[triggerId]/route';
import { triggerIndex } from './trigger-index';
import { triggerQueue } from './trigger-queue-singleton';
import { eventBus } from './event-bus';
import type { WorkflowEvent } from '../shared/workflow';

const tmpDir = path.join(os.tmpdir(), `infloop-webhook-int-${process.pid}`);

beforeEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpDir;
  triggerIndex.invalidate();
  triggerQueue.clear();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const TID = 'integ_idAAAAAAAAAAAAAAAAA';

test('end-to-end: webhook hit emits trigger_enqueued event', async () => {
  await fs.writeFile(
    path.join(tmpDir, 'wf-int.json'),
    JSON.stringify({
      id: 'wf-int', name: 'integration', version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      inputs: [{ name: 'msg', type: 'string', default: '' }],
      triggers: [{
        id: TID, name: 'integ', enabled: true,
        match: [{ lhs: '{{body.ok}}', op: '==', rhs: 'yes' }],
        inputs: { msg: '{{body.message}}' },
      }],
    }),
  );

  const events: WorkflowEvent[] = [];
  const unsub = eventBus.subscribe((e) => events.push(e));

  const req = new Request(`http://test/api/webhook/${TID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: 'yes', message: 'hello' }),
  });
  const res = await POST(req, { params: Promise.resolve({ triggerId: TID }) });

  expect(res.status).toBe(202);

  const enq = events.find((e) => e.type === 'trigger_enqueued');
  expect(enq).toBeDefined();
  if (enq && enq.type === 'trigger_enqueued') {
    expect(enq.triggerId).toBe(TID);
    expect(enq.workflowId).toBe('wf-int');
  }

  unsub();
});
```

- [ ] **Step 2: Run it**

Run: `bun test lib/server/webhook-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Full test suite as a final check**

```bash
bun run typecheck
bun test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/server/webhook-integration.test.ts
git commit -m "test: webhook end-to-end emits trigger_enqueued"
```

---

## Verification Checklist

After all tasks complete, run from the repo root:

- [ ] `bun run typecheck` — clean
- [ ] `bun test` — all tests pass, including new files
- [ ] `bun run build` — production build succeeds
- [ ] Manual smoke test:
  1. Start `bun run dev`.
  2. In a workflow JSON file under `workflows/`, add a `triggers[]` entry as in the README example.
  3. Refresh the browser; open the workflow's settings; verify the Triggers panel shows the URL.
  4. Copy the URL; in a terminal: `curl -X POST <url> -d '{}' -H 'content-type: application/json'`.
  5. Verify either `202` (predicates passed, run starts) or `204` (predicates didn't match).
  6. With the engine busy, fire another webhook; verify the top-bar `1 queued` badge appears, then disappears when the prior run finishes and the queued one starts.
