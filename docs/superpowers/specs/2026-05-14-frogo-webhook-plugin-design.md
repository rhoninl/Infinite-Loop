# Frogo Webhook Plugin

**Status:** Design
**Author:** rhoninlee (with Claude)
**Related:** [`2026-05-13-webhook-trigger-design.md`](./2026-05-13-webhook-trigger-design.md)

## Problem

InfLoop's webhook trigger system (see `2026-05-13-webhook-trigger-design.md`) is generic:
any service that POSTs JSON can drive a workflow, and a plugin file in
`webhook-plugins/` declares the event header, event types, and field
paths for templating and autocomplete. Today only `github.json` exists.

Frogo (the sibling project under `CodeCase/`) emits webhooks for task
lifecycle events with HMAC-SHA256 signatures. A user who wants "when
Frogo fires `task.created`, start the `triage` workflow" can already do
this against the generic webhook endpoint, but they get:

1. No first-class Frogo entry in the plugin picker.
2. No autocomplete for `body.payload.task.title`-style references.
3. No way to verify the `X-Frogo-Signature` header — anyone who guesses
   the trigger URL can forge a Frogo event.

(3) is the substantive gap. (1) and (2) are ergonomics, and they fall
out for free once the plugin file exists.

## Goal

1. Ship `webhook-plugins/frogo.json` describing all Frogo webhook
   events.
2. Extend the plugin schema with an optional, **generic** signature
   verification block so any future plugin (GitHub, Stripe, Linear) can
   declare HMAC verification declaratively.
3. Wire HMAC-SHA256 verification into the webhook ingestion route.

## Non-goals

- **No action-back path from workflow → Frogo.** Posting a comment or
  updating a task from inside a workflow is deferred until the HTTP
  node (Phase 3) lands, or until a Frogo SDK helper is explicitly
  requested. The webhook plugin is one-way: Frogo → InfLoop.
- **No retro-fit of `github.json`** to add a `signature` block. GitHub
  uses `X-Hub-Signature-256` with the same HMAC-SHA256 scheme, so the
  retrofit will be trivial once this generic mechanism lands — but it
  is out of scope here.
- **No replay-attack protection** beyond signature (no nonce store, no
  timestamp window). Frogo does sign delivery via `X-Frogo-Timestamp`
  but the timestamp is not part of the HMAC input today.
- **No trigger-editing GUI.** Per current state of
  `docs/superpowers/specs/2026-05-13-webhook-trigger-design.md`, triggers are authored by editing
  workflow JSON. The new `secret` and `verifyOptional` fields live in
  the same JSON, surfaced through the save-time validation in
  `app/api/triggers/route.ts` (422 on misconfig).
- **No new node type.** No engine changes.

## Frogo emission — verified facts

Verified against `frogo/web/lib/webhookWorker.ts`,
`frogo/web/lib/webhookSigning.ts`,
`frogo/web/types/index.ts`, and the route files under
`frogo/web/app/api/v1/tasks/`:

| What | Value |
|---|---|
| Event types | `task.created`, `task.updated`, `task.deleted`, `task.commented`, `ping` |
| Event header | `X-Frogo-Event` |
| Delivery id header | `X-Frogo-Delivery` |
| Timestamp header | `X-Frogo-Timestamp` (ISO 8601) |
| Signature header | `X-Frogo-Signature` (omitted when subscription has no secret) |
| Signature scheme | HMAC-SHA256 over the raw request body |
| Signature format | `sha256=<hex digest>` |
| Body shape | `{ event, taskId, payload, timestamp }` |

The `ping` event is emitted by the `POST /api/v1/subscriptions/:id/test`
endpoint with `taskId: null` and `payload: { message: "..." }`.

## Design

### 1. Plugin schema extension — `signature` block

The plugin type `WebhookPlugin` lives in `lib/shared/trigger.ts`
(currently at L55). Plugin file loading and validation happens in
`lib/server/webhook-plugins/loader.ts` (function `validatePlugin`), with
the process-level singleton in `lib/server/webhook-plugins/index.ts`.

Add a new `PluginSignature` type and an optional `signature?: PluginSignature`
field on `WebhookPlugin` in `lib/shared/trigger.ts`:

```ts
export interface PluginSignature {
  /** Header name carrying the signature. Normalized to lowercase by
   *  `validatePlugin` at load time, so lookups can use the lowercased key. */
  header: string;
  /** Verification scheme. v1 supports `hmac-sha256` only. */
  scheme: 'hmac-sha256';
  /** How to parse the header value to extract the digest:
   *  - "sha256=<hex>"  e.g. Frogo, GitHub
   *  - "hex"           bare hex digest (no prefix)
   *  - "base64"        bare base64 digest (no prefix)
   *
   *  Note: v1 covers schemes where the HMAC is computed over the raw
   *  request body. Schemes that sign a constructed payload (e.g. Stripe's
   *  `${timestamp}.${body}`) will require a schema-incompatible extension
   *  (e.g. a `signedPayload` template field). This is acceptable: we do
   *  not need that today, and pretending the current shape is
   *  forward-compatible would mislead future contributors.
   */
  format: 'sha256=<hex>' | 'hex' | 'base64';
}
```

Extend `validatePlugin` in `loader.ts` to:
- Validate the optional `signature` block shape (all three fields required when present, `scheme === 'hmac-sha256'`, `format` is one of the three literals).
- Normalize `signature.header` to lowercase. (Do the same for the existing `eventHeader` while we're there — current loader does not normalize, and the route relies on header lookups being case-insensitive.)

The field is optional. Plugins that omit it (today: `github.json`) keep
existing behavior — no verification step. This preserves
`2026-05-13-webhook-trigger-design.md`'s "URL is the secret" model as the floor.

### 2. Per-trigger secret and opt-out

Extend `WebhookTrigger` in `lib/shared/trigger.ts` with two optional fields:

```ts
export interface WebhookTrigger {
  id: string;
  name: string;
  enabled: boolean;
  match: TriggerPredicate[];
  inputs: Record<string, string>;
  lastFiredAt?: number | null;
  // NEW:
  /** Shared secret for signature verification. Required when the trigger's
   *  plugin declares a `signature` block, unless `verifyOptional === true`. */
  secret?: string;
  /** Explicit opt-out from signature verification even when the plugin
   *  declares a `signature` block. Intended for local development / testing
   *  against a Frogo instance that has no subscription secret set. When
   *  true, the route accepts the request without checking the signature
   *  header and logs a one-line warning. */
  verifyOptional?: boolean;
}
```

### 3. Verification gate matrix — secure by default

| `plugin.signature` | `trigger.secret` | `verifyOptional` | Behavior |
|---|---|---|---|
| absent | — | — | No verification. Existing behavior. (Plugins like `github.json` that don't declare signing.) |
| present | set | — | **Verify.** Header missing → `401 bad-signature`. Mismatch → `401 bad-signature`. Valid → continue. |
| present | unset | `true` | Accept without verification. Log one-line warning per request: `[webhook] verifyOptional=true on trigger <id> — accepting unsigned request`. |
| present | unset | falsy | **Reject** at request time: `500 { error: 'trigger-misconfigured' }`. Log loudly. The trigger is in an invalid state — the plugin requires signing and the user has neither provided a secret nor explicitly opted out. |

The "plugin signed + no secret + no opt-out → reject" cell is the
substantive security change versus an earlier draft. Rationale: silently
accepting unverified signed-plugin payloads is the exact threat model
this spec was written to close. The opt-out flag preserves the
local-development path explicitly rather than implicitly.

**Defense in depth:** the trigger-store save path should also surface
this misconfiguration. When a trigger references a `pluginId` whose
plugin declares `signature`, and the trigger has no `secret` and
`verifyOptional !== true`, the create/update API should return
`422 { error: 'invalid-trigger', reason: 'secret-required' }`. This
keeps the broken trigger from ever being persisted; the request-time
`500` is the backstop for a trigger that pre-dates this validation
(e.g. authored by hand in workflow JSON).

### 4. Verification helper

New pure module `lib/server/webhook-signature.ts`:

```ts
export interface VerifyArgs {
  scheme: PluginSignature['scheme'];
  format: PluginSignature['format'];
  secret: string;
  bodyText: string;
  headerValue: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing-header' | 'malformed-header' | 'mismatch' | 'unsupported-scheme' };

export function verifySignature(args: VerifyArgs): VerifyResult;
```

Constant-time comparison via `crypto.timingSafeEqual`. The function is
pure — no I/O, no logging — so it's trivially unit-testable.

### 5. Route change

In `app/api/webhook/[triggerId]/route.ts`, insert verification between
the `eventHeader` check (currently at the top of `POST`) and the
predicate evaluation. Sequence becomes:

1. Look up trigger + plugin (unchanged).
2. `eventHeader` match (unchanged).
3. Read body (unchanged — the route already reads `req.text()` once).
4. **NEW — verification gate** (uses §3 matrix):
   - If `!plugin.signature` → skip verification.
   - Else if `trigger.secret` is set → call `verifySignature(...)`. On non-ok, return `401 { error: 'bad-signature' }` and log the granular reason from the verification helper.
   - Else if `trigger.verifyOptional === true` → log one-line warning and skip verification.
   - Else → return `500 { error: 'trigger-misconfigured' }` and log loudly. The trigger is invalid; save-time validation should have caught this, so emit at `error` level.
5. Build scope, evaluate predicates, queue (unchanged).

Body read order matters: verification must happen against the raw text
before any JSON parsing. The current route already reads `req.text()`
into `bodyText` before scope construction, so the order is naturally
correct.

### 6. `frogo.json`

```jsonc
{
  "id": "frogo",
  "displayName": "Frogo",
  "icon": "frogo",
  "eventHeader": "x-frogo-event",
  "signature": {
    "header": "x-frogo-signature",
    "scheme": "hmac-sha256",
    "format": "sha256=<hex>"
  },
  "events": [
    {
      "type": "task.created",
      "displayName": "Task created",
      "fields": [
        { "path": "body.event",                "type": "string" },
        { "path": "body.taskId",               "type": "number" },
        { "path": "body.timestamp",            "type": "string" },
        { "path": "body.payload.task.id",      "type": "number" },
        { "path": "body.payload.task.title",   "type": "string" },
        { "path": "body.payload.task.body",    "type": "string" },
        { "path": "body.payload.task.status",  "type": "string" },
        { "path": "body.payload.task.parentId","type": "number" },
        { "path": "body.payload.task.createdBy","type": "string" }
      ],
      "examplePayload": {
        "event": "task.created",
        "taskId": 42,
        "timestamp": "2026-05-13T12:00:00Z",
        "payload": {
          "task": {
            "id": 42,
            "title": "Triage incoming bug report",
            "body": "Repro on staging…",
            "status": "todo",
            "parentId": null,
            "createdBy": "alice"
          }
        }
      }
    },
    {
      "type": "task.updated",
      "displayName": "Task updated",
      "fields": [
        { "path": "body.event",                "type": "string" },
        { "path": "body.taskId",               "type": "number" },
        { "path": "body.payload.task.id",      "type": "number" },
        { "path": "body.payload.task.title",   "type": "string" },
        { "path": "body.payload.task.status",  "type": "string" },
        { "path": "body.payload.task.assignees","type": "array" }
      ],
      "examplePayload": {
        "event": "task.updated",
        "taskId": 42,
        "timestamp": "2026-05-13T12:01:00Z",
        "payload": {
          "task": { "id": 42, "title": "Triage incoming bug report", "status": "in_progress", "assignees": ["bob"] }
        }
      }
    },
    {
      "type": "task.deleted",
      "displayName": "Task deleted",
      "fields": [
        { "path": "body.event",           "type": "string" },
        { "path": "body.taskId",          "type": "number" },
        { "path": "body.payload.task.id", "type": "number" }
      ],
      "examplePayload": {
        "event": "task.deleted",
        "taskId": 42,
        "timestamp": "2026-05-13T12:05:00Z",
        "payload": { "task": { "id": 42, "title": "Triage incoming bug report" } }
      }
    },
    {
      "type": "task.commented",
      "displayName": "Task commented",
      "fields": [
        { "path": "body.event",                  "type": "string" },
        { "path": "body.taskId",                 "type": "number" },
        { "path": "body.payload.task.id",        "type": "number" },
        { "path": "body.payload.comment.id",     "type": "number" },
        { "path": "body.payload.comment.body",   "type": "string" },
        { "path": "body.payload.comment.author", "type": "string" }
      ],
      "examplePayload": {
        "event": "task.commented",
        "taskId": 42,
        "timestamp": "2026-05-13T12:10:00Z",
        "payload": {
          "task": { "id": 42, "title": "Triage incoming bug report" },
          "comment": { "id": 7, "body": "Found root cause in cache layer.", "author": "alice" }
        }
      }
    },
    {
      "type": "ping",
      "displayName": "Ping (test)",
      "fields": [
        { "path": "body.event",            "type": "string" },
        { "path": "body.payload.message",  "type": "string" }
      ],
      "examplePayload": {
        "event": "ping",
        "taskId": null,
        "timestamp": "2026-05-13T12:00:00Z",
        "payload": { "message": "Webhook test from Frogo" }
      }
    }
  ]
}
```

## Files touched

- `webhook-plugins/frogo.json` — new
- `lib/shared/trigger.ts` — add `PluginSignature` type, optional `WebhookPlugin.signature`, optional `WebhookTrigger.secret` and `WebhookTrigger.verifyOptional`
- `lib/server/webhook-plugins/loader.ts` — validate the optional `signature` block; normalize `signature.header` and `eventHeader` to lowercase at load time
- `lib/server/webhook-plugins/loader.test.ts` — extend with signature-block validation cases
- `lib/server/webhook-signature.ts` — new pure verification helper
- `lib/server/webhook-signature.test.ts` — new unit tests
- `app/api/webhook/[triggerId]/route.ts` — insert verification gate after body read, before scope construction; emit `500 trigger-misconfigured` for the secret-required-but-missing case
- `app/api/webhook/[triggerId]/route.test.ts` — extend with signed-request cases (good, bad, missing header, misconfigured trigger, verifyOptional)
- `app/api/triggers/route.ts` and `app/api/triggers/[id]/route.ts` — save-time validation rejecting misconfigured triggers (422)
- `docs/superpowers/specs/2026-05-14-frogo-webhook-plugin-design.md` — this document

## Validation plan

**Unit tests (`webhook-signature.test.ts`):**
- Valid signature, `sha256=<hex>` format → ok.
- Tampered body → mismatch.
- Wrong secret → mismatch.
- Missing header → missing-header.
- Header without `sha256=` prefix when format requires it → malformed-header.
- Unsupported scheme value → unsupported-scheme.
- Constant-time compare: indirectly via `timingSafeEqual` usage check.

**Integration tests (route):**
- Frogo plugin + secret + correctly signed request → 202.
- Frogo plugin + secret + bad signature → 401 `bad-signature`.
- Frogo plugin + secret + missing signature header → 401 `bad-signature`.
- Frogo plugin + no secret + `verifyOptional: true` → 202 + warning logged.
- Frogo plugin + no secret + `verifyOptional: false` (or unset) → 500 `trigger-misconfigured`.
- GitHub plugin (no `signature` block) → 202 unchanged regardless of trigger secret/opt-out fields.

**Loader tests (`loader.test.ts`):**
- Plugin with valid `signature` block loads.
- Plugin with `scheme !== 'hmac-sha256'` rejected.
- Plugin with unknown `format` rejected.
- `signature.header` and `eventHeader` are lowercased after load.

**Trigger save-time validation tests:**
- Create trigger with `pluginId: "frogo"` + no secret + no `verifyOptional` → 422 `invalid-trigger / secret-required`.
- Same trigger with `verifyOptional: true` → accepted.
- Same trigger with `pluginId: "github"` (no signature block) + no secret → accepted unchanged.

**Manual:**
1. Run Frogo locally (`docker-compose up` in `frogo/`).
2. Run InfLoop locally.
3. Author a workflow with a webhook trigger: `pluginId: "frogo"`, `eventType: "task.created"`, plus a fresh `secret`.
4. In Frogo's `/admin/webhooks`, register a subscription pointing at the InfLoop trigger URL with the same secret.
5. Create a task in Frogo; confirm the InfLoop run queues with the templated input populated from `body.payload.task.title`.
6. Edit the secret in InfLoop to a wrong value; create another task; confirm Frogo's delivery log shows 401.

## Risks

- **Header case sensitivity.** The plugin schema convention is lowercase header names (matches `eventHeader: "x-github-event"` in `github.json`). Enforce this at load time in `validatePlugin` rather than relying on runtime convention: lowercase both `eventHeader` and `signature.header`. `req.headers.get()` in Next.js is already case-insensitive, so this normalization is for downstream consumers and for any direct `headers[key]`-style access.
- **Body double-read.** The route already reads `req.text()` once into `bodyText`; verification reuses the same string. No regression risk so long as the verification call sits between the body read (current line ~61) and scope construction (current line ~69).
- **Constant-time compare on mismatched lengths.** `timingSafeEqual` throws on length mismatch. Wrap with an explicit length check that returns `mismatch` instead of letting the throw leak via timing.
- **Plugin index cache.** `pluginIndex` (`lib/server/webhook-plugins/index.ts`) is a process-level singleton with no file watcher. Adding a `signature` block to an existing plugin file requires restart or explicit `invalidate()` — unchanged from today's plugin-edit story; worth noting because the security posture of a trigger depends on the cached plugin state.
- **Information leak in 401.** Both "header missing" and "signature mismatch" return the same `401 bad-signature` body — intentional, so we don't help an attacker distinguish "I sent the right header name" from "my secret is wrong". Internal logs record the granular reason via the verification helper's tagged-union result.

## Open questions for review

None blocking. The gate-matrix flip in §3 (reject-by-default when the
plugin declares signing, explicit `verifyOptional` to opt out) was the
substantive design call from review; it is documented above.
