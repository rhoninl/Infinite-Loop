# Webhook Triggers

**Status:** Design
**Author:** rhoninlee (with Claude)

## Problem

InfLoop workflows can be started three ways today: the browser Run
button, the HTTP `/api/run` endpoint, and the MCP tool surface. All
three are *pull* — a human or an agent decides "run now."

There is no *push* path. A user who wants "when GitHub fires a `push`
webhook to my repo, start the `code-review` workflow with the commit
SHA as input" has to wire up their own bridge (a relay script, a cron
poller) and call `/api/run` themselves. That defeats the point of a
visual workflow editor: the orchestration knowledge lives outside the
workflow file.

## Goal

A first-class **webhook trigger** mechanism: each workflow can declare
one or more webhook triggers. Each trigger exposes a unique URL; when
an HTTP POST arrives at that URL, an optional filter predicate decides
whether to fire, and the trigger maps payload fields into the
workflow's declared inputs before queueing a run.

The mechanism is **generic** — it does not embed knowledge of GitHub,
Stripe, Linear, etc. Any service that POSTs JSON can drive InfLoop.
Service-specific helpers (e.g. GitHub HMAC verification) are future
work that can sit on top of this design.

## Non-goals

- **Service-specific verification** (GitHub `X-Hub-Signature-256`,
  Stripe `Stripe-Signature`). The trigger URL is the secret; HMAC
  helpers can be added later as a thin wrapper.
- **Streaming the resulting run** back to the webhook caller. The
  endpoint returns `202 { queueId }`; the caller polls
  `/api/runs/:workflowId/:runId` if it cares about the result.
- **Persisting the queue across restarts.** In-memory only; the
  upstream service owns retry semantics if it cares.
- **Per-trigger rate limiting** beyond the 100-item global cap.
- **Trigger editing UI.** Read-only display in v1; authoring happens by
  editing the workflow JSON.
- **Multi-run engine.** The engine remains single-run-at-a-time. The
  queue is what gives webhooks "fire-and-forget" semantics.

## Decisions made during brainstorming

- **Scope:** fully generic. One endpoint shape, no service-specific
  presets.
- **Config home:** per-workflow `triggers[]` array in the workflow
  JSON. One workflow can have multiple triggers.
- **Match style:** array of Branch-style `{lhs, op, rhs}` predicates,
  AND-joined. Empty array = always fire.
- **Busy policy:** FIFO in-memory queue; webhook returns `202` even
  when the engine is busy; queue drains on engine settle.
- **Auth:** unguessable per-trigger id in the URL path. No bearer
  token, no HMAC.
- **UI:** read-only — list of triggers per workflow with copy-URL,
  enabled/disabled chip, last-fired-at. Editing is JSON.

## Design

### 1. Data model

A new `triggers[]` field on `Workflow` in `lib/shared/workflow.ts`:

```ts
export interface WebhookTrigger {
  /** Unguessable id; appears in the URL: /api/webhook/<id>.
   *  ~22 url-safe chars from crypto.randomBytes(16).toString('base64url'). */
  id: string;

  /** Human-readable label shown in the UI list. */
  name: string;

  /** false → endpoint returns 404 (lets the user park a trigger without
   *  deleting it). */
  enabled: boolean;

  /** AND-joined predicates evaluated against the webhook scope.
   *  Empty array = always fires. Reuses Branch operators. */
  match: TriggerPredicate[];

  /** Maps each declared workflow input (by NAME) to a templated string
   *  evaluated against the webhook scope. Inputs not listed here fall
   *  back to their workflow-level `default`. */
  inputs: Record<string, string>;

  /** Set by the engine on successful fire; null until first hit.
   *  UI-only; not persisted into run records. */
  lastFiredAt?: number | null;
}

export interface TriggerPredicate {
  lhs: string;           // e.g. "{{headers.x-github-event}}"
  op: '==' | '!=' | 'contains' | 'matches';
  rhs: string;           // e.g. "push"
}

export interface Workflow {
  // …existing fields…
  triggers?: WebhookTrigger[];
}
```

The **webhook scope** available to predicates and inputs templates:

| Key | Meaning |
|---|---|
| `headers.<name>` | Header values; names lowercased; multi-value joined with `,`. |
| `query.<name>` | URL query parameters (last value wins on repeats). |
| `body` | Raw body string. |
| `body.<dotted.path>` | JSON-parsed body fields. Missing keys resolve to empty string. Arrays use numeric indices: `body.items.0.name`. |
| `method` | Always `POST` in v1, but reserved for future expansion. |

The webhook scope is **isolated** from the run scope. Once the workflow
starts, the run scope contains the normal `__inputs.*` plus node
outputs; it does NOT contain `headers`/`body`/`query`. This boundary
keeps node executors from accidentally depending on webhook context.

### 2. HTTP endpoint

**Route:** `POST /api/webhook/[triggerId]` — new file
`app/api/webhook/[triggerId]/route.ts`.

**Auth surface:** the `INFLOOP_API_TOKEN` check does **not** apply to
this route. The unguessable `triggerId` in the path is the
authentication. Every other route still uses `requireAuth`; webhook is
the one explicit exception, documented in a comment at the top of the
route file.

**Request flow:**

1. Look up the trigger by id via the in-memory trigger index (built
   from `workflow-store`, invalidated on save/delete). Not found, or
   `enabled === false`, or workflow missing → `404 { error: 'not-found' }`.
   The response body is identical in all three cases — never leak
   whether the id existed but was disabled.
2. Reject `content-length > 1 MiB` with `413 { error: 'payload-too-large' }`
   before reading the body.
3. Read body via `req.text()`. Try `JSON.parse` to populate
   `body.<path>`; if the body is not JSON, those template references
   resolve to empty string while `body` itself still holds the raw
   string.
4. Build the webhook scope `{headers, query, body, method}`.
5. Evaluate `trigger.match` predicates AND. Any predicate false →
   `204 No Content`. (`204` rather than `4xx` because the request was
   well-formed; the trigger just chose to ignore it. Webhook senders
   that retry on 4xx/5xx won't.)
6. Resolve `trigger.inputs` against the webhook scope, then run the
   resulting `Record<string, string>` through the existing
   `resolveRunInputs(workflow.inputs, supplied)` validator. Failure →
   `422` with the existing `invalid-inputs` error shape.
7. Enqueue `{workflow, resolvedInputs, triggerId, receivedAt}` into
   the trigger queue (Section 3). On success, return:
   ```json
   202 { "queued": true, "queueId": "…", "position": 1 }
   ```
   `runId` is not yet known and is not in the response. Callers that
   want the runId subscribe to `/api/events` (the queue emits
   `trigger_started { queueId, runId }`) or poll for runs created
   after `receivedAt`.

**No streaming, no wait.** The endpoint never blocks on engine state.

### 3. Trigger queue

A new singleton in `lib/server/trigger-queue.ts`.

**State (in-memory, process-lifetime only):**

```ts
type QueuedRun = {
  queueId: string;             // unique id returned to webhook caller
  workflow: Workflow;          // snapshot captured at enqueue time
  resolvedInputs: ResolvedInputs;
  triggerId: string;
  receivedAt: number;
};

const queue: QueuedRun[] = [];
const MAX_QUEUE = 100;
```

**API:**

| Method | Purpose |
|---|---|
| `enqueue(item)` | Append; returns `{ queueId, position }` (1-indexed). Throws `QueueFullError` when `queue.length >= MAX_QUEUE`. |
| `peek()` / `size()` | UI inspection. |
| `drain()` | If engine is non-running and queue is non-empty, shift one and call `workflowEngine.start(...)`. Wraps the call so a thrown error doesn't poison the queue: drop, log, recurse. |
| `clear()` | Test escape hatch. |

**Wiring:**

- `triggerQueue.drain` is subscribed to the engine's terminal events
  (`run_finished`, `run_failed`, `run_cancelled`) via the existing
  event bus.
- `drain()` is also called once at server boot to cover the race
  window where items were enqueued during a terminal-state transition.
- When `drain()` shifts an item, it **re-fetches** the workflow by id
  from `workflow-store`. If the workflow has been deleted, emit
  `trigger_dropped { reason: 'workflow-deleted' }` and recurse to the
  next item. If re-fetch fails transiently, fall back to the snapshot
  in the queue.
- When `start()` itself reports busy (a UI Run snuck in first), the
  item is re-prepended at position 0 and we wait for the next settle.
  No item is lost.

**Backpressure:** at the cap, `enqueue` throws and the route returns
`503 { error: 'queue-full' }` with `Retry-After: 30`. Simpler than
per-trigger limits; blast radius from a runaway trigger is bounded.

**Observability — new typed events on the existing event bus:**

| Event | Fields |
|---|---|
| `trigger_enqueued` | `queueId, triggerId, workflowId, position, receivedAt` |
| `trigger_started` | `queueId, triggerId, workflowId, runId` |
| `trigger_dropped` | `queueId, triggerId, reason` |

These flow through `/api/events` so the UI updates live. The
`trigger_started` event is also folded into the run's persisted event
log so the run record records "this run came from trigger X."

**Restart loss:** queued items are lost on process restart. Documented
in `README.md` and in a comment on `triggerQueue`. The webhook caller
already received `202`; from its perspective the event was accepted.
If the upstream service cares about durability, it must implement
retry.

### 4. UI

A new **Triggers** section in the right-side panel when a workflow's
settings are open (alongside the existing `inputs[]` editor). Read-only.

Layout sketch:

```
┌── Triggers ──────────────────────────────────────────┐
│ ● push-to-main             Enabled                   │
│   http://localhost:3000/api/webhook/g8K…vQ2  [copy]  │
│   Last fired: 12 min ago                             │
│   Matches: 2 predicates · Inputs: 3 mapped           │
│                                                       │
│ ○ pr-opened                Disabled                  │
│   http://localhost:3000/api/webhook/aZ4…m1L  [copy]  │
│   Never fired                                        │
└──────────────────────────────────────────────────────┘
       To add or edit a trigger, edit the workflow JSON file.
```

**Components — HeroUI primitives only:**

- `Card` per trigger row
- `Chip` for enabled/disabled status
- `Snippet` for the URL with built-in copy button
- `Tooltip` over "Matches: N predicates" to expand the predicate list
  on hover (read-only)

**Live updates.** The panel subscribes to the SSE stream and updates
`lastFiredAt` and the most-recent-fire line when `trigger_started` /
`trigger_dropped` events arrive for triggers belonging to the open
workflow.

**Top-bar queue badge.** When the engine is running, a small badge
shows `N queued` (sourced from a new `GET /api/triggers/queue` route
that returns `{ size, head?: {triggerId, workflowId, position} }`).
Hidden when the queue is empty.

**Read paths — no new write routes.** `GET /api/workflows/:id` already
returns the full workflow; `triggers[]` rides along.

### 5. Templating, validation, edge cases

**New helpers in `lib/shared/templating.ts`:**

- `flattenJsonForScope(value, prefix)` — walks a parsed JSON value and
  produces a flat `Record<string,string>` keyed `prefix.a.b.c`. Arrays
  use numeric indices (`body.items.0.name`). When a template references
  a container (`body.user`), the leaf is the JSON-stringified subtree.
- Header normalization — keys lowercased, multi-value joined with `,`.

**Predicate evaluation.** Extract the predicate logic out of
`lib/server/nodes/branch.ts` into a shared helper
`lib/server/predicate.ts`, used by both the Branch executor and the
trigger evaluator. Behaviorally identical regex/contains/equality
semantics across the two surfaces.

**Workflow-store validation.** On save (`workflow-store.ts`), validate
the `triggers[]` field:

- `id` matches `^[A-Za-z0-9_-]{16,32}$`
- `id` is unique across **all** workflows in the store (not just this
  one). Collision → save fails with `409 { error: 'trigger-id-collision' }`.
- `name` non-empty
- `match[].op` is one of the four operators
- `inputs` keys are a subset of the workflow's declared `inputs[]` names

Trigger id generation (helper, called from the UI/CLI when a user
hand-edits): `crypto.randomBytes(16).toString('base64url')` → 22
chars, ~128 bits.

**Logging.** The webhook route never logs full paths. Logs use
`triggerId.slice(0, 6) + '…'`.

**CORS.** The route returns no CORS headers. Webhook senders are
server-to-server, not browsers.

**Edge cases:**

| Case | Behavior |
|---|---|
| Unknown id / disabled / workflow missing | `404 not-found` (identical body) |
| Body > 1 MiB | `413 payload-too-large` |
| Predicate mismatch | `204 No Content` |
| Template references missing JSON path | empty string fallback |
| Required input ends up empty after mapping | `422 invalid-inputs` (via `resolveRunInputs`) |
| Workflow saved while a queued item references the old version | Snapshot in queue is used — intentional |
| Workflow deleted while queued | `trigger_dropped { reason: 'workflow-deleted' }` |
| Engine busy, UI Run sneaks in between settle and drain | Item re-prepended at position 0 |
| Server restart with items queued | Items dropped; documented |
| Queue at cap | `503 queue-full`, `Retry-After: 30` |

### 6. Testing

- `lib/server/trigger-queue.test.ts` — enqueue/dequeue ordering,
  position numbering, cap behavior, drain on settle, drain on boot,
  workflow-deleted drop, engine-busy re-prepend.
- `app/api/webhook/[triggerId]/route.test.ts` — `404` for
  unknown/disabled, `204` for predicate mismatch, `202` for success
  with correct `queueId`/`position`, `413` for oversize, `422` for
  invalid input mapping after templating, `503` over cap.
- `lib/shared/templating.test.ts` — add cases for `flattenJsonForScope`
  (nested objects, arrays with index access, non-JSON body, container
  references).
- `lib/server/predicate.test.ts` — covers extracted shared helper;
  ensures Branch and trigger surfaces stay equivalent.
- Integration: a happy-path test that hits the route end-to-end,
  asserts the queue grew, settles the engine, asserts the run was
  started with the right inputs and the right `triggerId` recorded on
  the run.

## Open questions

None at design time. Implementation may surface details around
`Snippet` copy-button styling and where exactly the queue badge fits
on the top bar; those are UI calls to be made during build.

## Out of scope (future work)

- GitHub-style HMAC verification helper (wraps this design; not a
  re-architecture).
- Trigger editing UI (form-based create/edit).
- Per-trigger rate limiting.
- Durable queue (survives restart).
- Streaming run output back to the webhook caller via SSE on the
  webhook response.
