# Begin-Node Inputs

**Status:** Design
**Author:** rhoninlee (with Claude)

## Problem

The Begin (Start) node is the entry point of every workflow but accepts no
configuration. As a result, a workflow cannot be parameterized: there is no
way for a caller — whether a human clicking **Run**, an HTTP client hitting
`/api/run`, or a parent workflow invoking a subworkflow — to supply
per-run values.

Today the only workflow-level variables are `globals`, which are static
constants embedded in the workflow JSON. They are good for configuration
(API URLs, default models) but wrong for per-run inputs (a topic, a
target URL, a max-iteration count) because they require editing the
workflow JSON before each run.

## Goal

Let a workflow declare typed inputs once, at the workflow root, and let
callers supply per-run values that flow into the scope as `{{inputs.NAME}}`.

A single declaration covers both call paths:

- **Programmatic** — `/api/run` and the subworkflow executor pass inputs as
  a `Record<string, value>`.
- **Interactive** — the UI prompts the user via a modal when the workflow
  declares inputs without defaults.

## Non-goals

- Secret/credential inputs (masked entry, encrypted storage).
- Enum/choice input types.
- Per-input validation rules (regex, min/max, length).
- Replay UX (re-running a past run with the same inputs).
- Replacing or unifying `globals`. Globals remain as static workflow
  constants; inputs are a parallel, per-run concept.

## Design

### Data model

A new field on the workflow root:

```ts
// lib/shared/workflow.ts
interface WorkflowInputDecl {
  /** Identifier used in templates as {{inputs.NAME}}. Must match
   *  /^[a-zA-Z_][a-zA-Z0-9_]*$/ and be unique within the workflow. */
  name: string;
  /** 'text' is multiline string. Others map to typed form widgets. */
  type: 'string' | 'number' | 'boolean' | 'text';
  /** If omitted, the input is required: callers must supply a value or
   *  the run is rejected before it starts. */
  default?: string | number | boolean;
  /** Human-readable description shown in the editor and the run modal. */
  description?: string;
}

interface Workflow {
  // ...existing fields...
  globals?: Record<string, string>;
  inputs?: WorkflowInputDecl[];   // NEW — ordered list
}
```

Stored as an ordered array, not a map, so:

- The UI form has a stable display order under the author's control.
- JSON diffs are clean when reordering.
- Subworkflow callers can introspect the schema in order.

Run-time values are flat: `Record<string, string | number | boolean>`
keyed by `name`.

### Engine & scope

`workflow-engine.ts` currently seeds `globals` into the top-level scope
(see line ~131). `inputs` get the same treatment under a separate key.

Resolution happens **outside** the engine, at the call site (API route or
subworkflow executor). The engine receives an already-resolved
`Record<string, string | number | boolean>` and seeds it verbatim:

```ts
// engine entry — values are already resolved by the caller
const seedScope: Scope = {};
if (workflow.globals) seedScope.globals = { ...workflow.globals };
if (resolvedInputs) seedScope.inputs = resolvedInputs;
```

`resolveRunInputs(declared, supplied)` lives in `lib/shared/` so it can be
called from the API route, the subworkflow executor, and the client-side
run modal. It:

1. For each declared input: picks `supplied[name]` if present, otherwise
   `default`.
2. If still missing → throws `WorkflowInputError('required', name)`.
3. Type-checks the resolved value:
   - `number`: must be a finite JS number.
   - `boolean`: must be `true` or `false`.
   - `string` / `text`: must be a string.
   - Mismatch → throws `WorkflowInputError('type', name, { expected, got })`.
4. Unknown keys in `supplied` not in the declared list are dropped with a
   server-side warning log. This is forward-compatible with input renames
   and doesn't fail callers that pass stale fields.

The Start node executor stays a no-op. Declarations live on the workflow
root; the Start node's config panel is just the editor surface for
`workflow.inputs`.

### Template autocomplete

`lib/shared/template-refs.ts` already emits suggestions for `globals.NAME`.
It gains a parallel block that iterates `workflow.inputs` and emits
`{ ref: 'inputs.<name>', nodeId: 'inputs' }` references, so the in-editor
`{{...}}` autocomplete surfaces declared inputs.

The same file's reference-validation path (`'missing-global'` branch)
gains a sibling `'missing-input'` branch so unresolved `{{inputs.X}}`
references are reported when `X` isn't declared.

### Run trigger: API

`POST /api/run` body extends to:

```ts
{ workflowId: string, inputs?: Record<string, string | number | boolean> }
```

Server flow:

1. Load workflow.
2. Call `resolveRunInputs(workflow.inputs ?? [], body.inputs ?? {})`.
3. On `WorkflowInputError` → respond:
   ```
   400 { error: 'invalid-inputs', field: string, reason: 'required' | 'type',
         expected?: string, got?: string }
   ```
   No run row is written.
4. On success → seed the scope and start the run as today.

### Run trigger: UI

In `app/page.tsx#handleRun`:

```ts
const declared = currentWorkflow.inputs ?? [];
const needsPrompt = declared.some(i => i.default === undefined);

if (needsPrompt || userForcedModal) {
  openRunInputsModal(declared);   // prefilled with defaults
} else {
  POST /api/run { workflowId }    // server applies defaults
}
```

A new `RunInputsModal` component renders one field per declared input,
chosen by type:

- `string` → single-line text input
- `text`   → textarea
- `number` → number input
- `boolean`→ switch / checkbox

Defaults are prefilled. Submit posts to `/api/run`; cancel does not start
a run.

A secondary affordance — a chevron menu next to the Run button with a
"Run with inputs…" entry — lets the user force the modal even when all
inputs have defaults, so they can override per run.

### Begin-node config panel

The Begin-node config panel in `ConfigPanel.tsx` becomes the editor for
`workflow.inputs`. Layout mirrors the existing globals editor for
consistency: an ordered list of rows with name / type / default /
description, plus add and delete.

Editor-time validation:

- `name` matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/` and is unique.
- `default`, if non-empty, parses against `type`.
- Empty `name` marks the row invalid.

Any invalid row disables save with an inline error.

### Subworkflow callers

The subworkflow executor already passes `inputs` into a child workflow
under `__inputs` (see `workflow-engine.ts` line ~736). With this change,
the child workflow's scope should see the same values under `inputs.NAME`
to match the new top-level convention.

**Open question for implementation:** alias `__inputs` to `inputs`, or
keep `__inputs` and additionally seed `inputs` from the same data?
Either preserves backward compatibility for existing subworkflow JSONs.
The plan will pick one; both are mechanically simple.

### Validation summary

`resolveRunInputs` is the single source of truth and runs in three
places — all sharing the same module:

- API route (`/api/run`) — before creating a run row.
- Subworkflow executor — before recursing into the child workflow.
- Run modal (client) — for per-field inline errors as the user types.

Editor-time validation in the config panel is separate and concerns the
*schema* (declarations themselves), not values.

### Errors

- API: `400 invalid-inputs { field, reason, expected?, got? }` — no run
  row created, no partial state.
- UI modal: per-field inline errors derived from the same validator;
  modal stays open on failure.
- Run history: nothing to show; the run never started.

## Testing plan

- `lib/shared/resolve-run-inputs.test.ts` — defaults, coercion, required,
  type mismatch, unknown-key warning.
- `lib/server/workflow-engine.test.ts` — `inputs` seeded into scope;
  `{{inputs.foo}}` resolves; missing-required aborts before a run row is
  written.
- `app/api/run/route.test.ts` — POST body validation, `400` shapes,
  success path.
- `app/components/ConfigPanel.test.tsx` — add/remove/edit input rows;
  duplicate-name and invalid-default validation.
- `app/components/RunInputsModal.test.tsx` — renders correct widget per
  type, prefills defaults, blocks submit on invalid, posts to `/api/run`.
- `lib/shared/template-refs.test.ts` — autocomplete surfaces
  `inputs.NAME`; `'missing-input'` reported for undeclared references.

## Migration

- Existing workflows without `inputs` are unaffected — the field is
  optional and absent in current JSON.
- `/api/run` callers that send only `{ workflowId }` keep working when
  the workflow declares no required inputs.
- Subworkflow JSONs that use `__inputs` keep working (see open question
  above).

## Risks

- **Type coercion surprises in templates.** Today templates render
  strings; numbers and booleans will stringify when interpolated. For
  the initial cut this is acceptable and matches how `globals` work
  (everything stringifies). If a downstream node needs numeric arithmetic
  on an input, the Script node is the right tool.
- **Modal friction.** Workflows with many required inputs will feel
  heavy to run. Mitigation: defaults are the answer; encourage authors
  to provide them.
- **Forward compatibility of unknown keys.** Silently dropping unknown
  supplied keys could mask typos in API callers. The server-side warning
  log is the trade-off; revisit if it bites.
