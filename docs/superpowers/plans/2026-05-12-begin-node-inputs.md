# Begin-Node Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workflows declare typed inputs on the workflow root that callers (`/api/run`, subworkflow invocation, or interactive UI) supply per run; values land in scope as `{{inputs.NAME}}`.

**Architecture:** Inputs are declared once on `workflow.inputs` (parallel to `workflow.globals`). A single shared resolver `resolveRunInputs(declared, supplied)` in `lib/shared/` validates types and applies defaults; it runs in the API route and in the subworkflow executor. The engine itself just receives an already-resolved record and seeds it into the top-level scope. The Begin-node config panel becomes the editor for `workflow.inputs`; a new `RunInputsModal` collects values from the UI when the workflow declares any input without a default.

**Tech Stack:** TypeScript, Next.js (App Router), Bun (`bun test` for unit tests via `bun:test`), Zustand (client store), React (UI). Templating is the existing `{{ref}}` system in `lib/shared/templating.ts` and `lib/shared/template-refs.ts`.

**Spec:** `docs/superpowers/specs/2026-05-12-begin-node-inputs-design.md`

---

## File Map

**Create:**
- `lib/shared/resolve-run-inputs.ts` — `resolveRunInputs()`, `WorkflowInputError`, value coercion.
- `lib/shared/resolve-run-inputs.test.ts` — unit tests for the resolver.
- `app/components/RunInputsModal.tsx` — modal form that prompts for declared inputs at run start.
- `app/components/RunInputsModal.test.tsx` — component tests for the modal.

**Modify:**
- `lib/shared/workflow.ts` — add `WorkflowInputDecl` type and `Workflow.inputs?: WorkflowInputDecl[]`.
- `lib/server/workflow-engine.ts` — `start()` accepts an optional `resolvedInputs`; seeds `scope.inputs`. `walkSubworkflow` resolves child inputs via the shared resolver and seeds both `inputs` and `__inputs` in the child scope (alias for back-compat).
- `app/api/run/route.ts` — accept `body.inputs`, run the resolver, return `400 invalid-inputs` on failure, otherwise pass `resolvedInputs` into `workflowEngine.start()`.
- `app/api/run/route.test.ts` — add tests for the validation path and the happy path with inputs.
- `lib/shared/template-refs.ts` — emit `inputs.NAME` refs in `availableVariables`; add an `inputs` branch in `classifyRef` with a new `'missing-input'` reason; extend `TemplateLintWarning.reason` accordingly.
- `lib/shared/template-refs.test.ts` — add coverage for the new branch.
- `lib/client/workflow-store-client.ts` — add `setWorkflowInputs(next: WorkflowInputDecl[])` action.
- `lib/client/workflow-store-client.test.ts` — add coverage for the new action.
- `app/components/ConfigPanel.tsx` — replace the stub `StartForm` body with a real editor for `workflow.inputs`.
- `app/components/ConfigPanel.test.tsx` — add coverage for the Begin-node inputs editor.
- `app/page.tsx` — extend `handleRun` to open `RunInputsModal` when the workflow declares any required-without-default input; add a chevron menu for "Run with inputs…".

---

## Type Reference

To keep later tasks consistent, here are the canonical type shapes introduced in Task 1 and used everywhere else:

```ts
// lib/shared/workflow.ts (Task 1)
export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'text';

export interface WorkflowInputDecl {
  name: string;
  type: WorkflowInputType;
  default?: string | number | boolean;
  description?: string;
}

// Workflow.inputs?: WorkflowInputDecl[];
```

```ts
// lib/shared/resolve-run-inputs.ts (Task 2)
export type WorkflowInputValue = string | number | boolean;

export type ResolvedInputs = Record<string, WorkflowInputValue>;

export type WorkflowInputErrorReason = 'required' | 'type';

export class WorkflowInputError extends Error {
  field: string;
  reason: WorkflowInputErrorReason;
  expected?: WorkflowInputType;
  got?: string;
  constructor(opts: {
    field: string;
    reason: WorkflowInputErrorReason;
    expected?: WorkflowInputType;
    got?: string;
  }) {
    super(`input "${opts.field}": ${opts.reason}`);
    this.name = 'WorkflowInputError';
    this.field = opts.field;
    this.reason = opts.reason;
    this.expected = opts.expected;
    this.got = opts.got;
  }
}

export function resolveRunInputs(
  declared: readonly WorkflowInputDecl[],
  supplied: Record<string, unknown> | undefined,
): ResolvedInputs;
```

---

### Task 1: Add `WorkflowInputDecl` type and `Workflow.inputs` field

**Files:**
- Modify: `lib/shared/workflow.ts` (around the existing `Workflow` interface, currently lines 220–233).

- [ ] **Step 1: Open the file and locate the existing `Workflow` interface**

Confirm the file has the existing `globals?: Record<string, string>;` field at lines ~228–232. The edit will add the new type and one new optional field next to it.

- [ ] **Step 2: Add the new type just above the `Workflow` interface**

In `lib/shared/workflow.ts`, immediately before the `export interface Workflow {` line, add:

```ts
/** Type of a Begin-node–declared input. `text` is multiline string;
 * all other values are stored exactly as their JS primitive. */
export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'text';

/** Per-run input declared on the workflow root. The Begin (Start) node's
 * config panel edits the workflow-level `inputs` array. Callers supply
 * values via /api/run or via the subworkflow executor; if `default` is
 * omitted the input is required. */
export interface WorkflowInputDecl {
  /** Identifier used in templates as `{{inputs.NAME}}`. Must match
   *  /^[a-zA-Z_][a-zA-Z0-9_]*$/ and be unique within the workflow. */
  name: string;
  type: WorkflowInputType;
  /** If omitted, the input is required: callers must supply a value
   *  or the run is rejected before it starts. */
  default?: string | number | boolean;
  description?: string;
}
```

- [ ] **Step 3: Add `inputs` to the `Workflow` interface**

Inside the `Workflow` interface, immediately after the existing `globals?` field, add:

```ts
  /** Ordered list of Begin-node input declarations. At run time the
   * engine seeds resolved values into the scope under the `inputs` key
   * so any node can reference `{{inputs.NAME}}`. Unlike `globals`, the
   * values come from the caller (API/subworkflow/UI), not from the
   * workflow JSON. */
  inputs?: WorkflowInputDecl[];
```

- [ ] **Step 4: Run the typecheck to verify the change compiles**

Run: `bun run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 5: Commit**

```bash
git add lib/shared/workflow.ts
git commit -m "feat(workflow): add WorkflowInputDecl + workflow.inputs field"
```

---

### Task 2: `resolveRunInputs` shared resolver + tests (TDD)

**Files:**
- Create: `lib/shared/resolve-run-inputs.ts`
- Test: `lib/shared/resolve-run-inputs.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `lib/shared/resolve-run-inputs.test.ts` with:

```ts
import { describe, expect, it } from 'bun:test';
import {
  resolveRunInputs,
  WorkflowInputError,
} from './resolve-run-inputs';
import type { WorkflowInputDecl } from './workflow';

const decl = (overrides: Partial<WorkflowInputDecl> & { name: string }):
  WorkflowInputDecl => ({ type: 'string', ...overrides });

describe('resolveRunInputs', () => {
  it('returns empty object when nothing is declared', () => {
    expect(resolveRunInputs([], undefined)).toEqual({});
    expect(resolveRunInputs([], {})).toEqual({});
  });

  it('uses supplied value when declared and supplied', () => {
    const out = resolveRunInputs(
      [decl({ name: 'topic' })],
      { topic: 'cats' },
    );
    expect(out).toEqual({ topic: 'cats' });
  });

  it('falls back to declared default when value omitted', () => {
    const out = resolveRunInputs(
      [decl({ name: 'topic', default: 'cats' })],
      {},
    );
    expect(out).toEqual({ topic: 'cats' });
  });

  it('throws required when no value and no default', () => {
    try {
      resolveRunInputs([decl({ name: 'topic' })], {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowInputError);
      expect((err as WorkflowInputError).reason).toBe('required');
      expect((err as WorkflowInputError).field).toBe('topic');
    }
  });

  it('coerces numbers and rejects non-finite', () => {
    expect(
      resolveRunInputs([decl({ name: 'n', type: 'number' })], { n: 5 }),
    ).toEqual({ n: 5 });
    try {
      resolveRunInputs(
        [decl({ name: 'n', type: 'number' })],
        { n: 'abc' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowInputError);
      expect((err as WorkflowInputError).reason).toBe('type');
      expect((err as WorkflowInputError).expected).toBe('number');
    }
  });

  it('accepts booleans only when actually boolean', () => {
    expect(
      resolveRunInputs([decl({ name: 'b', type: 'boolean' })], { b: true }),
    ).toEqual({ b: true });
    try {
      resolveRunInputs([decl({ name: 'b', type: 'boolean' })], { b: 'true' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as WorkflowInputError).reason).toBe('type');
    }
  });

  it('treats `text` like a string', () => {
    const out = resolveRunInputs(
      [decl({ name: 't', type: 'text' })],
      { t: 'hello\nworld' },
    );
    expect(out).toEqual({ t: 'hello\nworld' });
  });

  it('drops unknown supplied keys silently (forward compat)', () => {
    const out = resolveRunInputs(
      [decl({ name: 'topic', default: 'cats' })],
      { topic: 'dogs', stale: 'oops' },
    );
    expect(out).toEqual({ topic: 'dogs' });
    expect('stale' in out).toBe(false);
  });

  it('reports the first missing-required field', () => {
    try {
      resolveRunInputs(
        [decl({ name: 'a' }), decl({ name: 'b' })],
        { a: 'x' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as WorkflowInputError).field).toBe('b');
      expect((err as WorkflowInputError).reason).toBe('required');
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun test lib/shared/resolve-run-inputs.test.ts`
Expected: FAIL with module-not-found / unresolved import for `./resolve-run-inputs`.

- [ ] **Step 3: Implement `resolve-run-inputs.ts`**

Create `lib/shared/resolve-run-inputs.ts`:

```ts
import type { WorkflowInputDecl, WorkflowInputType } from './workflow';

export type WorkflowInputValue = string | number | boolean;
export type ResolvedInputs = Record<string, WorkflowInputValue>;
export type WorkflowInputErrorReason = 'required' | 'type';

export class WorkflowInputError extends Error {
  field: string;
  reason: WorkflowInputErrorReason;
  expected?: WorkflowInputType;
  got?: string;

  constructor(opts: {
    field: string;
    reason: WorkflowInputErrorReason;
    expected?: WorkflowInputType;
    got?: string;
  }) {
    super(`input "${opts.field}": ${opts.reason}`);
    this.name = 'WorkflowInputError';
    this.field = opts.field;
    this.reason = opts.reason;
    this.expected = opts.expected;
    this.got = opts.got;
  }
}

/** Validate `supplied` against `declared`, applying defaults. Throws
 * `WorkflowInputError` on the first missing-required or type-mismatch.
 * Unknown keys in `supplied` (not in `declared`) are silently dropped.
 *
 * Single source of truth: called by the API route, the subworkflow
 * executor, and the client-side run modal (same module, no
 * server-only imports). */
export function resolveRunInputs(
  declared: readonly WorkflowInputDecl[],
  supplied: Record<string, unknown> | undefined,
): ResolvedInputs {
  const out: ResolvedInputs = {};
  const supp = supplied ?? {};

  for (const d of declared) {
    const has = Object.prototype.hasOwnProperty.call(supp, d.name);
    const raw: unknown = has ? supp[d.name] : d.default;

    if (raw === undefined) {
      throw new WorkflowInputError({ field: d.name, reason: 'required' });
    }

    out[d.name] = coerce(d, raw);
  }

  return out;
}

function coerce(d: WorkflowInputDecl, raw: unknown): WorkflowInputValue {
  switch (d.type) {
    case 'string':
    case 'text':
      if (typeof raw !== 'string') {
        throw new WorkflowInputError({
          field: d.name,
          reason: 'type',
          expected: d.type,
          got: typeof raw,
        });
      }
      return raw;
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new WorkflowInputError({
          field: d.name,
          reason: 'type',
          expected: 'number',
          got: typeof raw,
        });
      }
      return raw;
    case 'boolean':
      if (typeof raw !== 'boolean') {
        throw new WorkflowInputError({
          field: d.name,
          reason: 'type',
          expected: 'boolean',
          got: typeof raw,
        });
      }
      return raw;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun test lib/shared/resolve-run-inputs.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/shared/resolve-run-inputs.ts lib/shared/resolve-run-inputs.test.ts
git commit -m "feat(workflow): add resolveRunInputs shared resolver"
```

---

### Task 3: Engine seeds `scope.inputs` from resolved inputs

**Files:**
- Modify: `lib/server/workflow-engine.ts` (around `start()` at line 111 and the seed-scope block at lines 126–133).
- Modify: `lib/server/workflow-engine.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `lib/server/workflow-engine.test.ts` — locate an existing `describe('WorkflowEngine')` block (or top-level) and add:

```ts
import type { ResolvedInputs } from '../shared/resolve-run-inputs';

describe('WorkflowEngine — workflow inputs', () => {
  it('seeds resolved inputs into scope under `inputs`', async () => {
    // Minimal workflow: start → end, with a no-op executor map. The
    // assertion is purely on the seeded scope visible in the snapshot
    // after run completion. Reuse the test helper that builds workflows
    // and runs them to a terminal state — same pattern as the other
    // tests in this file.
    const wf = makeWorkflowWithStartEnd({
      inputs: [{ name: 'topic', type: 'string' }],
    });
    const engine = new WorkflowEngine();
    const resolved: ResolvedInputs = { topic: 'cats' };
    await engine.start(wf, { resolvedInputs: resolved });
    const snap = engine.getState();
    expect(snap.scope.inputs).toEqual({ topic: 'cats' });
  });

  it('omits scope.inputs entirely when none supplied and none declared', async () => {
    const wf = makeWorkflowWithStartEnd({});
    const engine = new WorkflowEngine();
    await engine.start(wf);
    const snap = engine.getState();
    expect(snap.scope.inputs).toBeUndefined();
  });
});
```

If `makeWorkflowWithStartEnd` does not exist, copy whatever the file already uses to build a workflow (search for `nodes: [{ type: 'start'` in the file) and inline the same pattern.

- [ ] **Step 2: Run tests to confirm failure**

Run: `bun test lib/server/workflow-engine.test.ts`
Expected: FAIL — either compile error on `engine.start(wf, { resolvedInputs })` (signature doesn't accept second arg yet) or assertion failure on `snap.scope.inputs`.

- [ ] **Step 3: Update `start()` signature and seed-scope logic**

In `lib/server/workflow-engine.ts`, change the `start` method (currently line 111) from:

```ts
async start(workflow: Workflow): Promise<void> {
```

to:

```ts
async start(
  workflow: Workflow,
  opts?: { resolvedInputs?: ResolvedInputs },
): Promise<void> {
```

Add the import at the top of the file alongside the other shared imports:

```ts
import type { ResolvedInputs } from '../shared/resolve-run-inputs';
```

Replace the existing seed-scope block (currently lines 126–133):

```ts
const seedScope: Scope = {};
if (workflow.globals && typeof workflow.globals === 'object') {
  seedScope.globals = { ...workflow.globals };
}
```

with:

```ts
const seedScope: Scope = {};
if (workflow.globals && typeof workflow.globals === 'object') {
  seedScope.globals = { ...workflow.globals };
}
if (opts?.resolvedInputs && typeof opts.resolvedInputs === 'object') {
  // Pre-resolved by the caller (API route or subworkflow executor); the
  // engine does no validation here — it just seeds.
  seedScope.inputs = { ...opts.resolvedInputs };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test lib/server/workflow-engine.test.ts`
Expected: PASS for the two new tests; no other tests should regress.

- [ ] **Step 5: Run the typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/server/workflow-engine.ts lib/server/workflow-engine.test.ts
git commit -m "feat(engine): seed resolved inputs into scope.inputs"
```

---

### Task 4: `/api/run` validates body.inputs and passes to engine

**Files:**
- Modify: `app/api/run/route.ts`
- Modify: `app/api/run/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `app/api/run/route.test.ts` — find the existing `describe` block for `POST /api/run` and add:

```ts
import { POST as runPOST } from './route';

function jsonRequest(method: string, body: unknown): Request {
  return new Request('http://test/api/run', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/run — inputs', () => {
  it('returns 400 invalid-inputs when a required input is missing', async () => {
    // Stub a workflow with one required input and no default. The
    // existing test file already mocks `getWorkflow`; reuse that
    // mechanism. If it uses `mock.module('../workflow-store')` or
    // similar, add this stub:
    mockGetWorkflow({
      id: 'wf-x',
      name: 'x',
      version: 1,
      nodes: [],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
      inputs: [{ name: 'topic', type: 'string' }],
    });
    const res = await runPOST(jsonRequest('POST', { workflowId: 'wf-x' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-inputs');
    expect(body.field).toBe('topic');
    expect(body.reason).toBe('required');
  });

  it('returns 400 invalid-inputs on type mismatch', async () => {
    mockGetWorkflow({
      id: 'wf-y',
      name: 'y',
      version: 1,
      nodes: [],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
      inputs: [{ name: 'count', type: 'number' }],
    });
    const res = await runPOST(
      jsonRequest('POST', { workflowId: 'wf-y', inputs: { count: 'abc' } }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-inputs');
    expect(body.field).toBe('count');
    expect(body.reason).toBe('type');
    expect(body.expected).toBe('number');
  });

  it('accepts a valid inputs payload and starts the run', async () => {
    mockGetWorkflow({
      id: 'wf-z',
      name: 'z',
      version: 1,
      nodes: [{ id: 'start-1', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
      inputs: [{ name: 'topic', type: 'string' }],
    });
    const res = await runPOST(
      jsonRequest('POST', { workflowId: 'wf-z', inputs: { topic: 'cats' } }),
    );
    expect(res.status).toBe(202);
  });
});
```

If the existing test file uses a different stubbing pattern (e.g. `vi.mock`, `mock.module`, dependency injection), follow that pattern instead — the helper name `mockGetWorkflow` is illustrative; replace with whatever the file already does to stub `getWorkflow`.

- [ ] **Step 2: Run tests to confirm failure**

Run: `bun test app/api/run/route.test.ts`
Expected: FAIL — the new tests don't yet have validation wired into the route.

- [ ] **Step 3: Update the route**

Replace `app/api/run/route.ts` body with:

```ts
import { NextResponse } from 'next/server';
import { workflowEngine } from '@/lib/server/workflow-engine';
import { getWorkflow } from '@/lib/server/workflow-store';
import {
  resolveRunInputs,
  WorkflowInputError,
} from '@/lib/shared/resolve-run-inputs';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const obj = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const workflowId = obj.workflowId;
  if (typeof workflowId !== 'string' || workflowId.length === 0) {
    return NextResponse.json(
      { error: 'workflowId is required' },
      { status: 400 },
    );
  }

  const suppliedInputs =
    obj.inputs && typeof obj.inputs === 'object' && !Array.isArray(obj.inputs)
      ? (obj.inputs as Record<string, unknown>)
      : {};

  let workflow;
  try {
    workflow = await getWorkflow(workflowId);
  } catch {
    return NextResponse.json(
      { error: `workflow not found: ${workflowId}` },
      { status: 404 },
    );
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
        { status: 400 },
      );
    }
    throw err;
  }

  if (workflowEngine.getState().status === 'running') {
    return NextResponse.json(
      { error: 'a run is already active' },
      { status: 409 },
    );
  }

  // Fire-and-forget; the engine emits progress over the WS bus.
  workflowEngine.start(workflow, { resolvedInputs }).catch((err) => {
    console.error('[api/run] engine.start failed:', err);
  });

  return NextResponse.json(
    { state: workflowEngine.getState() },
    { status: 202 },
  );
}

export async function GET() {
  return NextResponse.json({ state: workflowEngine.getState() }, { status: 200 });
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test app/api/run/route.test.ts`
Expected: PASS for the three new tests and all previously-passing tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/run/route.ts app/api/run/route.test.ts
git commit -m "feat(api): validate workflow inputs before starting run"
```

---

### Task 5: Subworkflow executor aliases `__inputs` → `inputs` (back-compat)

**Why narrow:** The existing parent → child subworkflow flow passes
*templated string values* (`cfg.inputs: Record<string, string>`). Strict
type-validation against the child's declared `workflow.inputs` would
break this, since `"5"` (string) does not satisfy a `number` declaration.
For this task we only expose the existing resolved inputs under the new
`inputs.NAME` key (alongside the legacy `__inputs.NAME`) so subworkflow
authors can use the same template syntax as the top level. Strict typed
resolution for the subworkflow path is a follow-up — outside this spec.

**Files:**
- Modify: `lib/server/workflow-engine.ts` — child-scope assignment around line 736.
- Modify: `lib/server/workflow-engine.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `lib/server/workflow-engine.test.ts`:

```ts
describe('WorkflowEngine — subworkflow child inputs alias', () => {
  it('exposes parent-supplied inputs under both `inputs` and `__inputs`', async () => {
    // Build a parent that invokes a child subworkflow with one
    // templated input. The child's start → end path doesn't need to
    // do anything; we assert on the seeded child scope.
    //
    // Use the same fixture-building style as the existing subworkflow
    // tests in this file (search for `'subworkflow'` or `walkSubworkflow`).
    const { parent, child } = buildParentChildFixture({
      parentSuppliedInputs: { topic: 'cats' },
    });
    const engine = new WorkflowEngine(
      undefined,
      async (id) => (id === child.id ? child : parent),
    );
    await engine.start(parent);
    const snap = engine.getState();
    const found = findChildScopeWithInputs(snap.scope);
    expect(found.inputs).toEqual({ topic: 'cats' });
    expect(found.__inputs).toEqual({ topic: 'cats' });
  });
});
```

Helper functions `buildParentChildFixture` and `findChildScopeWithInputs`
are sketches — implement them inline using whatever fixture-building
style is already present in the file. The parent should have a
`subworkflow` node whose `cfg.inputs = { topic: 'cats' }`. The child
should be a minimal `start → end` workflow.

- [ ] **Step 2: Run tests to confirm failure**

Run: `bun test lib/server/workflow-engine.test.ts`
Expected: FAIL — child scope currently has only `__inputs`, not `inputs`.

- [ ] **Step 3: Update the child-scope assignment**

In `lib/server/workflow-engine.ts`, find the line (around 736):

```ts
const childScope: Scope = { __inputs: resolvedInputs };
```

Replace with:

```ts
// Child scope exposes the resolved inputs under both `inputs.NAME`
// (the new top-level convention) AND `__inputs.NAME` (preserved for
// back-compat with existing subworkflow JSONs that still reference
// `{{__inputs.NAME}}`). Values are pass-through from the parent's
// templated `cfg.inputs`; strict typed validation against
// `child.inputs` declarations is intentionally not applied here —
// see the design doc for the rationale.
const childScope: Scope = {
  inputs: { ...resolvedInputs },
  __inputs: { ...resolvedInputs },
};
```

- [ ] **Step 4: Update template-refs lint to accept `inputs.*` inside subworkflows**

The lint pass in `lib/shared/template-refs.ts` currently treats `__inputs.*`
as virtual (line ~344). Since `inputs.*` now also serves as a virtual
namespace inside subworkflow child scopes (in addition to being a
declared top-level namespace), the existing top-level `inputs` branch
added in Task 6 already covers both — it returns `'missing-input'` only
when no declaration exists. For a *subworkflow* child workflow, the
author would still need `workflow.inputs` declared on the child to avoid
the warning at edit time. That is the correct behavior: declarations
double as the schema for parent callers.

No code change in this step — just verify Task 6's lint branch reads
declarations from the workflow whose lint pass is running (which is
already what the existing implementation does — each workflow is linted
against its own `workflow.inputs`).

- [ ] **Step 5: Run the tests**

Run: `bun test lib/server/workflow-engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/server/workflow-engine.ts lib/server/workflow-engine.test.ts
git commit -m "feat(engine): alias subworkflow __inputs to inputs in child scope"
```

---

### Task 6: Template autocomplete + lint for `{{inputs.NAME}}`

**Files:**
- Modify: `lib/shared/template-refs.ts` — `availableVariables` (around line 237), `classifyRef` (around line 332), `TemplateLintWarning.reason` union (around line 324).
- Modify: `lib/shared/template-refs.test.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/shared/template-refs.test.ts`:

```ts
describe('availableVariables — workflow inputs', () => {
  it('surfaces declared inputs at the top of the list', () => {
    const wf: Workflow = {
      ...baseWorkflow,
      inputs: [
        { name: 'topic', type: 'string' },
        { name: 'max', type: 'number', default: 5 },
      ],
    };
    const refs = availableVariables(wf, 'claude-1');
    const inputRefs = refs.filter((r) => r.nodeId === 'inputs');
    expect(inputRefs.map((r) => r.ref)).toEqual([
      'inputs.topic',
      'inputs.max',
    ]);
    expect(inputRefs.every((r) => r.inScope)).toBe(true);
  });
});

describe('lintField — workflow inputs', () => {
  it('reports missing-input for undeclared input refs', () => {
    const wf: Workflow = { ...baseWorkflow, inputs: [{ name: 'topic', type: 'string' }] };
    const warnings = lintField(wf, 'claude-1', 'prompt', '{{inputs.unknown}}');
    expect(warnings.map((w) => w.reason)).toEqual(['missing-input']);
  });

  it('accepts declared input refs', () => {
    const wf: Workflow = { ...baseWorkflow, inputs: [{ name: 'topic', type: 'string' }] };
    const warnings = lintField(wf, 'claude-1', 'prompt', '{{inputs.topic}}');
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `bun test lib/shared/template-refs.test.ts`
Expected: FAIL — neither the picker nor the lint pass knows about `inputs`.

- [ ] **Step 3: Extend `availableVariables` to emit input refs**

In `lib/shared/template-refs.ts`, find the existing globals-emission block (lines 253–264):

```ts
// Workflow-level globals — always in scope.
const globals = workflow.globals ?? {};
for (const name of Object.keys(globals)) {
  inScope.push({
    ref: `globals.${name}`,
    nodeId: 'globals',
    field: name,
    description: 'workflow global',
    inScope: true,
    kind: 'global',
  });
}
```

Immediately after it, add:

```ts
// Workflow-level inputs — always in scope. Mirror the globals
// emission so the picker shows them at the top of the list.
const inputs = workflow.inputs ?? [];
for (const inp of inputs) {
  inScope.push({
    ref: `inputs.${inp.name}`,
    nodeId: 'inputs',
    field: inp.name,
    description: inp.description ?? `workflow input (${inp.type})`,
    inScope: true,
    kind: 'global',
  });
}
```

(`kind: 'global'` is reused because the existing `TemplateRef.kind` union covers `'global' | 'node'`; both globals and inputs are workflow-scoped, not node-scoped. If a new kind is desired in the future, that's a separate cleanup.)

- [ ] **Step 4: Extend `classifyRef` with an `inputs` branch and add `'missing-input'` reason**

In `lib/shared/template-refs.ts`:

(a) Update the `TemplateLintWarning.reason` union (currently lines 324–329) from:

```ts
reason:
  | 'unknown'
  | 'missing-field'
  | 'self-ref'
  | 'out-of-scope'
  | 'missing-global';
```

to:

```ts
reason:
  | 'unknown'
  | 'missing-field'
  | 'self-ref'
  | 'out-of-scope'
  | 'missing-global'
  | 'missing-input';
```

(b) In `classifyRef`, find the `globals` branch (lines 346–352):

```ts
// Workflow-level globals.
if (head === 'globals') {
  const name = parts.slice(1).join('.');
  const globals = workflow.globals ?? {};
  if (!name || !(name in globals)) return 'missing-global';
  return null;
}
```

Immediately after it, add:

```ts
// Workflow-level inputs.
if (head === 'inputs') {
  const name = parts.slice(1).join('.');
  const inputs = workflow.inputs ?? [];
  if (!name || !inputs.some((i) => i.name === name)) return 'missing-input';
  return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test lib/shared/template-refs.test.ts`
Expected: PASS for all new and existing tests.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/shared/template-refs.ts lib/shared/template-refs.test.ts
git commit -m "feat(template-refs): surface workflow inputs in picker + lint"
```

---

### Task 7: Add `setWorkflowInputs` action to client store

**Files:**
- Modify: `lib/client/workflow-store-client.ts` — interface declaration around line 45, implementation around line 439.
- Modify: `lib/client/workflow-store-client.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `lib/client/workflow-store-client.test.ts`:

```ts
describe('setWorkflowInputs', () => {
  it('replaces workflow.inputs and bumps updatedAt', () => {
    const store = makeStore(); // use whatever helper the file uses
    store.loadWorkflow({
      id: 'wf-1',
      name: 'wf',
      version: 1,
      nodes: [],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const before = store.currentWorkflow!.updatedAt;
    store.setWorkflowInputs([
      { name: 'topic', type: 'string', default: 'cats' },
    ]);
    expect(store.currentWorkflow!.inputs).toEqual([
      { name: 'topic', type: 'string', default: 'cats' },
    ]);
    expect(store.currentWorkflow!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('clears workflow.inputs when passed empty array', () => {
    const store = makeStore();
    store.loadWorkflow({
      id: 'wf-1',
      name: 'wf',
      version: 1,
      nodes: [],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
      inputs: [{ name: 'topic', type: 'string' }],
    });
    store.setWorkflowInputs([]);
    expect(store.currentWorkflow!.inputs).toEqual([]);
  });
});
```

If the file uses a different store-instantiation idiom (`useWorkflowStore.getState()` rather than `makeStore()`), follow whatever existing tests do.

- [ ] **Step 2: Run tests to confirm failure**

Run: `bun test lib/client/workflow-store-client.test.ts`
Expected: FAIL — `setWorkflowInputs` is undefined.

- [ ] **Step 3: Add the action**

In `lib/client/workflow-store-client.ts`:

(a) Add the type to the interface (right after the existing `setGlobals` declaration around line 47):

```ts
  /** Replace the current workflow's `inputs` array. Pass an empty
   * array to clear all declared inputs. Tracked in undo history. */
  setWorkflowInputs: (next: WorkflowInputDecl[]) => void;
```

Ensure the `WorkflowInputDecl` type is imported from `../shared/workflow` at the top of the file (look at where `Workflow` is already imported and extend that import).

(b) Add the implementation (right after the existing `setGlobals` impl around line 446):

```ts
  setWorkflowInputs: (next) =>
    set((s) => {
      if (!s.currentWorkflow) return {};
      return {
        currentWorkflow: bumpUpdated({ ...s.currentWorkflow, inputs: next }),
        ...pushPast(s, s.currentWorkflow),
      };
    }),
```

- [ ] **Step 4: Run the tests**

Run: `bun test lib/client/workflow-store-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/client/workflow-store-client.ts lib/client/workflow-store-client.test.ts
git commit -m "feat(store): add setWorkflowInputs action"
```

---

### Task 8: Begin-node config panel becomes the inputs editor

**Files:**
- Modify: `app/components/ConfigPanel.tsx` — `StartForm` at line 215, and the call site at line 2070 (passing `workflow` prop).
- Modify: `app/components/ConfigPanel.test.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `app/components/ConfigPanel.test.tsx`:

```ts
describe('ConfigPanel — Begin-node inputs editor', () => {
  it('renders existing declared inputs as rows', () => {
    // Use whatever render helper the file already uses to mount
    // ConfigPanel with a selected `start` node. Pass a workflow that
    // declares two inputs.
    const wf = makeStartOnlyWorkflow({
      inputs: [
        { name: 'topic', type: 'string', default: 'cats' },
        { name: 'count', type: 'number' },
      ],
    });
    renderConfigPanelWithStartSelected(wf);
    expect(screen.getByDisplayValue('topic')).toBeInTheDocument();
    expect(screen.getByDisplayValue('count')).toBeInTheDocument();
  });

  it('lets the user add a new input row', async () => {
    const wf = makeStartOnlyWorkflow({});
    const { user } = renderConfigPanelWithStartSelected(wf);
    await user.click(screen.getByRole('button', { name: /add input/i }));
    const nameInputs = screen.getAllByPlaceholderText(/name/i);
    expect(nameInputs.length).toBeGreaterThan(0);
  });

  it('disables save indicator when a name is duplicated', async () => {
    const wf = makeStartOnlyWorkflow({
      inputs: [
        { name: 'topic', type: 'string' },
        { name: 'topic', type: 'string' },
      ],
    });
    renderConfigPanelWithStartSelected(wf);
    expect(screen.getByText(/duplicate name/i)).toBeInTheDocument();
  });
});
```

Adapt helper names to match the existing file conventions.

- [ ] **Step 2: Run tests to confirm failure**

Run: `bun test app/components/ConfigPanel.test.tsx`
Expected: FAIL — `StartForm` currently renders only a static caption.

- [ ] **Step 3: Replace `StartForm` body with the inputs editor**

In `app/components/ConfigPanel.tsx`, replace the current `StartForm` (lines 215–221):

```tsx
function StartForm() {
  return (
    <p className="serif-italic" style={{ color: 'var(--fg-dim)' }}>
      Begin the workflow.
    </p>
  );
}
```

with:

```tsx
function StartForm({ workflow }: { workflow: Workflow | null }) {
  const setWorkflowInputs = useWorkflowStore((s) => s.setWorkflowInputs);
  const declared = workflow?.inputs ?? [];

  const update = (next: WorkflowInputDecl[]) => {
    setWorkflowInputs(next);
  };

  const addRow = () => {
    const used = new Set(declared.map((d) => d.name));
    let i = 1;
    let name = `input${i}`;
    while (used.has(name)) {
      i += 1;
      name = `input${i}`;
    }
    update([...declared, { name, type: 'string' }]);
  };

  const removeRow = (idx: number) => {
    update(declared.filter((_, i) => i !== idx));
  };

  const patchRow = (idx: number, patch: Partial<WorkflowInputDecl>) => {
    update(declared.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  // Per-row validation: identifier regex, duplicate name, default
  // parses against the type. Save is disabled implicitly by surfacing
  // inline errors next to each invalid row; we don't gate the in-memory
  // edit (the user needs to be able to fix it).
  const nameCounts = new Map<string, number>();
  for (const d of declared) {
    nameCounts.set(d.name, (nameCounts.get(d.name) ?? 0) + 1);
  }
  const idRe = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  return (
    <form
      className="task-form"
      onSubmit={(e) => e.preventDefault()}
      aria-label="workflow inputs"
    >
      <p
        className="field-hint"
        style={{ marginBottom: 12, color: 'var(--fg-dim)' }}
      >
        Inputs supplied per run. Reference them in templates as{' '}
        <code style={{ fontFamily: 'var(--mono)' }}>
          {'{{inputs.NAME}}'}
        </code>
        . An input with no default is required at run time.
      </p>

      {declared.length === 0 && (
        <p className="field-hint" style={{ color: 'var(--fg-dim)' }}>
          No inputs declared. The workflow will run with no parameters.
        </p>
      )}

      {declared.map((row, idx) => {
        const dup = (nameCounts.get(row.name) ?? 0) > 1;
        const badId = !idRe.test(row.name);
        const defaultBad = row.default !== undefined && !validDefault(row);
        return (
          <fieldset
            key={idx}
            style={{
              border: '1px solid var(--border-soft)',
              padding: '8px 10px',
              marginBottom: 8,
              borderRadius: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ flex: 1 }}>
                name
                <input
                  type="text"
                  value={row.name}
                  placeholder="name"
                  onChange={(e) => patchRow(idx, { name: e.target.value })}
                />
              </label>
              <label>
                type
                <select
                  value={row.type}
                  onChange={(e) =>
                    patchRow(idx, {
                      type: e.target.value as WorkflowInputDecl['type'],
                      // Clear default on type change to avoid an
                      // unparseable carry-over.
                      default: undefined,
                    })
                  }
                >
                  <option value="string">string</option>
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => removeRow(idx)}
                aria-label={`remove input ${row.name}`}
              >
                ×
              </button>
            </div>

            <label style={{ display: 'block', marginTop: 6 }}>
              default (empty = required)
              <DefaultEditor row={row} onChange={(d) => patchRow(idx, { default: d })} />
            </label>

            <label style={{ display: 'block', marginTop: 6 }}>
              description
              <input
                type="text"
                value={row.description ?? ''}
                placeholder="optional"
                onChange={(e) =>
                  patchRow(idx, { description: e.target.value || undefined })
                }
              />
            </label>

            {dup && (
              <p className="field-error">duplicate name</p>
            )}
            {badId && (
              <p className="field-error">
                name must match /^[a-zA-Z_][a-zA-Z0-9_]*$/
              </p>
            )}
            {defaultBad && (
              <p className="field-error">default does not parse as {row.type}</p>
            )}
          </fieldset>
        );
      })}

      <button type="button" onClick={addRow}>
        + add input
      </button>
    </form>
  );
}

function validDefault(row: WorkflowInputDecl): boolean {
  if (row.default === undefined) return true;
  switch (row.type) {
    case 'string':
    case 'text':
      return typeof row.default === 'string';
    case 'number':
      return typeof row.default === 'number' && Number.isFinite(row.default);
    case 'boolean':
      return typeof row.default === 'boolean';
  }
}

function DefaultEditor({
  row,
  onChange,
}: {
  row: WorkflowInputDecl;
  onChange: (next: WorkflowInputDecl['default']) => void;
}) {
  switch (row.type) {
    case 'string':
      return (
        <input
          type="text"
          value={typeof row.default === 'string' ? row.default : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
    case 'text':
      return (
        <textarea
          value={typeof row.default === 'string' ? row.default : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
    case 'number': {
      const v = typeof row.default === 'number' ? row.default : '';
      return (
        <input
          type="number"
          value={v}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(undefined);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
      );
    }
    case 'boolean':
      return (
        <select
          value={
            row.default === true ? 'true' : row.default === false ? 'false' : ''
          }
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === 'true' ? true : v === 'false' ? false : undefined);
          }}
        >
          <option value="">(unset)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
  }
}
```

At the top of the file, ensure these are imported:

```ts
import type { WorkflowInputDecl } from '@/lib/shared/workflow';
```

(`Workflow`, `useWorkflowStore` are already imported in the file.)

- [ ] **Step 4: Update the `StartForm` call site to pass `workflow`**

Find line 2070 in `ConfigPanel.tsx`:

```tsx
{node.type === 'start' && <StartForm />}
```

Replace with:

```tsx
{node.type === 'start' && <StartForm workflow={currentWorkflow} />}
```

- [ ] **Step 5: Run the tests**

Run: `bun test app/components/ConfigPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Visual smoke test**

Run: `bun dev` in a separate terminal, open the workflow editor, click the Begin node, and confirm:

- The inputs editor renders.
- "+ add input" adds a row with type `string` and an auto-generated name (`input1`, `input2`, …).
- Type selector changes the default editor widget (text → number → switch → textarea).
- Duplicate name shows an inline error.

Expected: All behaviors work. (This is a manual check — record any oddities as bugs and fix before continuing.)

- [ ] **Step 8: Commit**

```bash
git add app/components/ConfigPanel.tsx app/components/ConfigPanel.test.tsx
git commit -m "feat(config-panel): edit workflow inputs from Begin node"
```

---

### Task 9: `RunInputsModal` component

**Files:**
- Create: `app/components/RunInputsModal.tsx`
- Test: `app/components/RunInputsModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/components/RunInputsModal.test.tsx`:

```tsx
import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RunInputsModal from './RunInputsModal';
import type { WorkflowInputDecl } from '@/lib/shared/workflow';

const decls = (inputs: WorkflowInputDecl[]): WorkflowInputDecl[] => inputs;

describe('RunInputsModal', () => {
  it('renders one field per declared input with type-appropriate widget', () => {
    render(
      <RunInputsModal
        declared={decls([
          { name: 'topic', type: 'string', default: 'cats' },
          { name: 'count', type: 'number' },
          { name: 'enabled', type: 'boolean', default: true },
          { name: 'notes', type: 'text' },
        ])}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText('topic')).toBeInTheDocument();
    expect(screen.getByLabelText('count')).toBeInTheDocument();
    expect(screen.getByLabelText('enabled')).toBeInTheDocument();
    expect(screen.getByLabelText('notes')).toBeInTheDocument();
    // Default prefill check
    expect(screen.getByLabelText('topic')).toHaveValue('cats');
  });

  it('blocks submit when a required field is empty', async () => {
    const onSubmit = mock(() => {});
    render(
      <RunInputsModal
        declared={decls([{ name: 'topic', type: 'string' }])}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /run/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/required/i)).toBeInTheDocument();
  });

  it('submits typed values on Run', async () => {
    const onSubmit = mock((_v: Record<string, unknown>) => {});
    render(
      <RunInputsModal
        declared={decls([
          { name: 'topic', type: 'string' },
          { name: 'count', type: 'number' },
        ])}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('topic'), 'dogs');
    await user.type(screen.getByLabelText('count'), '7');
    await user.click(screen.getByRole('button', { name: /run/i }));
    expect(onSubmit).toHaveBeenCalledWith({ topic: 'dogs', count: 7 });
  });

  it('calls onCancel when Cancel clicked', async () => {
    const onCancel = mock(() => {});
    render(
      <RunInputsModal
        declared={decls([])}
        onSubmit={() => {}}
        onCancel={onCancel}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

If the project does not have `@testing-library/react` already, follow whatever DOM-testing setup other component test files in `app/components/` use (look at `ConfigPanel.test.tsx`'s imports).

- [ ] **Step 2: Run tests to confirm failure**

Run: `bun test app/components/RunInputsModal.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the modal**

Create `app/components/RunInputsModal.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import type { WorkflowInputDecl } from '@/lib/shared/workflow';
import {
  resolveRunInputs,
  WorkflowInputError,
  type WorkflowInputValue,
} from '@/lib/shared/resolve-run-inputs';

interface Props {
  declared: WorkflowInputDecl[];
  onSubmit: (values: Record<string, WorkflowInputValue>) => void;
  onCancel: () => void;
}

/** Form widget per declared input type. Storage in state is always
 * the source-of-truth JS primitive (string | number | boolean | undefined);
 * the input element converts on change. Empty string means "unset", which
 * triggers `required` validation if the input has no default. */
type FieldValue = string | number | boolean | undefined;

export default function RunInputsModal({ declared, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const initial: Record<string, FieldValue> = {};
    for (const d of declared) {
      initial[d.name] = d.default;
    }
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Build the supplied payload, dropping unset values so the
    // resolver applies declared defaults (if any).
    const supplied: Record<string, WorkflowInputValue> = {};
    for (const d of declared) {
      const v = values[d.name];
      if (v !== undefined && v !== '') supplied[d.name] = v as WorkflowInputValue;
    }
    try {
      const resolved = resolveRunInputs(declared, supplied);
      setErrors({});
      onSubmit(resolved);
    } catch (err) {
      if (err instanceof WorkflowInputError) {
        const msg =
          err.reason === 'required'
            ? 'required'
            : `expected ${err.expected}`;
        setErrors({ [err.field]: msg });
        return;
      }
      throw err;
    }
  };

  return (
    <div
      role="dialog"
      aria-label="workflow inputs"
      className="modal-backdrop"
    >
      <form className="modal" onSubmit={handleSubmit}>
        <h2>Run with inputs</h2>
        {declared.map((d) => (
          <div key={d.name} className="field">
            <label htmlFor={`run-input-${d.name}`}>{d.name}</label>
            {d.description && (
              <p className="field-hint">{d.description}</p>
            )}
            <FieldWidget
              id={`run-input-${d.name}`}
              decl={d}
              value={values[d.name]}
              onChange={(v) => setValues((s) => ({ ...s, [d.name]: v }))}
            />
            {errors[d.name] && (
              <p className="field-error">{errors[d.name]}</p>
            )}
          </div>
        ))}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Run</button>
        </div>
      </form>
    </div>
  );
}

function FieldWidget({
  id,
  decl,
  value,
  onChange,
}: {
  id: string;
  decl: WorkflowInputDecl;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  switch (decl.type) {
    case 'string':
      return (
        <input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
    case 'text':
      return (
        <textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(undefined);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
      );
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test app/components/RunInputsModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/RunInputsModal.tsx app/components/RunInputsModal.test.tsx
git commit -m "feat(ui): RunInputsModal — collect declared inputs at run start"
```

---

### Task 10: Wire Run button + chevron menu in `app/page.tsx`

**Files:**
- Modify: `app/page.tsx` — `handleRun` (line 143) and the Run button JSX (lines 206–220).

- [ ] **Step 1: Add modal state and chevron menu state**

Near the existing `useState` calls at the top of the `Page` component (search for `useState` in `app/page.tsx`), add:

```tsx
const [runModalOpen, setRunModalOpen] = useState(false);
const [runChevronOpen, setRunChevronOpen] = useState(false);
```

- [ ] **Step 2: Replace `handleRun` with the input-aware version**

Replace the existing `handleRun` (line 143):

```tsx
async function handleRun() {
  if (!currentWorkflow) return;
  await fetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowId: currentWorkflow.id }),
  });
}
```

with:

```tsx
async function postRun(inputs?: Record<string, unknown>) {
  if (!currentWorkflow) return;
  await fetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowId: currentWorkflow.id,
      ...(inputs ? { inputs } : {}),
    }),
  });
}

function handleRun() {
  if (!currentWorkflow) return;
  const declared = currentWorkflow.inputs ?? [];
  const needsPrompt = declared.some((i) => i.default === undefined);
  if (needsPrompt) {
    setRunModalOpen(true);
  } else {
    void postRun();
  }
}

function handleRunWithInputs() {
  if (!currentWorkflow) return;
  setRunChevronOpen(false);
  setRunModalOpen(true);
}
```

- [ ] **Step 3: Replace the Run button JSX with a Run + chevron group**

Find lines 205–220 (the `else` branch rendering the Run button) and replace:

```tsx
) : (
  <button
    type="button"
    onClick={handleRun}
    className="btn"
    aria-label="run workflow"
    disabled={!currentWorkflow}
    title={
      !currentWorkflow
        ? 'Open or create a workflow first'
        : undefined
    }
  >
    Run
  </button>
)}
```

with:

```tsx
) : (
  <div className="run-group" style={{ position: 'relative', display: 'inline-flex' }}>
    <button
      type="button"
      onClick={handleRun}
      className="btn"
      aria-label="run workflow"
      disabled={!currentWorkflow}
      title={
        !currentWorkflow
          ? 'Open or create a workflow first'
          : undefined
      }
    >
      Run
    </button>
    {(currentWorkflow?.inputs?.length ?? 0) > 0 && (
      <>
        <button
          type="button"
          className="btn"
          aria-label="run options"
          aria-haspopup="menu"
          aria-expanded={runChevronOpen}
          onClick={() => setRunChevronOpen((v) => !v)}
          style={{ padding: '0 6px' }}
        >
          ▾
        </button>
        {runChevronOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              background: 'var(--bg)',
              border: '1px solid var(--border-soft)',
              padding: 4,
              zIndex: 10,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleRunWithInputs}
            >
              Run with inputs…
            </button>
          </div>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 4: Render the modal**

Add the import at the top of `app/page.tsx`:

```tsx
import RunInputsModal from './components/RunInputsModal';
```

Just before the closing `</>` of the component (right after the final `</div>` closing the `workspace` div around line 249), add:

```tsx
{runModalOpen && currentWorkflow && (
  <RunInputsModal
    declared={currentWorkflow.inputs ?? []}
    onSubmit={(values) => {
      setRunModalOpen(false);
      void postRun(values);
    }}
    onCancel={() => setRunModalOpen(false)}
  />
)}
```

- [ ] **Step 5: Run typecheck and existing tests**

Run: `bun run typecheck && bun test`
Expected: PASS for all existing tests; no regressions.

- [ ] **Step 6: Visual smoke test**

Run: `bun dev`. Manually verify, in order:

1. Workflow with no `inputs`: click **Run** → run starts immediately, no modal.
2. Workflow with one input that has a default: click **Run** → run starts immediately. Chevron menu shows "Run with inputs…" which opens the modal prefilled with the default.
3. Workflow with one input that has *no* default: click **Run** → modal opens, prefilled empty. Submit empty → "required" error. Type a value → submit → run starts.
4. Workflow with a number input: type `abc` → "expected number" error.

Expected: all four scenarios behave as described.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): prompt for workflow inputs when launching a run"
```

---

## Self-Review

The plan was self-reviewed for spec coverage, placeholders, and type consistency before commit. Open items intentionally deferred to implementation (e.g. the `__inputs` alias choice — resolved in Task 5 by seeding *both* `inputs` and `__inputs` in the child scope for back-compat) are flagged inline.

Spec items covered by task:
- Data model: Task 1.
- `resolveRunInputs` resolver: Task 2.
- Engine scope seeding: Task 3.
- API validation + run trigger: Task 4.
- Subworkflow back-compat alias (`__inputs` → also `inputs`): Task 5. (Strict typed resolution for the subworkflow path is intentionally deferred — see Task 5's "Why narrow" note.)
- Template autocomplete + lint: Task 6.
- Client store action: Task 7.
- Begin-node config editor: Task 8.
- RunInputsModal: Task 9.
- UI Run flow + chevron menu: Task 10.

Out-of-scope items (per the spec): secrets, enum types, per-input validation rules, replay UX — not in this plan.
