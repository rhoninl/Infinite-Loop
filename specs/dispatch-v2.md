# Dispatch v2 — UI-managed triggers with webhook-source plugins

**Status:** Design
**Author:** rhoninlee (with Claude)

## Problem

v1 webhook triggers ([webhook-trigger.md](webhook-trigger.md))
shipped with two friction points:

1. **JSON-only authoring.** Every trigger requires hand-editing a workflow's
   JSON file: generate a random id, write predicates, map inputs, reload the
   browser. The read-only TriggersPanel can display a trigger and copy its
   URL, but it can't create, edit, or delete one.
2. **Generic predicates only.** The predicate editor (when it exists) has no
   knowledge of GitHub, Stripe, Linear, or any other webhook source. Users
   have to remember that GitHub's event type lives at `headers.x-github-event`,
   that a push body has `body.ref` and `body.after`, that an issue body has
   `body.issue.number`. Authoring triggers feels like reading source code.

A real user-facing trigger management story needs both: a dedicated UI for
CRUD, AND service-aware authoring assistance so users can pick "GitHub →
issues → body.issue.number" from a dropdown instead of typing template
expressions from memory.

## Goal

A new **Dispatch** section in the app where users manage every webhook
trigger across all workflows, with a CRUD form that's driven by a
**plugin system**. Each plugin describes a webhook source (GitHub, etc.)
and exposes a list of events with their available fields. The trigger
editor uses that schema to populate field pickers, so predicate and
input authoring is point-and-click for known sources, while a Generic
plugin retains the v1 free-form templating for unknown sources.

The change also fixes a real bug surfaced during v1 testing: webhook
templating always produces strings, so a workflow input declared
`type: 'number'` or `type: 'boolean'` cannot be fed by a webhook
trigger today. `resolveRunInputs` learns to coerce numeric and boolean
strings.

## Non-goals

- **HMAC / signed-webhook verification** (GitHub `X-Hub-Signature-256`,
  Stripe `Stripe-Signature`). The plugin JSON format is shaped to
  accept a `verify` extension later without a breaking change. v2
  remains URL-as-credential.
- **Persisted queue / restart durability.** Still in-memory.
- **Per-trigger rate limits** beyond the existing 100-item cap.
- **Stripe / Linear / Discord plugins.** Ship `generic` and `github` in
  v2; other plugins are follow-up issues that drop a JSON file in.
- **Code-based plugins** (TS modules with `verify` hooks). Pure JSON
  for v2.
- **A trigger-template library** (pre-built triggers a user can drop
  in). Worth doing later.

## Decisions made during brainstorming

- **Editor home:** new top-level "Dispatch" section, accessed from a
  top-bar button next to the workflow menu. Swaps the canvas + right-panel
  area for a list + form split-pane. URL hash (`#dispatch`) persists state.
- **Data model:** triggers move *out* of workflow JSON entirely into a
  top-level `triggers/<id>.json` registry. Each trigger gains a
  `workflowId` pointer. The existing per-workflow TriggersPanel becomes
  a small summary card linking into the Dispatch view.
- **Migration:** automatic on workflow load. Legacy `wf.triggers[]`
  entries are copied to the registry; the field is dropped from the
  in-memory workflow and persisted-clean on next save. Idempotent.
- **Plugin format:** JSON files under `webhook-plugins/`, mirroring the
  existing `providers/` pattern. Two built-ins: `generic` (no schema)
  and `github` (push, pull_request, issues, issue_comment).
- **Coercion fix:** `resolveRunInputs` accepts numeric / boolean strings
  for inputs declared `number` / `boolean`. Single source of truth
  change; works for every webhook → typed input case.
- **Test fire:** a per-trigger "Test" button that POSTs a user-edited
  JSON payload through the real `/api/webhook/<id>` route (via a small
  `/api/triggers/:id/test` adapter). Response status + body shown
  inline.

## Design

### 1. Plugin format

A plugin is a JSON file under `webhook-plugins/<id>.json`, loaded once
at server startup.

```jsonc
{
  "id": "github",
  "displayName": "GitHub",
  "icon": "github",
  // Header that selects which event[i] to use. When set, the webhook
  // route requires headers[eventHeader] == event.type BEFORE evaluating
  // the user's match[] predicates. When unset, no implicit filter.
  "eventHeader": "x-github-event",
  "events": [
    {
      "type": "push",
      "displayName": "Push",
      "fields": [
        { "path": "body.ref",                          "type": "string", "description": "Git ref pushed (e.g. refs/heads/main)" },
        { "path": "body.after",                        "type": "string", "description": "Commit SHA after the push" },
        { "path": "body.repository.full_name",         "type": "string", "description": "owner/repo" },
        { "path": "body.head_commit.author.name",      "type": "string" },
        { "path": "body.head_commit.message",          "type": "string" },
        { "path": "body.commits",                      "type": "array",  "description": "All commits in this push" }
      ],
      "examplePayload": { "ref": "refs/heads/main", "after": "abc123", "head_commit": { "author": { "name": "you" }, "message": "x" }, "repository": { "full_name": "owner/repo" } }
    },
    {
      "type": "issues",
      "displayName": "Issue",
      "fields": [
        { "path": "body.action",               "type": "string", "description": "opened, closed, edited, …" },
        { "path": "body.issue.number",         "type": "number" },
        { "path": "body.issue.title",          "type": "string" },
        { "path": "body.issue.body",           "type": "string" },
        { "path": "body.issue.user.login",     "type": "string" },
        { "path": "body.repository.full_name", "type": "string" }
      ],
      "examplePayload": { "action": "opened", "issue": { "number": 1, "title": "Hi", "body": "…", "user": { "login": "you" } }, "repository": { "full_name": "owner/repo" } }
    }
    // pull_request and issue_comment defined similarly
  ]
}
```

The **Generic plugin** has no `eventHeader`. It declares a single
synthetic event `"type": "any"` with an empty `fields` array. The
trigger form falls back to a free-form template-string input.

```jsonc
{
  "id": "generic",
  "displayName": "Generic",
  "icon": "generic",
  "events": [ { "type": "any", "displayName": "Any POST", "fields": [] } ]
}
```

**Plugin loader:** `lib/server/webhook-plugins/index.ts` scans the
`webhook-plugins/` directory at module load, validates each entry, and
exposes a singleton `pluginIndex` with `lookup(id)`, `list()`, and
`invalidate()` (for tests). Validation rules:

- `id` matches `^[a-z][a-z0-9_-]*$`
- `events[].type` is a non-empty string, unique within the plugin
- if `eventHeader` is set, every event's `type` must be a header value
  the source can plausibly emit (we don't enforce semantics — just
  string non-empty)
- `fields[].path` is non-empty; `type` is one of `string | number | boolean | array | object`

A plugin that fails validation is skipped with a console error;
startup continues. The Generic plugin is always present (built-in).

**Plugin shape, exported from `lib/shared/trigger.ts`:**

```ts
export interface PluginField {
  path: string;            // e.g. "body.issue.number"
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
}

export interface PluginEvent {
  type: string;            // e.g. "issues"; matched against the header value
  displayName: string;
  fields: PluginField[];
  examplePayload?: unknown;
}

export interface WebhookPlugin {
  id: string;
  displayName: string;
  icon?: string;
  eventHeader?: string;
  events: PluginEvent[];
}
```

### 2. Trigger data model and storage

```ts
// lib/shared/trigger.ts
export interface TriggerPredicate {
  lhs: string;
  op: '==' | '!=' | 'contains' | 'matches';
  rhs: string;
}

export interface WebhookTrigger {
  id: string;                  // URL slug; ^[A-Za-z0-9_-]{16,32}$
  name: string;
  enabled: boolean;
  workflowId: string;          // points at a saved workflow
  pluginId: string;            // "generic" | "github" | …
  eventType?: string;          // required when plugin has eventHeader
  match: TriggerPredicate[];
  inputs: Record<string, string>;
  lastFiredAt?: number | null;
  createdAt: number;
  updatedAt: number;
}
```

`WebhookTrigger`, `TriggerPredicate`, and the plugin types live in a
new `lib/shared/trigger.ts`. `lib/shared/workflow.ts` drops the
`triggers?: WebhookTrigger[]` field and the trigger types but **keeps**
the three `trigger_*` event variants on the `WorkflowEvent` union
(they're still emitted by the queue and consumed by the UI).

**Storage:** new directory `triggers/` (override via
`INFLOOP_TRIGGERS_DIR`). One file per trigger named `<id>.json`. Atomic
writes via `<id>.json.tmp` + rename. No separate index file; listing
scans the directory.

**`lib/server/trigger-store.ts`** mirrors `workflow-store.ts`:

| Function | Behavior |
|---|---|
| `listTriggers()` | Read directory; parse each `*.json`; return full records. |
| `getTrigger(id)` | Read one. Throws `trigger not found: <id>` on ENOENT. |
| `saveTrigger(t)` | Validate (see below); generate timestamps; atomic write; `triggerIndex.invalidate()`. |
| `deleteTrigger(id)` | Unlink; `triggerIndex.invalidate()`. |

`saveTrigger` validation (all errors include the trigger id and a short
reason; the API maps them to 4xx codes):

- `id` matches the slug regex; uniqueness via filesystem check (no separate index)
- `pluginId` exists in the loaded plugin map
- if the plugin has `eventHeader`, `eventType` must be set and equal to
  one of the plugin's declared `events[].type`; conversely if the
  plugin has no `eventHeader`, `eventType` is optional / ignored
- `workflowId` resolves via `workflow-store.getWorkflow` (a load is
  cheap; we accept the cost on save)
- every `match[i].op` ∈ `{==, !=, contains, matches}`; `lhs`, `rhs` are strings
- `inputs` is `Record<string, string>`; keys are a subset of the target
  workflow's declared `inputs[].name`

**Trigger index:** the existing `lib/server/trigger-index.ts` is
gutted. It now reads from `trigger-store.listTriggers()` instead of
scanning workflows, and exposes `lookup(id)` with the same `cache +
invalidate` pattern. `trigger-store` invalidates on every mutation.

**Migration:** the existing `migrateWorkflow` helper in
`workflow-store.ts` gains one step. On every load, if the parsed
workflow has a `triggers` array:

1. For each entry, fill in defaults: `workflowId = wf.id`, `pluginId =
   'generic'`, `createdAt = updatedAt = Date.now()`, drop any
   `lastFiredAt`. Predicates and input mappings carry over verbatim.
2. Call `trigger-store.saveTrigger` for each. If a trigger with the
   same id already exists in the registry (because we ran before),
   skip it; the registry wins.
3. Remove the `triggers` field from the in-memory workflow object.

The disk file gets rewritten without `triggers` on the next
`saveWorkflow`. Idempotent: reloading an already-migrated workflow has
no triggers to copy. Failures during migration are logged but don't
fail the workflow load — the user can still open the workflow even if
a stale trigger entry is malformed.

### 3. Backend API surface

**Trigger CRUD (new):**

| Route | Behavior |
|---|---|
| `GET /api/triggers` | List all triggers. Supports `?workflowId=<id>` filter (server-side). `requireAuth`. |
| `POST /api/triggers` | Create. Body is the `WebhookTrigger` minus `id`/`createdAt`/`updatedAt`. Server generates `id = crypto.randomBytes(16).toString('base64url')` and timestamps. Returns the saved record. Validates via `saveTrigger`. |
| `GET /api/triggers/:id` | Fetch one. |
| `PUT /api/triggers/:id` | Update. Server preserves `createdAt`, bumps `updatedAt`. Caller can't change the `id`. |
| `DELETE /api/triggers/:id` | Remove. |

All four wrap `saveTrigger` errors into `400 invalid-trigger` with the
violation reason, or `404 not-found` for missing ids.

**Plugin discovery (new):**

| Route | Behavior |
|---|---|
| `GET /api/webhook-plugins` | Returns `{ plugins: WebhookPlugin[] }` — the full loaded plugin list with their event schemas. `requireAuth`. |

**Test fire (new):**

| Route | Behavior |
|---|---|
| `POST /api/triggers/:id/test` | Body: `{ payload?: unknown, headers?: Record<string, string> }`. Server constructs a synthetic `Request` (POST to the real webhook URL with the supplied body and headers) and re-uses the existing webhook route handler. Returns `{ status, body }`. `requireAuth`. |

The test path goes through the **same** webhook handler as a real
request. This is deliberate: it guarantees test and real-fire behavior
stay identical. The only divergence: the test route is auth-gated
(callers must already be authenticated to the management API), whereas
real webhook hits are URL-as-credential.

**Webhook route changes (`app/api/webhook/[triggerId]/route.ts`):**

After looking up the trigger, before evaluating `match[]`:

1. Load the trigger's plugin via `pluginIndex.lookup(trigger.pluginId)`.
   Plugin missing → log + return `404 not-found` (same body as
   unknown-trigger; don't leak the failure mode).
2. If the plugin has `eventHeader`, read the corresponding header from
   the request. Empty header value or mismatch with `trigger.eventType`
   → `204 No Content` (same as a user-predicate miss).
3. Evaluate the user's `match[]` predicates as in v1.

The implicit event-header filter is the only behavioral change.

**`/api/triggers/queue` and `/api/run` unchanged.**

**Workflow store / route changes:**

- `GET /api/workflows/:id` no longer returns `triggers[]` (the field
  is gone from the type). UI reads triggers from `/api/triggers`.
- `workflow-store.ts` drops `validateTriggers` and
  `validateNoCrossWorkflowTriggerCollisions`. Those checks move into
  `trigger-store.saveTrigger`.
- `workflow-store.ts` no longer invalidates `triggerIndex` — that's
  now `trigger-store`'s job.

**`resolveRunInputs` coercion fix
(`lib/shared/resolve-run-inputs.ts`):**

For an input declared `type: 'number'`, if `supplied[name]` is a
string and `Number(raw)` is `Number.isFinite`, accept the parsed
number. Otherwise throw the existing type error.

For an input declared `type: 'boolean'`, if `supplied[name]` is a
string and equals `'true'` or `'false'` case-insensitive, accept the
parsed boolean. Otherwise throw.

For `string` and `text`, behavior unchanged.

JS callers that pass native `number` / `boolean` continue to work —
the type check happens before the string-fallback path.

### 4. UI

#### 4a. Top-bar entry

`app/page.tsx` adds a "Dispatch" button next to the existing workflow
menu. Active state styling matches the workflow menu. Clicking the
button sets `window.location.hash = '#dispatch'`; the page reads the
hash to decide whether to render the canvas or the `<DispatchView>`.
Switching back is a click on a "Editor" toggle in the same row or any
workflow-menu interaction.

The TriggersPanel inside ConfigPanel (workflow-root settings) shrinks
to a 2-line summary card:

```
3 triggers route here.   [Manage in Dispatch →]
```

The link sets hash to `#dispatch?workflow=<id>` so Dispatch opens
filtered to that workflow. The `lastFiredAt` live-overlay from v1 is
preserved — the summary card still shows the most-recent fire across
all this workflow's triggers.

#### 4b. Dispatch view layout

`app/components/DispatchView.tsx` renders a master/detail split:

- **List pane** (left, ~40% width): scrollable list of triggers. Each
  row shows: name, enabled chip, plugin · event, target workflow,
  webhook URL with copy button, last-fired-at, and a `[···]` row menu
  (Edit / Test / Delete). Filter input at the top (matches name,
  plugin, workflow). When a row is selected, the detail pane shows the
  trigger's read view; click Edit to switch to the form.
- **Detail / form pane** (right, ~60% width):
  - When nothing is selected: a friendly empty state with `+ New trigger`.
  - When a trigger is selected and the user is in read mode: the same
    fields shown as read-only, plus Edit / Delete / Test buttons.
  - When the user clicks `+ New` or Edit: the form (Section 4c).

The view subscribes to the existing SSE bus and updates `lastFiredAt`
on the matching row when a `trigger_started` event arrives.

#### 4c. Trigger form

`app/components/TriggerForm.tsx`:

```
Name           [github-issue-opened             ]
Plugin         [GitHub               ▼]    Event [issues  ▼]
Target         [code-review          ▼]
URL            http://localhost:3000/api/webhook/xOsm…89A  [regen]

Match (all must pass)                          + Add predicate
  ┌────────────────────────────────────────────────────────────┐
  │ [body.action ▼]  [== ▼]  [opened           ]          [×]  │
  │ [body.issue.user.login ▼]  [matches ▼]  [^rhonin]     [×]  │
  └────────────────────────────────────────────────────────────┘

Inputs (from workflow)
  ┌─────────────────────────────────────────────────────┐
  │ issue_number   [{{body.issue.number}}        ▼]      │
  │ issue_title    [{{body.issue.title}}         ▼]      │
  │ author         [{{body.issue.user.login}}    ▼]      │
  │ repo           [{{body.repository.full_name}}▼]      │
  └─────────────────────────────────────────────────────┘

[Save trigger]   [Cancel]
```

**Field picker (`app/components/FieldPicker.tsx`):** a reusable
text-input + dropdown combo that:

- Accepts `fields: PluginField[]` and a current value (a templated
  string like `"{{body.issue.number}}"`).
- The dropdown lists the available field paths formatted as
  `{{<path>}}` plus an "Add custom path…" affordance that lets the
  user free-form a `{{...}}` expression for paths the plugin schema
  doesn't enumerate.
- Selecting an option replaces the input's value with `{{<path>}}`.
- When the user has typed a custom expression that doesn't match any
  declared field, the dropdown shows a small "Not in schema (warning)"
  hint but accepts the value.
- Implementation note: the dropdown component pattern already exists
  in `SelectMenu` — re-skin it with autocomplete filtering on the
  `path` and `description` strings.

**Form mechanics:**

- Plugin select uses `SelectMenu`. Changing the plugin clears the
  Event picker.
- Event select uses `SelectMenu`. Hidden for plugins with no
  `eventHeader` (Generic).
- Target select uses `SelectMenu`, list from `GET /api/workflows`.
  Changing the target re-renders the Inputs grid against the new
  workflow's `inputs[]`.
- Match section: each predicate row is `lhs <FieldPicker>` + `op
  <SelectMenu>` + `rhs <input>` + delete button. `+ Add predicate`
  appends an empty row.
- Inputs section: one row per declared workflow input (label = input
  name; right side is a `<FieldPicker>` for the templated value).
  Unset rows keep their template empty; on save, empty strings are
  omitted from `trigger.inputs` so the workflow's `default` applies.
- Regenerate id: button next to the URL. Confirms (typed
  `"regenerate"`) before swapping the id. Since `PUT /api/triggers/:id`
  can't change the id, regeneration is a client-side compound: the
  form `POST`s a new trigger with the same body but a fresh id, then
  `DELETE`s the old one. If either step fails, the form surfaces the
  error and stays editable; the rotation is best-effort, not
  transactional. Document: the old URL stops working as soon as the
  DELETE succeeds.
- Validation surfaces from the API on save are mapped to inline
  errors next to the offending field.

**Test-fire modal (`app/components/TestFireModal.tsx`):** opens when
the user clicks Test on a row.

```
Test fire — github-issue-opened

Headers
  x-github-event: [issues                                  ]

Payload (JSON)
  ┌─────────────────────────────────────────────────────┐
  │ { "action": "opened", "issue": { ... } }            │
  └─────────────────────────────────────────────────────┘
[Pre-fill example]   [Send]

Response
  202 { "queued": true, "queueId": "q-…", "position": 1 }
```

`Pre-fill example` populates the JSON editor from the chosen plugin
event's `examplePayload` (so users start with a real-looking GitHub
issue payload). `Send` POSTs to `/api/triggers/:id/test`; the modal
shows status + body. Sending a 202 also updates `lastFiredAt` in the
list (because the underlying real route emits `trigger_enqueued`).

#### 4d. Styling

- New CSS block in `app/globals.css`:
  - `dsp-*` for the Dispatch container, list, row, detail pane, empty
    state.
  - `trg-form-*` for the form fields, predicate rows, inputs grid,
    test-fire modal.
  - Reuse existing tokens (`--bg-elevated`, `--border`, `--border-strong`,
    `--bg-input`, `--accent-ok`, `--fg`, `--fg-soft`, `--fg-dim`,
    `--mono`).
- No HeroUI, no inline `style={}` for layout/color/spacing/border
  (project rule). Native form controls get the project's existing
  semantic-class CSS treatment.
- `SelectMenu` is reused everywhere instead of `<select>`.

### 5. Edge cases & contracts

| Case | Behavior |
|---|---|
| Workflow deleted while triggers still reference it | The triggers stay in the registry but `saveTrigger` would now reject a no-op update. On webhook hit, `getWorkflow` throws and the existing webhook route returns 404. The Dispatch list flags those triggers visually ("Workflow missing") and offers a delete shortcut. |
| Trigger references a plugin id that no longer exists (someone removed the JSON file) | Save fails 400; webhook hit returns 404; Dispatch list shows "Plugin missing". |
| Plugin schema changes a field path between versions | Existing trigger keeps working — the template string is opaque to the engine. The FieldPicker shows a warning icon next to the affected predicate so the user can fix it. |
| Trigger with `eventType` set but plugin no longer has `eventHeader` | Treated as the plugin filter being permissive; we just don't enforce it. The user can clean up in the form. |
| User regenerates an id, but the old `triggerId` is still in flight via a queued run | The queue holds the workflow snapshot, not the trigger id, so in-flight runs complete. The new URL is active immediately; the old one returns 404. |
| Test-fire from the UI saturating the queue | `/api/triggers/:id/test` shares the queue cap with real fires; a 503 from the test surfaces in the modal like any other status. |
| Migration encounters a malformed `triggers[]` entry on a legacy workflow | Log a warning, skip that entry, continue migrating the rest. Don't fail the workflow load. |

### 6. Tests

- **Unit:**
  - `trigger-store.test.ts` — CRUD, id validation, plugin/event/workflow refs, atomic writes, list filtering.
  - `webhook-plugins/index.test.ts` — plugin file scan, invalid plugin rejection, Generic always present.
  - `resolve-run-inputs.test.ts` — extend with numeric/boolean string coercion cases (valid, invalid, edge values).
  - `field-picker.test.ts` — autocomplete filter, "custom path" affordance, value formatting.
- **Migration:** load a workflow with legacy `triggers[]`; assert
  triggers appear in the registry; reload and assert idempotency.
- **Route:**
  - `/api/triggers` CRUD + `?workflowId=` filter.
  - `/api/webhook-plugins` list shape.
  - `/api/triggers/:id/test` — happy 202, predicate-miss 204,
    invalid-trigger 404.
  - Updated `/api/webhook/[triggerId]` — plugin-event-header filter
    fires before user predicates; mismatch → 204.
- **UI:**
  - `DispatchView` — list renders triggers, row selection, filter
    input, live `lastFiredAt` update via SSE.
  - `TriggerForm` — plugin/event/target wiring, Inputs grid renders
    from chosen workflow, predicate add/remove, save calls correct API
    endpoint.
  - `TestFireModal` — example pre-fill, send, response render.
- **Integration:** end-to-end GitHub-issues plugin path: write plugin
  + trigger + workflow files; hit `/api/webhook/<id>` with a real
  issues payload; assert `trigger_enqueued` emits and the run starts
  with the right inputs.

## Out of scope (follow-ups)

- HMAC verification (GitHub, Stripe, etc.) — plugin format is shaped
  to accept a `verify` hook later.
- Durable queue (survives restart).
- Per-trigger rate limits.
- Trigger-template library.
- Stripe / Linear / Discord plugins beyond a follow-up.
- Code-based plugins (TS modules with custom logic).
