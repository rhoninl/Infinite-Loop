# Dispatch v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move webhook triggers out of workflow JSON into a top-level registry, add a UI-managed Dispatch section with CRUD, and introduce a JSON-only plugin system so trigger authoring is point-and-click for known sources (GitHub) while preserving v1's free-form templating fallback (Generic).

**Architecture:** Triggers become first-class entities in `triggers/<id>.json`, each referencing a `workflowId` and a `pluginId`. Plugins under `webhook-plugins/<id>.json` declare events + field schemas. The webhook route gains a plugin event-header check before user predicates. A new Dispatch view (top-bar button, hash-routed) lists and edits triggers with a field-picker driven by the chosen plugin's schema. `resolveRunInputs` learns to coerce numeric/boolean strings to fix the v1 GitHub-issue bug.

**Tech Stack:** TypeScript on Bun, Next.js 15 App Router, React 19, Zustand store, plain HTML + project CSS variables for UI, `bun:test`.

**Reference spec:** `specs/dispatch-v2.md`

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `lib/shared/trigger.ts` | Trigger and plugin type definitions (moved out of `workflow.ts`). |
| `lib/server/trigger-store.ts` | Filesystem CRUD for `triggers/<id>.json` plus `saveTrigger` validation. |
| `lib/server/trigger-store.test.ts` | Unit tests. |
| `lib/server/webhook-plugins/loader.ts` | Plugin file scan + validation. |
| `lib/server/webhook-plugins/loader.test.ts` | |
| `lib/server/webhook-plugins/index.ts` | Singleton `pluginIndex` with `lookup`, `list`, `invalidate`. |
| `lib/server/webhook-plugins/index.test.ts` | |
| `webhook-plugins/generic.json` | Built-in Generic plugin (no schema). |
| `webhook-plugins/github.json` | Built-in GitHub plugin (push/pull_request/issues/issue_comment). |
| `app/api/triggers/route.ts` | `GET` list (with `?workflowId=` filter) + `POST` create. |
| `app/api/triggers/route.test.ts` | |
| `app/api/triggers/[id]/route.ts` | `GET`/`PUT`/`DELETE` one trigger. |
| `app/api/triggers/[id]/route.test.ts` | |
| `app/api/triggers/[id]/test/route.ts` | Test-fire route that re-uses the real webhook handler. |
| `app/api/triggers/[id]/test/route.test.ts` | |
| `app/api/webhook-plugins/route.ts` | `GET` plugin list. |
| `app/api/webhook-plugins/route.test.ts` | |
| `app/components/FieldPicker.tsx` | Reusable text-input + autocomplete dropdown for plugin-event field paths. |
| `app/components/FieldPicker.test.tsx` | |
| `app/components/TriggerForm.tsx` | The create/edit form. |
| `app/components/TriggerForm.test.tsx` | |
| `app/components/DispatchView.tsx` | Master/detail layout: list + form pane. |
| `app/components/DispatchView.test.tsx` | |
| `app/components/TestFireModal.tsx` | JSON payload editor + send button + response display. |
| `app/components/TestFireModal.test.tsx` | |
| `lib/server/dispatch-integration.test.ts` | End-to-end GitHub-issues plugin path. |

**Modified files:**

| File | Change |
|---|---|
| `lib/shared/workflow.ts` | Drop `WebhookTrigger`, `TriggerPredicate`, `Workflow.triggers?`. Keep `trigger_*` event variants. |
| `lib/shared/resolve-run-inputs.ts` | Coerce numeric/boolean strings to their declared input type. |
| `lib/server/workflow-store.ts` | Drop trigger validation paths; add migrator that copies `wf.triggers[]` into the trigger store; drop trigger-index invalidation calls (now done by trigger-store). |
| `lib/server/trigger-index.ts` | Read from `trigger-store.listTriggers()` instead of scanning workflows. |
| `app/api/webhook/[triggerId]/route.ts` | Look up plugin via `pluginIndex`; check `eventHeader` if set, before user predicates. |
| `app/components/TriggersPanel.tsx` | Shrink to a summary card with "Manage in Dispatch →" link. |
| `app/page.tsx` | New top-bar "Dispatch" button; hash router (`#dispatch`) switches between canvas view and DispatchView. |
| `app/globals.css` | Append `dsp-*` and `trg-form-*` rule blocks. |
| `README.md` | Replace v1 webhook section with v2 (Dispatch UI + plugins). |

---

## Pre-flight

- [ ] **Create the feature branch.**

```bash
cd /Users/liyuqi/project/Codecase/InfLoop
git checkout main
git pull
git checkout -b feat/dispatch-v2
```

- [ ] **Confirm v1 is merged and the workflow has triggers in its JSON** (we need it for migration testing later).

```bash
git log --oneline -3
ls workflows/github-issue-triage.json
grep -c '"triggers"' workflows/github-issue-triage.json   # should be > 0
```

---

### Task 1: Move trigger types to lib/shared/trigger.ts and add plugin types

**Files:**
- Create: `lib/shared/trigger.ts`
- Modify: `lib/shared/workflow.ts`

- [ ] **Step 1: Create the new types module**

Create `lib/shared/trigger.ts`:

```ts
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
```

- [ ] **Step 2: Strip the moved types from `lib/shared/workflow.ts`**

Open `lib/shared/workflow.ts`. Delete:
- The `TriggerPredicateOp`, `TriggerPredicate`, and `WebhookTrigger` interfaces (block currently around lines 104–128).
- The `triggers?: WebhookTrigger[]` field on the `Workflow` interface (currently around line 286).

Keep the three `Trigger*Event` interfaces and their entries in the `WorkflowEvent` union — those remain part of the live event stream.

Confirm the file still typechecks by adding the right import where any internal reference remains. Search the file for `WebhookTrigger` / `TriggerPredicate`; any leftover use needs to import from `./trigger`.

- [ ] **Step 3: Update every consumer to import from the new module**

Run:

```bash
grep -rn "WebhookTrigger\|TriggerPredicate\b" lib app --include="*.ts" --include="*.tsx" | grep -v "trigger.ts\|workflow.ts"
```

For each match, change the import line to read from `@/lib/shared/trigger` (relative paths in `lib/`).

Typical replacements: in `lib/server/trigger-index.ts`, `lib/server/trigger-queue.ts`, `lib/server/trigger-queue-singleton.ts`, `app/api/webhook/[triggerId]/route.ts`, `app/api/triggers/queue/route.ts`, `app/components/TriggersPanel.tsx`.

- [ ] **Step 4: Typecheck and test**

```bash
bun run typecheck
bun test
```

Expected: all green. Tests don't need to change (no runtime behavior changed).

- [ ] **Step 5: Commit**

```bash
git add lib/shared/trigger.ts lib/shared/workflow.ts lib/server lib/client app
git commit -m "types: extract trigger + plugin types into lib/shared/trigger.ts"
```

---

### Task 2: Coerce numeric/boolean strings in resolveRunInputs

**Files:**
- Modify: `lib/shared/resolve-run-inputs.ts`
- Modify: `lib/shared/resolve-run-inputs.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `lib/shared/resolve-run-inputs.test.ts`:

```ts
describe('resolveRunInputs string coercion (Dispatch v2)', () => {
  test('coerces "42" to 42 for a number-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'n', type: 'number' }],
      { n: '42' },
    );
    expect(r.n).toBe(42);
  });

  test('coerces "3.14" to 3.14 for a number-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'n', type: 'number' }],
      { n: '3.14' },
    );
    expect(r.n).toBe(3.14);
  });

  test('rejects a non-numeric string for number-typed input', () => {
    expect(() =>
      resolveRunInputs(
        [{ name: 'n', type: 'number' }],
        { n: 'abc' },
      ),
    ).toThrow(/n/);
  });

  test('coerces "true" / "false" to boolean (case-insensitive)', () => {
    const r1 = resolveRunInputs(
      [{ name: 'b', type: 'boolean' }],
      { b: 'true' },
    );
    expect(r1.b).toBe(true);

    const r2 = resolveRunInputs(
      [{ name: 'b', type: 'boolean' }],
      { b: 'FALSE' },
    );
    expect(r2.b).toBe(false);
  });

  test('rejects a non-boolean string for boolean-typed input', () => {
    expect(() =>
      resolveRunInputs(
        [{ name: 'b', type: 'boolean' }],
        { b: 'yes' },
      ),
    ).toThrow(/b/);
  });

  test('native number still works for number-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'n', type: 'number' }],
      { n: 42 },
    );
    expect(r.n).toBe(42);
  });

  test('native boolean still works for boolean-typed input', () => {
    const r = resolveRunInputs(
      [{ name: 'b', type: 'boolean' }],
      { b: true },
    );
    expect(r.b).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test lib/shared/resolve-run-inputs.test.ts`
Expected: the new "coerces" tests FAIL with type errors.

- [ ] **Step 3: Update the `coerce` function in `lib/shared/resolve-run-inputs.ts`**

Replace the `number` and `boolean` cases with:

```ts
    case 'number': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string') {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
      throw new WorkflowInputError({
        field: d.name,
        reason: 'type',
        expected: 'number',
        got: typeof raw,
      });
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'string') {
        const lower = raw.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
      }
      throw new WorkflowInputError({
        field: d.name,
        reason: 'type',
        expected: 'boolean',
        got: typeof raw,
      });
    }
```

(The empty-string case is intentionally NOT coerced — an empty templated value means "missing data," which should hit the required-input check or the default fallback.)

- [ ] **Step 4: Run tests — should pass**

```bash
bun test lib/shared/resolve-run-inputs.test.ts
bun test
```

All green.

- [ ] **Step 5: Commit**

```bash
git add lib/shared/resolve-run-inputs.ts lib/shared/resolve-run-inputs.test.ts
git commit -m "fix(inputs): coerce numeric/boolean strings to declared types"
```

---

### Task 3: Webhook plugin loader

**Files:**
- Create: `lib/server/webhook-plugins/loader.ts`
- Create: `lib/server/webhook-plugins/loader.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/server/webhook-plugins/loader.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPlugins } from './loader';

const tmpDir = path.join(os.tmpdir(), `infloop-plugins-${process.pid}`);

async function writePlugin(name: string, body: unknown) {
  await fs.writeFile(
    path.join(tmpDir, `${name}.json`),
    JSON.stringify(body),
    'utf8',
  );
}

beforeEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadPlugins', () => {
  test('returns the built-in Generic plugin even when dir is empty', async () => {
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'generic')).toBeDefined();
  });

  test('loads a valid plugin from disk', async () => {
    await writePlugin('github', {
      id: 'github',
      displayName: 'GitHub',
      eventHeader: 'x-github-event',
      events: [
        {
          type: 'push',
          displayName: 'Push',
          fields: [{ path: 'body.ref', type: 'string' }],
        },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    const gh = plugins.find((p) => p.id === 'github');
    expect(gh).toBeDefined();
    expect(gh?.events[0].type).toBe('push');
  });

  test('rejects a plugin missing id', async () => {
    await writePlugin('bad', {
      displayName: 'Bad',
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    // Built-in Generic still present, bad one filtered out
    expect(plugins.find((p) => p.id === 'generic')).toBeDefined();
    expect(plugins.find((p) => p.displayName === 'Bad')).toBeUndefined();
  });

  test('rejects a plugin with non-unique event types', async () => {
    await writePlugin('dup', {
      id: 'dup',
      displayName: 'Dup',
      events: [
        { type: 'a', displayName: 'A', fields: [] },
        { type: 'a', displayName: 'A2', fields: [] },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'dup')).toBeUndefined();
  });

  test('rejects a field with unknown type', async () => {
    await writePlugin('weird', {
      id: 'weird',
      displayName: 'Weird',
      events: [
        {
          type: 'x',
          displayName: 'X',
          fields: [{ path: 'body.x', type: 'mystery' }],
        },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'weird')).toBeUndefined();
  });

  test('a user plugin can NOT override the built-in generic id', async () => {
    await writePlugin('generic', {
      id: 'generic',
      displayName: 'NotGeneric',
      events: [{ type: 'any', displayName: 'Any', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    const g = plugins.find((p) => p.id === 'generic');
    expect(g?.displayName).toBe('Generic'); // built-in wins
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test lib/server/webhook-plugins/loader.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement the loader**

Create `lib/server/webhook-plugins/loader.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  PluginEvent,
  PluginField,
  PluginFieldType,
  WebhookPlugin,
} from '../../shared/trigger';

const FIELD_TYPES: PluginFieldType[] = [
  'string', 'number', 'boolean', 'array', 'object',
];

const BUILTIN_GENERIC: WebhookPlugin = {
  id: 'generic',
  displayName: 'Generic',
  icon: 'generic',
  events: [
    { type: 'any', displayName: 'Any POST', fields: [] },
  ],
};

function isStringNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validatePluginField(v: unknown, file: string): PluginField {
  if (!v || typeof v !== 'object') {
    throw new Error(`${file}: field must be an object`);
  }
  const f = v as Record<string, unknown>;
  if (!isStringNonEmpty(f.path)) throw new Error(`${file}: field.path must be non-empty string`);
  if (typeof f.type !== 'string' || !FIELD_TYPES.includes(f.type as PluginFieldType)) {
    throw new Error(`${file}: field.type "${f.type}" must be one of ${FIELD_TYPES.join(', ')}`);
  }
  if (f.description !== undefined && typeof f.description !== 'string') {
    throw new Error(`${file}: field.description must be string if set`);
  }
  return {
    path: f.path,
    type: f.type as PluginFieldType,
    description: f.description as string | undefined,
  };
}

function validatePluginEvent(v: unknown, file: string): PluginEvent {
  if (!v || typeof v !== 'object') throw new Error(`${file}: event must be an object`);
  const e = v as Record<string, unknown>;
  if (!isStringNonEmpty(e.type)) throw new Error(`${file}: event.type must be non-empty string`);
  if (!isStringNonEmpty(e.displayName)) {
    throw new Error(`${file}: event.displayName must be non-empty string`);
  }
  if (!Array.isArray(e.fields)) throw new Error(`${file}: event.fields must be array`);
  return {
    type: e.type,
    displayName: e.displayName,
    fields: e.fields.map((f) => validatePluginField(f, file)),
    examplePayload: e.examplePayload,
  };
}

function validatePlugin(raw: unknown, file: string): WebhookPlugin {
  if (!raw || typeof raw !== 'object') throw new Error(`${file}: not an object`);
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(p.id)) {
    throw new Error(`${file}: id must match /^[a-z][a-z0-9_-]*$/`);
  }
  if (!isStringNonEmpty(p.displayName)) {
    throw new Error(`${file}: displayName must be non-empty string`);
  }
  if (p.eventHeader !== undefined && !isStringNonEmpty(p.eventHeader)) {
    throw new Error(`${file}: eventHeader must be a non-empty string if set`);
  }
  if (!Array.isArray(p.events) || p.events.length === 0) {
    throw new Error(`${file}: events must be a non-empty array`);
  }
  const events = p.events.map((e) => validatePluginEvent(e, file));
  const seenTypes = new Set<string>();
  for (const ev of events) {
    if (seenTypes.has(ev.type)) {
      throw new Error(`${file}: duplicate event.type "${ev.type}"`);
    }
    seenTypes.add(ev.type);
  }
  return {
    id: p.id,
    displayName: p.displayName,
    icon: typeof p.icon === 'string' ? p.icon : undefined,
    eventHeader: p.eventHeader as string | undefined,
    events,
  };
}

/** Scan `dir` for `*.json` plugin files; combine with the built-in Generic
 *  plugin. Invalid files are skipped with a console error. The built-in
 *  Generic plugin always wins over a user file with the same id. */
export async function loadPlugins(dir: string): Promise<WebhookPlugin[]> {
  const out: WebhookPlugin[] = [BUILTIN_GENERIC];
  const seenIds = new Set<string>(['generic']);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.endsWith('.json.tmp')) continue;
    const full = path.join(dir, entry);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const parsed = JSON.parse(raw);
      const plugin = validatePlugin(parsed, entry);
      if (seenIds.has(plugin.id)) {
        console.error(`[webhook-plugins] skipping ${entry}: id "${plugin.id}" already loaded`);
        continue;
      }
      seenIds.add(plugin.id);
      out.push(plugin);
    } catch (err) {
      console.error(`[webhook-plugins] failed to load ${entry}:`, err);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

```bash
bun test lib/server/webhook-plugins/loader.test.ts
```

Expected: all 6 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/server/webhook-plugins/loader.ts lib/server/webhook-plugins/loader.test.ts
git commit -m "feat: webhook plugin loader with built-in Generic"
```

---

### Task 4: Webhook plugin singleton

**Files:**
- Create: `lib/server/webhook-plugins/index.ts`
- Create: `lib/server/webhook-plugins/index.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/server/webhook-plugins/index.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { pluginIndex } from './index';

describe('pluginIndex singleton', () => {
  test('lookup returns the built-in Generic plugin', async () => {
    const g = await pluginIndex.lookup('generic');
    expect(g?.id).toBe('generic');
  });

  test('list contains Generic', async () => {
    const all = await pluginIndex.list();
    expect(all.find((p) => p.id === 'generic')).toBeDefined();
  });

  test('lookup returns undefined for unknown id', async () => {
    expect(await pluginIndex.lookup('absent')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run failing test**

`bun test lib/server/webhook-plugins/index.test.ts` — expect module-not-found.

- [ ] **Step 3: Implement the singleton**

Create `lib/server/webhook-plugins/index.ts`:

```ts
import path from 'node:path';
import { loadPlugins } from './loader';
import type { WebhookPlugin } from '../../shared/trigger';

function pluginsDir(): string {
  return (
    process.env.INFLOOP_WEBHOOK_PLUGINS_DIR ||
    path.join(process.cwd(), 'webhook-plugins')
  );
}

class PluginIndex {
  private cache: WebhookPlugin[] | null = null;
  private building: Promise<WebhookPlugin[]> | null = null;

  async list(): Promise<WebhookPlugin[]> {
    return this.ensure();
  }

  async lookup(id: string): Promise<WebhookPlugin | undefined> {
    const all = await this.ensure();
    return all.find((p) => p.id === id);
  }

  invalidate(): void {
    this.cache = null;
    this.building = null;
  }

  private async ensure(): Promise<WebhookPlugin[]> {
    if (this.cache) return this.cache;
    if (this.building) return this.building;
    this.building = (async () => {
      const plugins = await loadPlugins(pluginsDir());
      this.cache = plugins;
      this.building = null;
      return plugins;
    })();
    return this.building;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __infloopPluginIndex: PluginIndex | undefined;
}

export const pluginIndex: PluginIndex =
  globalThis.__infloopPluginIndex ?? new PluginIndex();
if (!globalThis.__infloopPluginIndex) {
  globalThis.__infloopPluginIndex = pluginIndex;
}
```

- [ ] **Step 4: Run tests**

`bun test lib/server/webhook-plugins/index.test.ts` — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/server/webhook-plugins/index.ts lib/server/webhook-plugins/index.test.ts
git commit -m "feat: webhook plugin index singleton"
```

---

### Task 5: Built-in plugin JSON files

**Files:**
- Create: `webhook-plugins/github.json`

(The Generic plugin is in code in the loader; only GitHub needs a file.)

- [ ] **Step 1: Create the GitHub plugin file**

Create `webhook-plugins/github.json`:

```json
{
  "id": "github",
  "displayName": "GitHub",
  "icon": "github",
  "eventHeader": "x-github-event",
  "events": [
    {
      "type": "push",
      "displayName": "Push",
      "fields": [
        { "path": "body.ref",                          "type": "string", "description": "Git ref pushed (e.g. refs/heads/main)" },
        { "path": "body.after",                        "type": "string", "description": "Commit SHA after the push" },
        { "path": "body.before",                       "type": "string", "description": "Commit SHA before the push" },
        { "path": "body.repository.full_name",         "type": "string", "description": "owner/repo" },
        { "path": "body.pusher.name",                  "type": "string", "description": "GitHub username pushing" },
        { "path": "body.head_commit.author.name",      "type": "string" },
        { "path": "body.head_commit.author.email",     "type": "string" },
        { "path": "body.head_commit.message",          "type": "string" },
        { "path": "body.head_commit.id",               "type": "string" },
        { "path": "body.commits",                      "type": "array",  "description": "All commits in this push" }
      ],
      "examplePayload": {
        "ref": "refs/heads/main",
        "before": "0000000000000000000000000000000000000000",
        "after": "abc123",
        "repository": { "full_name": "owner/repo" },
        "pusher": { "name": "you" },
        "head_commit": {
          "id": "abc123",
          "author": { "name": "you", "email": "you@example.com" },
          "message": "Update README"
        },
        "commits": []
      }
    },
    {
      "type": "issues",
      "displayName": "Issue",
      "fields": [
        { "path": "body.action",               "type": "string", "description": "opened, closed, edited, reopened, …" },
        { "path": "body.issue.number",         "type": "number" },
        { "path": "body.issue.title",          "type": "string" },
        { "path": "body.issue.body",           "type": "string" },
        { "path": "body.issue.state",          "type": "string", "description": "open or closed" },
        { "path": "body.issue.user.login",     "type": "string", "description": "issue author" },
        { "path": "body.issue.html_url",       "type": "string" },
        { "path": "body.repository.full_name", "type": "string" },
        { "path": "body.sender.login",         "type": "string", "description": "who triggered this event" }
      ],
      "examplePayload": {
        "action": "opened",
        "issue": {
          "number": 1,
          "title": "Example issue",
          "body": "Steps to reproduce …",
          "state": "open",
          "user": { "login": "you" },
          "html_url": "https://github.com/owner/repo/issues/1"
        },
        "repository": { "full_name": "owner/repo" },
        "sender": { "login": "you" }
      }
    },
    {
      "type": "issue_comment",
      "displayName": "Issue comment",
      "fields": [
        { "path": "body.action",               "type": "string", "description": "created, edited, deleted" },
        { "path": "body.issue.number",         "type": "number" },
        { "path": "body.issue.title",          "type": "string" },
        { "path": "body.comment.body",         "type": "string" },
        { "path": "body.comment.user.login",   "type": "string" },
        { "path": "body.comment.html_url",     "type": "string" },
        { "path": "body.repository.full_name", "type": "string" }
      ],
      "examplePayload": {
        "action": "created",
        "issue": { "number": 1, "title": "Example issue" },
        "comment": {
          "user": { "login": "you" },
          "body": "Nice work!",
          "html_url": "https://github.com/owner/repo/issues/1#issuecomment-1"
        },
        "repository": { "full_name": "owner/repo" }
      }
    },
    {
      "type": "pull_request",
      "displayName": "Pull request",
      "fields": [
        { "path": "body.action",                    "type": "string", "description": "opened, closed, reopened, synchronize, ready_for_review, …" },
        { "path": "body.pull_request.number",       "type": "number" },
        { "path": "body.pull_request.title",        "type": "string" },
        { "path": "body.pull_request.body",         "type": "string" },
        { "path": "body.pull_request.state",        "type": "string" },
        { "path": "body.pull_request.merged",       "type": "boolean" },
        { "path": "body.pull_request.user.login",   "type": "string" },
        { "path": "body.pull_request.head.ref",     "type": "string", "description": "source branch" },
        { "path": "body.pull_request.base.ref",     "type": "string", "description": "target branch" },
        { "path": "body.pull_request.head.sha",     "type": "string" },
        { "path": "body.repository.full_name",      "type": "string" }
      ],
      "examplePayload": {
        "action": "opened",
        "pull_request": {
          "number": 1,
          "title": "Example PR",
          "body": "…",
          "state": "open",
          "merged": false,
          "user": { "login": "you" },
          "head": { "ref": "feat/x", "sha": "abc123" },
          "base": { "ref": "main" }
        },
        "repository": { "full_name": "owner/repo" }
      }
    }
  ]
}
```

- [ ] **Step 2: Verify the file loads**

```bash
bun -e "
import { pluginIndex } from './lib/server/webhook-plugins/index';
pluginIndex.invalidate();
const all = await pluginIndex.list();
console.log('plugins:', all.map((p) => p.id).join(', '));
const gh = await pluginIndex.lookup('github');
console.log('github events:', gh?.events.map((e) => e.type).join(', '));
"
```

Expected output:
```
plugins: generic, github
github events: push, issues, issue_comment, pull_request
```

- [ ] **Step 3: Commit**

```bash
git add webhook-plugins/github.json
git commit -m "feat: built-in GitHub webhook plugin (push/issues/issue_comment/pull_request)"
```

---

### Task 6: Trigger store

**Files:**
- Create: `lib/server/trigger-store.ts`
- Create: `lib/server/trigger-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/server/trigger-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  listTriggers,
  getTrigger,
  saveTrigger,
  deleteTrigger,
} from './trigger-store';
import type { WebhookTrigger } from '../shared/trigger';

const tmpWfDir = path.join(os.tmpdir(), `infloop-tstore-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infloop-tstore-tr-${process.pid}`);

async function writeWorkflow(id: string, inputs: unknown[] = []) {
  await fs.writeFile(
    path.join(tmpWfDir, `${id}.json`),
    JSON.stringify({
      id, name: id, version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs,
    }),
  );
}

function baseTrigger(overrides: Partial<WebhookTrigger> = {}): Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> {
  return {
    id: 'idAAAAAAAAAAAAAAAAAAAA',
    name: 'test',
    enabled: true,
    workflowId: 'wf-a',
    pluginId: 'generic',
    match: [],
    inputs: {},
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  await writeWorkflow('wf-a');
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
});

describe('trigger-store', () => {
  test('saveTrigger writes a file and listTriggers reads it back', async () => {
    const saved = await saveTrigger(baseTrigger());
    expect(saved.id).toBe('idAAAAAAAAAAAAAAAAAAAA');
    expect(saved.createdAt).toBeGreaterThan(0);
    expect(saved.updatedAt).toBeGreaterThan(0);
    const list = await listTriggers();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('idAAAAAAAAAAAAAAAAAAAA');
  });

  test('saveTrigger rejects an invalid id', async () => {
    await expect(saveTrigger(baseTrigger({ id: 'bad' }))).rejects.toThrow(/id/i);
  });

  test('saveTrigger rejects an unknown plugin', async () => {
    await expect(
      saveTrigger(baseTrigger({ pluginId: 'imaginary' })),
    ).rejects.toThrow(/plugin/i);
  });

  test('saveTrigger requires eventType when plugin has eventHeader', async () => {
    await expect(
      saveTrigger(baseTrigger({ pluginId: 'github' /* missing eventType */ })),
    ).rejects.toThrow(/eventType|event/i);
  });

  test('saveTrigger accepts a valid GitHub event type', async () => {
    const saved = await saveTrigger(
      baseTrigger({ pluginId: 'github', eventType: 'issues' }),
    );
    expect(saved.eventType).toBe('issues');
  });

  test('saveTrigger rejects an unknown event type for github', async () => {
    await expect(
      saveTrigger(baseTrigger({ pluginId: 'github', eventType: 'merge_queue' })),
    ).rejects.toThrow(/event/i);
  });

  test('saveTrigger rejects an unknown workflowId', async () => {
    await expect(
      saveTrigger(baseTrigger({ workflowId: 'nope' })),
    ).rejects.toThrow(/workflow/i);
  });

  test('saveTrigger rejects an input key not declared on the workflow', async () => {
    await expect(
      saveTrigger(baseTrigger({ inputs: { undeclared: '{{body.x}}' } })),
    ).rejects.toThrow(/undeclared/);
  });

  test('saveTrigger accepts inputs that match declared workflow inputs', async () => {
    await writeWorkflow('wf-a', [{ name: 'branch', type: 'string' }]);
    const saved = await saveTrigger(
      baseTrigger({ inputs: { branch: '{{body.ref}}' } }),
    );
    expect(saved.inputs.branch).toBe('{{body.ref}}');
  });

  test('deleteTrigger removes the file', async () => {
    await saveTrigger(baseTrigger());
    await deleteTrigger('idAAAAAAAAAAAAAAAAAAAA');
    expect(await listTriggers()).toHaveLength(0);
  });

  test('getTrigger throws when missing', async () => {
    await expect(getTrigger('absent_id_000000000000')).rejects.toThrow(/not found/i);
  });

  test('saveTrigger second call preserves createdAt and bumps updatedAt', async () => {
    const first = await saveTrigger(baseTrigger());
    // Force a ms gap so timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveTrigger({ ...first, name: 'renamed' });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test lib/server/trigger-store.test.ts` — module-not-found.

- [ ] **Step 3: Implement the store**

Create `lib/server/trigger-store.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WebhookTrigger, WebhookPlugin } from '../shared/trigger';
import { getWorkflow } from './workflow-store';
import { pluginIndex } from './webhook-plugins';
import { triggerIndex } from './trigger-index';

const TRIGGER_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const ALLOWED_OPS = new Set(['==', '!=', 'contains', 'matches']);

function triggersDir(): string {
  return (
    process.env.INFLOOP_TRIGGERS_DIR ||
    path.join(process.cwd(), 'triggers')
  );
}

function fileFor(id: string): string {
  return path.join(triggersDir(), `${id}.json`);
}

class TriggerNotFoundError extends Error {
  constructor(id: string) {
    super(`trigger not found: ${id}`);
    this.name = 'TriggerNotFoundError';
  }
}

async function validateTrigger(t: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'>): Promise<void> {
  if (typeof t.id !== 'string' || !TRIGGER_ID_RE.test(t.id)) {
    throw new Error(`invalid trigger: id "${t.id}" must match /^[A-Za-z0-9_-]{16,32}$/`);
  }
  if (typeof t.name !== 'string' || t.name.length === 0) {
    throw new Error(`invalid trigger: name must be non-empty`);
  }
  if (typeof t.enabled !== 'boolean') {
    throw new Error(`invalid trigger: enabled must be boolean`);
  }
  if (typeof t.workflowId !== 'string' || t.workflowId.length === 0) {
    throw new Error(`invalid trigger: workflowId must be non-empty`);
  }
  if (typeof t.pluginId !== 'string' || t.pluginId.length === 0) {
    throw new Error(`invalid trigger: pluginId must be non-empty`);
  }

  const plugin = await pluginIndex.lookup(t.pluginId);
  if (!plugin) {
    throw new Error(`invalid trigger: plugin "${t.pluginId}" not found`);
  }
  if (plugin.eventHeader) {
    if (!t.eventType) {
      throw new Error(`invalid trigger: plugin "${plugin.id}" requires eventType`);
    }
    if (!plugin.events.some((e) => e.type === t.eventType)) {
      throw new Error(`invalid trigger: event "${t.eventType}" not declared by plugin "${plugin.id}"`);
    }
  }

  if (!Array.isArray(t.match)) throw new Error(`invalid trigger: match must be array`);
  for (const p of t.match) {
    if (
      !p || typeof p !== 'object' ||
      typeof (p as { lhs: unknown }).lhs !== 'string' ||
      typeof (p as { rhs: unknown }).rhs !== 'string' ||
      !ALLOWED_OPS.has((p as { op: unknown }).op as string)
    ) {
      throw new Error(`invalid trigger: predicate must have string lhs/rhs and valid op`);
    }
  }

  if (!t.inputs || typeof t.inputs !== 'object' || Array.isArray(t.inputs)) {
    throw new Error(`invalid trigger: inputs must be a record`);
  }

  // Workflow check + input-key subset
  let workflow;
  try {
    workflow = await getWorkflow(t.workflowId);
  } catch {
    throw new Error(`invalid trigger: workflow "${t.workflowId}" not found`);
  }
  const declaredNames = new Set((workflow.inputs ?? []).map((i) => i.name));
  for (const key of Object.keys(t.inputs)) {
    if (!declaredNames.has(key)) {
      throw new Error(`invalid trigger: inputs.${key} is not a declared workflow input on "${workflow.id}"`);
    }
    if (typeof (t.inputs as Record<string, unknown>)[key] !== 'string') {
      throw new Error(`invalid trigger: inputs.${key} must be a templated string`);
    }
  }
}

export async function listTriggers(): Promise<WebhookTrigger[]> {
  const dir = triggersDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files = entries.filter((e) => e.endsWith('.json') && !e.endsWith('.json.tmp'));
  const out: WebhookTrigger[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      const parsed = JSON.parse(raw) as WebhookTrigger;
      out.push(parsed);
    } catch (err) {
      console.error(`[trigger-store] failed to read ${file}:`, err);
    }
  }
  return out;
}

export async function getTrigger(id: string): Promise<WebhookTrigger> {
  try {
    const raw = await fs.readFile(fileFor(id), 'utf8');
    return JSON.parse(raw) as WebhookTrigger;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TriggerNotFoundError(id);
    }
    throw err;
  }
}

export async function saveTrigger(
  t: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> & Partial<Pick<WebhookTrigger, 'createdAt' | 'updatedAt'>>,
): Promise<WebhookTrigger> {
  await validateTrigger(t);

  const dir = triggersDir();
  await fs.mkdir(dir, { recursive: true });

  let existing: WebhookTrigger | null = null;
  try {
    existing = await getTrigger(t.id);
  } catch (err) {
    if (!(err instanceof TriggerNotFoundError)) throw err;
  }

  const now = Date.now();
  const saved: WebhookTrigger = {
    ...t,
    createdAt: existing?.createdAt ?? t.createdAt ?? now,
    updatedAt: now,
    lastFiredAt: existing?.lastFiredAt ?? null,
  };

  const target = fileFor(saved.id);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(saved, null, 2), 'utf8');
  await fs.rename(tmp, target);

  triggerIndex.invalidate();
  return saved;
}

export async function deleteTrigger(id: string): Promise<void> {
  try {
    await fs.unlink(fileFor(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TriggerNotFoundError(id);
    }
    throw err;
  }
  triggerIndex.invalidate();
}

export { TriggerNotFoundError };
```

- [ ] **Step 4: Run tests**

```bash
bun test lib/server/trigger-store.test.ts
```

Expected: all pass (the cross-module imports require `triggerIndex.invalidate()` to exist — it does, from v1).

- [ ] **Step 5: Commit**

```bash
git add lib/server/trigger-store.ts lib/server/trigger-store.test.ts
git commit -m "feat: trigger-store with plugin/workflow/input validation"
```

---

### Task 7: Migrate trigger-index to read from trigger-store

**Files:**
- Modify: `lib/server/trigger-index.ts`
- Modify: `lib/server/trigger-index.test.ts`

- [ ] **Step 1: Read the existing module to see what shape `lookup` returns**

```bash
cat lib/server/trigger-index.ts
```

It currently scans workflows. We're swapping it to scan `trigger-store` while preserving the `lookup(id) → { workflowId, trigger }` return shape — the webhook route relies on that.

- [ ] **Step 2: Update tests**

Replace the body of `lib/server/trigger-index.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { triggerIndex } from './trigger-index';
import { saveTrigger } from './trigger-store';
import type { WebhookTrigger } from '../shared/trigger';

const tmpWfDir = path.join(os.tmpdir(), `infloop-tidx-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infloop-tidx-tr-${process.pid}`);

async function writeWorkflow(id: string, inputs: unknown[] = []) {
  await fs.writeFile(
    path.join(tmpWfDir, `${id}.json`),
    JSON.stringify({
      id, name: id, version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs,
    }),
  );
}

function baseTrigger(id: string, overrides: Partial<WebhookTrigger> = {}): Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> {
  return {
    id, name: id, enabled: true,
    workflowId: 'wf-a', pluginId: 'generic',
    match: [], inputs: {},
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  await writeWorkflow('wf-a');
  triggerIndex.invalidate();
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
});

describe('triggerIndex (Dispatch v2)', () => {
  test('returns undefined for unknown id', async () => {
    expect(await triggerIndex.lookup('absent_id_000000000000')).toBeUndefined();
  });

  test('finds a saved trigger by id', async () => {
    await saveTrigger(baseTrigger('idAAAAAAAAAAAAAAAAAAAA'));
    const hit = await triggerIndex.lookup('idAAAAAAAAAAAAAAAAAAAA');
    expect(hit?.workflowId).toBe('wf-a');
    expect(hit?.trigger.id).toBe('idAAAAAAAAAAAAAAAAAAAA');
  });

  test('saveTrigger invalidates the index automatically', async () => {
    await saveTrigger(baseTrigger('idBBBBBBBBBBBBBBBBBBBB'));
    expect(await triggerIndex.lookup('idBBBBBBBBBBBBBBBBBBBB')).toBeDefined();
    // (saveTrigger calls triggerIndex.invalidate(); no manual call needed)
  });
});
```

- [ ] **Step 3: Replace trigger-index implementation**

Overwrite `lib/server/trigger-index.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

```bash
bun test lib/server/trigger-index.test.ts
bun test lib/server/trigger-store.test.ts
```

Both green.

- [ ] **Step 5: Commit**

```bash
git add lib/server/trigger-index.ts lib/server/trigger-index.test.ts
git commit -m "refactor: trigger-index reads from trigger-store"
```

---

### Task 8: Workflow-store migration + remove old trigger validation

**Files:**
- Modify: `lib/server/workflow-store.ts`
- Modify: `lib/server/workflow-store.test.ts`

- [ ] **Step 1: Write failing migration test**

Add a new describe block to `lib/server/workflow-store.test.ts`:

```ts
describe('saveWorkflow migration: legacy triggers[] → trigger-store', () => {
  test('migrates legacy triggers on load and the in-memory workflow has them stripped', async () => {
    // Setup: write a legacy workflow JSON with triggers[] inline
    const wfId = 'legacy-wf';
    const triggerId = 'idCCCCCCCCCCCCCCCCCCCC';
    await fs.writeFile(
      path.join(tmpDir, `${wfId}.json`),
      JSON.stringify({
        id: wfId, name: wfId, version: 1, createdAt: 0, updatedAt: 0,
        nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
        edges: [],
        inputs: [{ name: 'msg', type: 'string', default: '' }],
        triggers: [
          {
            id: triggerId, name: 't', enabled: true,
            match: [], inputs: { msg: '{{body.message}}' },
          },
        ],
      }),
    );

    const { getWorkflow } = await import('./workflow-store');
    const wf = await getWorkflow(wfId);
    // In-memory copy has triggers stripped
    expect((wf as Workflow & { triggers?: unknown }).triggers).toBeUndefined();

    // Trigger landed in the registry
    const { getTrigger } = await import('./trigger-store');
    const t = await getTrigger(triggerId);
    expect(t.workflowId).toBe(wfId);
    expect(t.pluginId).toBe('generic');
    expect(t.inputs.msg).toBe('{{body.message}}');
  });

  test('migration is idempotent across multiple loads', async () => {
    const wfId = 'legacy-wf-2';
    const triggerId = 'idDDDDDDDDDDDDDDDDDDDD';
    await fs.writeFile(
      path.join(tmpDir, `${wfId}.json`),
      JSON.stringify({
        id: wfId, name: wfId, version: 1, createdAt: 0, updatedAt: 0,
        nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
        edges: [], inputs: [],
        triggers: [
          { id: triggerId, name: 't', enabled: true, match: [], inputs: {} },
        ],
      }),
    );

    const { getWorkflow } = await import('./workflow-store');
    await getWorkflow(wfId);
    await getWorkflow(wfId); // second load — must not error
    const { listTriggers } = await import('./trigger-store');
    const all = await listTriggers();
    const matches = all.filter((t) => t.id === triggerId);
    expect(matches).toHaveLength(1);
  });
});
```

(Adapt `tmpDir`, the imports, and `process.env.INFLOOP_TRIGGERS_DIR` setup to match the existing beforeEach pattern in the test file; ensure both `INFLOOP_WORKFLOWS_DIR` and `INFLOOP_TRIGGERS_DIR` get isolated per test.)

Also delete the entire `describe('saveWorkflow trigger validation', ...)` block from v1 — those rules now live in trigger-store.

- [ ] **Step 2: Run failing tests**

`bun test lib/server/workflow-store.test.ts` — expect new migration tests to FAIL; old trigger-validation suites are gone.

- [ ] **Step 3: Strip v1 trigger validation and add migrator**

In `lib/server/workflow-store.ts`:

a. **Delete** `validateTriggers`, `validateNoCrossWorkflowTriggerCollisions`, and the calls to them inside `saveWorkflow`.
b. **Delete** the `import { triggerIndex } from './trigger-index'` and the two `triggerIndex.invalidate()` calls in `saveWorkflow` / `deleteWorkflow` — that responsibility now lives entirely in `trigger-store`.
c. **Add** the migrator. At the top of the file, add:

```ts
import { saveTrigger, getTrigger, TriggerNotFoundError } from './trigger-store';
import type { WebhookTrigger } from '../shared/trigger';
```

d. In `migrateWorkflow` (the existing helper that handles v5→v6 node rewrites), do not couple new trigger work to that synchronous migrator — it runs inside `readWorkflowFile` and we need async + side-effects. Instead, **wrap `readWorkflowFile` with an async migrator**. Edit `getWorkflow`:

```ts
export async function getWorkflow(id: string): Promise<Workflow> {
  const wf = await readWorkflowFile(id);
  await migrateLegacyTriggers(wf);
  return wf;
}
```

Add the migrator function above `getWorkflow`:

```ts
async function migrateLegacyTriggers(wf: Workflow & { triggers?: unknown }): Promise<void> {
  const legacy = (wf as { triggers?: unknown }).triggers;
  if (!Array.isArray(legacy) || legacy.length === 0) {
    // Strip any non-array `triggers` field too (defensive).
    delete (wf as { triggers?: unknown }).triggers;
    return;
  }

  for (const raw of legacy) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id : undefined;
    if (!id) continue;

    try {
      await getTrigger(id);
      // Already migrated; skip.
      continue;
    } catch (err) {
      if (!(err instanceof TriggerNotFoundError)) {
        console.error(`[workflow-store] migration: failed to check trigger ${id}:`, err);
        continue;
      }
    }

    const payload: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> = {
      id,
      name: typeof t.name === 'string' ? t.name : id,
      enabled: typeof t.enabled === 'boolean' ? t.enabled : true,
      workflowId: wf.id,
      pluginId: 'generic',
      match: Array.isArray(t.match) ? (t.match as WebhookTrigger['match']) : [],
      inputs:
        t.inputs && typeof t.inputs === 'object' && !Array.isArray(t.inputs)
          ? (t.inputs as Record<string, string>)
          : {},
    };

    try {
      await saveTrigger(payload);
    } catch (err) {
      console.error(`[workflow-store] migration: failed to save trigger ${id}:`, err);
    }
  }

  // Strip the legacy field from the in-memory copy. The file is rewritten
  // without it on the next saveWorkflow call (the existing version-bump path).
  delete (wf as { triggers?: unknown }).triggers;
}
```

e. **In `saveWorkflow`**: any pre-save trigger validation paths (now deleted) leave a `saved: Workflow` that needs to omit `triggers` from the JSON written to disk. Since `validateWorkflow` doesn't include `triggers` in the saved payload, just ensure the in-memory workflow passed in doesn't write the field back. Easiest fix: strip it explicitly in the saved object:

```ts
  const saved: Workflow = {
    ...workflow,
    triggers: undefined,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? workflow.createdAt ?? now,
    updatedAt: now,
  };
  // Drop the explicit `triggers: undefined` so JSON.stringify doesn't include it.
  delete (saved as { triggers?: unknown }).triggers;
```

- [ ] **Step 4: Run tests**

```bash
bun test lib/server/workflow-store.test.ts
bun test
```

Both green. The integration test that wrote a legacy workflow file should still pass — migration is automatic.

- [ ] **Step 5: Commit**

```bash
git add lib/server/workflow-store.ts lib/server/workflow-store.test.ts
git commit -m "feat: auto-migrate legacy triggers[] into the trigger-store on load"
```

---

### Task 9: Webhook route plugin event-header check

**Files:**
- Modify: `app/api/webhook/[triggerId]/route.ts`
- Modify: `app/api/webhook/[triggerId]/route.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `app/api/webhook/[triggerId]/route.test.ts` (replace `goodId` setup helpers as needed — the test file already has `writeWorkflow` and `mkReq`; you'll add a `saveTrigger` helper):

```ts
describe('plugin event-header filter (Dispatch v2)', () => {
  test('204 when plugin has eventHeader and request header is missing', async () => {
    await writeWorkflow('wf-gh', [{ name: 'x', type: 'string', default: '' }]);
    const { saveTrigger } = await import('@/lib/server/trigger-store');
    await saveTrigger({
      id: 'idGHGHGHGHGHGHGHGHGHGH', name: 'gh', enabled: true,
      workflowId: 'wf-gh', pluginId: 'github', eventType: 'issues',
      match: [], inputs: {},
    });
    triggerIndex.invalidate();
    const res = await POST(
      mkReq('idGHGHGHGHGHGHGHGHGHGH', {}, { /* no x-github-event */ }),
      { params: Promise.resolve({ triggerId: 'idGHGHGHGHGHGHGHGHGHGH' }) },
    );
    expect(res.status).toBe(204);
  });

  test('204 when plugin event-header mismatches trigger eventType', async () => {
    await writeWorkflow('wf-gh', [{ name: 'x', type: 'string', default: '' }]);
    const { saveTrigger } = await import('@/lib/server/trigger-store');
    await saveTrigger({
      id: 'idGH2GH2GH2GH2GH2GH2', name: 'gh2', enabled: true,
      workflowId: 'wf-gh', pluginId: 'github', eventType: 'issues',
      match: [], inputs: {},
    });
    triggerIndex.invalidate();
    const res = await POST(
      mkReq('idGH2GH2GH2GH2GH2GH2', {}, { 'x-github-event': 'push' }),
      { params: Promise.resolve({ triggerId: 'idGH2GH2GH2GH2GH2GH2' }) },
    );
    expect(res.status).toBe(204);
  });

  test('202 when plugin event-header matches and predicates pass', async () => {
    await writeWorkflow('wf-gh', [{ name: 'x', type: 'string', default: '' }]);
    const { saveTrigger } = await import('@/lib/server/trigger-store');
    await saveTrigger({
      id: 'idGH3GH3GH3GH3GH3GH3', name: 'gh3', enabled: true,
      workflowId: 'wf-gh', pluginId: 'github', eventType: 'issues',
      match: [], inputs: {},
    });
    triggerIndex.invalidate();
    const res = await POST(
      mkReq('idGH3GH3GH3GH3GH3GH3', { action: 'opened' }, { 'x-github-event': 'issues' }),
      { params: Promise.resolve({ triggerId: 'idGH3GH3GH3GH3GH3GH3' }) },
    );
    expect(res.status).toBe(202);
    triggerQueue.clear();
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test app/api/webhook/[triggerId]/route.test.ts` — new tests fail (no plugin filter yet).

- [ ] **Step 3: Add the plugin check to the route**

In `app/api/webhook/[triggerId]/route.ts`, add the import:

```ts
import { pluginIndex } from '@/lib/server/webhook-plugins';
```

Right after the existing `triggerIndex.lookup` + enabled check, BEFORE reading the body:

```ts
  const plugin = await pluginIndex.lookup(hit.trigger.pluginId);
  if (!plugin) return notFound();
  if (plugin.eventHeader) {
    const header = req.headers.get(plugin.eventHeader);
    if (!header || header !== hit.trigger.eventType) {
      return new Response(null, { status: 204 });
    }
  }
```

The rest of the route is unchanged.

- [ ] **Step 4: Run tests**

```bash
bun test app/api/webhook/[triggerId]/route.test.ts
bun test
```

All green.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook/[triggerId]/route.ts app/api/webhook/[triggerId]/route.test.ts
git commit -m "feat(webhook): plugin event-header filter before user predicates"
```

---

### Task 10: Triggers CRUD API routes

**Files:**
- Create: `app/api/triggers/route.ts`
- Create: `app/api/triggers/route.test.ts`
- Create: `app/api/triggers/[id]/route.ts`
- Create: `app/api/triggers/[id]/route.test.ts`

(The existing `app/api/triggers/queue/route.ts` from v1 stays — it lives at a different sub-path.)

- [ ] **Step 1: Write failing tests for the list/create route**

Create `app/api/triggers/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GET, POST } from './route';

const tmpWfDir = path.join(os.tmpdir(), `infloop-api-tr-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infloop-api-tr-tr-${process.pid}`);

async function writeWorkflow(id: string, inputs: unknown[] = []) {
  await fs.writeFile(
    path.join(tmpWfDir, `${id}.json`),
    JSON.stringify({
      id, name: id, version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs,
    }),
  );
}

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  await writeWorkflow('wf-a');
  await writeWorkflow('wf-b');
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
});

describe('GET /api/triggers', () => {
  test('returns empty list when none exist', async () => {
    const res = await GET(new Request('http://test/api/triggers'));
    const json = await res.json();
    expect(json.triggers).toEqual([]);
  });

  test('lists all triggers', async () => {
    const r1 = await POST(new Request('http://test/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'a', enabled: true, workflowId: 'wf-a',
        pluginId: 'generic', match: [], inputs: {},
      }),
    }));
    expect(r1.status).toBe(201);
    const r2 = await POST(new Request('http://test/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'b', enabled: true, workflowId: 'wf-b',
        pluginId: 'generic', match: [], inputs: {},
      }),
    }));
    expect(r2.status).toBe(201);

    const res = await GET(new Request('http://test/api/triggers'));
    const json = await res.json();
    expect(json.triggers).toHaveLength(2);
  });

  test('?workflowId filters server-side', async () => {
    await POST(new Request('http://test/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'a', enabled: true, workflowId: 'wf-a',
        pluginId: 'generic', match: [], inputs: {},
      }),
    }));
    await POST(new Request('http://test/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'b', enabled: true, workflowId: 'wf-b',
        pluginId: 'generic', match: [], inputs: {},
      }),
    }));
    const res = await GET(new Request('http://test/api/triggers?workflowId=wf-a'));
    const json = await res.json();
    expect(json.triggers).toHaveLength(1);
    expect(json.triggers[0].workflowId).toBe('wf-a');
  });
});

describe('POST /api/triggers', () => {
  test('creates a trigger with a server-generated id and timestamps', async () => {
    const res = await POST(new Request('http://test/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'gh', enabled: true, workflowId: 'wf-a',
        pluginId: 'github', eventType: 'issues',
        match: [], inputs: {},
      }),
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.trigger.id).toMatch(/^[A-Za-z0-9_-]{16,32}$/);
    expect(json.trigger.createdAt).toBeGreaterThan(0);
    expect(json.trigger.updatedAt).toBeGreaterThan(0);
  });

  test('400 on invalid body', async () => {
    const res = await POST(new Request('http://test/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ /* missing required fields */ }),
    }));
    expect(res.status).toBe(400);
  });

  test('400 when plugin unknown', async () => {
    const res = await POST(new Request('http://test/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'x', enabled: true, workflowId: 'wf-a',
        pluginId: 'nope', match: [], inputs: {},
      }),
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test app/api/triggers/route.test.ts` — module not found.

- [ ] **Step 3: Implement the list/create route**

Create `app/api/triggers/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { listTriggers, saveTrigger } from '@/lib/server/trigger-store';
import { randomBytes } from 'node:crypto';
import type { WebhookTrigger } from '@/lib/shared/trigger';

function generateId(): string {
  return randomBytes(16).toString('base64url');
}

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const url = new URL(req.url);
  const workflowId = url.searchParams.get('workflowId') ?? undefined;
  const all = await listTriggers();
  const filtered = workflowId ? all.filter((t) => t.workflowId === workflowId) : all;
  return NextResponse.json({ triggers: filtered });
}

export async function POST(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const payload = body as Partial<WebhookTrigger>;
  // Server owns id and timestamps; callers MUST NOT supply them.
  const id = generateId();
  const draft: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> = {
    id,
    name: typeof payload.name === 'string' ? payload.name : '',
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : true,
    workflowId: typeof payload.workflowId === 'string' ? payload.workflowId : '',
    pluginId: typeof payload.pluginId === 'string' ? payload.pluginId : '',
    eventType: typeof payload.eventType === 'string' ? payload.eventType : undefined,
    match: Array.isArray(payload.match) ? payload.match : [],
    inputs: payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)
      ? (payload.inputs as Record<string, string>)
      : {},
  };
  try {
    const saved = await saveTrigger(draft);
    return NextResponse.json({ trigger: saved }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid-trigger', reason: (err as Error).message },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 4: Run list/create tests**

`bun test app/api/triggers/route.test.ts` — all green.

- [ ] **Step 5: Write failing tests for the single-trigger route**

Create `app/api/triggers/[id]/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GET, PUT, DELETE } from './route';

const tmpWfDir = path.join(os.tmpdir(), `infloop-api-tr-id-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infloop-api-tr-id-tr-${process.pid}`);

async function writeWorkflow(id: string) {
  await fs.writeFile(
    path.join(tmpWfDir, `${id}.json`),
    JSON.stringify({
      id, name: id, version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs: [],
    }),
  );
}

async function seedTrigger(id: string) {
  const { saveTrigger } = await import('@/lib/server/trigger-store');
  return saveTrigger({
    id, name: id, enabled: true, workflowId: 'wf-a',
    pluginId: 'generic', match: [], inputs: {},
  });
}

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  await writeWorkflow('wf-a');
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
});

describe('GET /api/triggers/[id]', () => {
  test('returns the trigger', async () => {
    await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    const res = await GET(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA'),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trigger.id).toBe('idAAAAAAAAAAAAAAAAAAAA');
  });

  test('404 for unknown id', async () => {
    const res = await GET(
      new Request('http://test/api/triggers/absent_id_000000000000'),
      { params: Promise.resolve({ id: 'absent_id_000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/triggers/[id]', () => {
  test('updates the trigger and preserves createdAt', async () => {
    const orig = await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    await new Promise((r) => setTimeout(r, 5));
    const res = await PUT(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...orig, name: 'renamed' }),
      }),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trigger.name).toBe('renamed');
    expect(json.trigger.createdAt).toBe(orig.createdAt);
    expect(json.trigger.updatedAt).toBeGreaterThan(orig.updatedAt);
  });

  test('400 when body tries to change the id', async () => {
    await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    const res = await PUT(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'idDIFFERENTDIFFERENT12', name: 'x', enabled: true,
          workflowId: 'wf-a', pluginId: 'generic', match: [], inputs: {},
        }),
      }),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/triggers/[id]', () => {
  test('removes the trigger', async () => {
    await seedTrigger('idAAAAAAAAAAAAAAAAAAAA');
    const res = await DELETE(
      new Request('http://test/api/triggers/idAAAAAAAAAAAAAAAAAAAA', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'idAAAAAAAAAAAAAAAAAAAA' }) },
    );
    expect(res.status).toBe(204);
    const { listTriggers } = await import('@/lib/server/trigger-store');
    expect(await listTriggers()).toHaveLength(0);
  });

  test('404 for unknown id', async () => {
    const res = await DELETE(
      new Request('http://test/api/triggers/absent_id_000000000000', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'absent_id_000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Implement the single-trigger route**

Create `app/api/triggers/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import {
  getTrigger,
  saveTrigger,
  deleteTrigger,
  TriggerNotFoundError,
} from '@/lib/server/trigger-store';
import type { WebhookTrigger } from '@/lib/shared/trigger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function notFound() {
  return NextResponse.json({ error: 'not-found' }, { status: 404 });
}

export async function GET(req: Request, { params }: RouteParams): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const { id } = await params;
  try {
    const trigger = await getTrigger(id);
    return NextResponse.json({ trigger });
  } catch (err) {
    if (err instanceof TriggerNotFoundError) return notFound();
    throw err;
  }
}

export async function PUT(req: Request, { params }: RouteParams): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const payload = body as Partial<WebhookTrigger>;
  if (payload.id !== undefined && payload.id !== id) {
    return NextResponse.json(
      { error: 'invalid-trigger', reason: 'id cannot be changed; create a new trigger instead' },
      { status: 400 },
    );
  }
  try {
    // Confirms the trigger exists; getTrigger throws TriggerNotFoundError if not.
    await getTrigger(id);
    const draft: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> = {
      id,
      name: typeof payload.name === 'string' ? payload.name : '',
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : true,
      workflowId: typeof payload.workflowId === 'string' ? payload.workflowId : '',
      pluginId: typeof payload.pluginId === 'string' ? payload.pluginId : '',
      eventType: typeof payload.eventType === 'string' ? payload.eventType : undefined,
      match: Array.isArray(payload.match) ? payload.match : [],
      inputs: payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)
        ? (payload.inputs as Record<string, string>)
        : {},
    };
    const saved = await saveTrigger(draft);
    return NextResponse.json({ trigger: saved });
  } catch (err) {
    if (err instanceof TriggerNotFoundError) return notFound();
    return NextResponse.json(
      { error: 'invalid-trigger', reason: (err as Error).message },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: RouteParams): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const { id } = await params;
  try {
    await deleteTrigger(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof TriggerNotFoundError) return notFound();
    throw err;
  }
}
```

- [ ] **Step 7: Run all CRUD tests**

```bash
bun test app/api/triggers
bun test
```

All green.

- [ ] **Step 8: Commit**

```bash
git add app/api/triggers/route.ts app/api/triggers/route.test.ts app/api/triggers/[id]/route.ts app/api/triggers/[id]/route.test.ts
git commit -m "feat(api): trigger CRUD routes"
```

---

### Task 11: Webhook plugins discovery route

**Files:**
- Create: `app/api/webhook-plugins/route.ts`
- Create: `app/api/webhook-plugins/route.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/api/webhook-plugins/route.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { GET } from './route';

describe('GET /api/webhook-plugins', () => {
  test('returns the loaded plugin list', async () => {
    const res = await GET(new Request('http://test/api/webhook-plugins'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.plugins)).toBe(true);
    expect(json.plugins.find((p: { id: string }) => p.id === 'generic')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run failing test**

`bun test app/api/webhook-plugins/route.test.ts` — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/webhook-plugins/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { pluginIndex } from '@/lib/server/webhook-plugins';

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const plugins = await pluginIndex.list();
  return NextResponse.json({ plugins });
}
```

- [ ] **Step 4: Run test + full suite**

```bash
bun test app/api/webhook-plugins/route.test.ts
bun test
```

All green.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook-plugins
git commit -m "feat(api): GET /api/webhook-plugins discovery route"
```

---

### Task 12: Test-fire route

**Files:**
- Create: `app/api/triggers/[id]/test/route.ts`
- Create: `app/api/triggers/[id]/test/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/api/triggers/[id]/test/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST } from './route';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

const tmpWfDir = path.join(os.tmpdir(), `infloop-api-test-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infloop-api-test-tr-${process.pid}`);

async function writeWorkflow(id: string) {
  await fs.writeFile(
    path.join(tmpWfDir, `${id}.json`),
    JSON.stringify({
      id, name: id, version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs: [],
    }),
  );
}

async function seedTrigger() {
  const { saveTrigger } = await import('@/lib/server/trigger-store');
  return saveTrigger({
    id: 'idTESTTESTTESTTESTTEST', name: 't', enabled: true,
    workflowId: 'wf-a', pluginId: 'generic', match: [], inputs: {},
  });
}

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  await writeWorkflow('wf-a');
  triggerQueue.clear();
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  triggerQueue.clear();
});

describe('POST /api/triggers/[id]/test', () => {
  test('echoes status 202 when the synthetic payload triggers the workflow', async () => {
    await seedTrigger();
    const res = await POST(
      new Request('http://test/api/triggers/idTESTTESTTESTTESTTEST/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: { hello: 'world' } }),
      }),
      { params: Promise.resolve({ id: 'idTESTTESTTESTTESTTEST' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe(202);
  });

  test('404 for unknown trigger', async () => {
    const res = await POST(
      new Request('http://test/api/triggers/absent_id_000000000000/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: {} }),
      }),
      { params: Promise.resolve({ id: 'absent_id_000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test app/api/triggers/[id]/test/route.test.ts` — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/triggers/[id]/test/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import {
  getTrigger,
  TriggerNotFoundError,
} from '@/lib/server/trigger-store';
import { POST as webhookPOST } from '@/app/api/webhook/[triggerId]/route';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const { id } = await params;
  try {
    await getTrigger(id);
  } catch (err) {
    if (err instanceof TriggerNotFoundError) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    throw err;
  }

  let body: { payload?: unknown; headers?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const payloadJson = JSON.stringify(body.payload ?? {});
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(body.headers ?? {}),
  };

  const synthetic = new Request(`http://test/api/webhook/${id}`, {
    method: 'POST',
    headers,
    body: payloadJson,
  });
  const result = await webhookPOST(synthetic, {
    params: Promise.resolve({ triggerId: id }),
  });
  // Read the response so we can return it in a structured envelope.
  let responseBody: unknown = null;
  const text = await result.text();
  if (text.length > 0) {
    try { responseBody = JSON.parse(text); }
    catch { responseBody = text; }
  }
  return NextResponse.json({
    status: result.status,
    body: responseBody,
  });
}
```

- [ ] **Step 4: Run tests**

```bash
bun test app/api/triggers/[id]/test/route.test.ts
bun test
```

All green.

- [ ] **Step 5: Commit**

```bash
git add app/api/triggers/[id]/test
git commit -m "feat(api): trigger test-fire route reusing the real webhook handler"
```

---

### Task 13: Allow trigger_* events through the client SSE filter (sanity)

**Files:**
- Verify only — `lib/client/ws-client.ts` already has `trigger_*` event types from v1's `7850aac` commit. No change needed.

- [ ] **Step 1: Verify**

```bash
grep -n "trigger_" lib/client/ws-client.ts
```

If `trigger_enqueued`, `trigger_started`, `trigger_dropped` already appear in `VALID_EVENT_TYPES`: nothing to do, skip to Task 14.

If they're missing (regression from a rebase), add them as in v1's task and commit a one-liner restore.

---

### Task 14: FieldPicker component

**Files:**
- Create: `app/components/FieldPicker.tsx`
- Create: `app/components/FieldPicker.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `app/components/FieldPicker.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldPicker } from './FieldPicker';
import type { PluginField } from '@/lib/shared/trigger';

const fields: PluginField[] = [
  { path: 'body.action', type: 'string', description: 'opened, closed, …' },
  { path: 'body.issue.number', type: 'number' },
  { path: 'body.issue.title', type: 'string' },
];

describe('FieldPicker', () => {
  test('renders the current value in the input', () => {
    render(<FieldPicker fields={fields} value="{{body.action}}" onChange={() => {}} />);
    const input = screen.getByDisplayValue('{{body.action}}') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  test('opens the dropdown on focus and shows all fields', () => {
    render(<FieldPicker fields={fields} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/{{.*}}/);
    fireEvent.focus(input);
    expect(screen.getByText('body.action')).toBeTruthy();
    expect(screen.getByText('body.issue.number')).toBeTruthy();
    expect(screen.getByText('body.issue.title')).toBeTruthy();
  });

  test('clicking an option calls onChange with {{path}}', () => {
    let captured = '';
    render(<FieldPicker fields={fields} value="" onChange={(v) => { captured = v; }} />);
    const input = screen.getByPlaceholderText(/{{.*}}/);
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText('body.issue.number'));
    expect(captured).toBe('{{body.issue.number}}');
  });

  test('typing a custom value calls onChange with the typed text', () => {
    let captured = '';
    render(<FieldPicker fields={fields} value="" onChange={(v) => { captured = v; }} />);
    const input = screen.getByPlaceholderText(/{{.*}}/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '{{body.custom.path}}' } });
    expect(captured).toBe('{{body.custom.path}}');
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test app/components/FieldPicker.test.tsx` — module not found.

- [ ] **Step 3: Implement the component**

Create `app/components/FieldPicker.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { PluginField } from '@/lib/shared/trigger';

export interface FieldPickerProps {
  fields: PluginField[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export function FieldPicker({
  fields,
  value,
  onChange,
  placeholder = '{{body.something}}',
  ariaLabel,
}: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Filter fields by current typed text (case-insensitive substring on path/description).
  const filter = value.replace(/[{}]/g, '').toLowerCase();
  const visible = filter.length === 0
    ? fields
    : fields.filter((f) => f.path.toLowerCase().includes(filter) || (f.description ?? '').toLowerCase().includes(filter));

  return (
    <div className="fp-root" ref={containerRef}>
      <input
        className="fp-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        aria-label={ariaLabel}
        placeholder={placeholder}
      />
      {open && fields.length > 0 && (
        <ul className="fp-menu" role="listbox">
          {visible.map((f) => (
            <li
              key={f.path}
              className="fp-option"
              role="option"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(`{{${f.path}}}`);
                setOpen(false);
              }}
            >
              <span className="fp-option-path">{f.path}</span>
              {f.description ? (
                <span className="fp-option-desc">{f.description}</span>
              ) : null}
            </li>
          ))}
          {visible.length === 0 && (
            <li className="fp-option fp-option-empty">No matching field — using your typed value.</li>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

`bun test app/components/FieldPicker.test.tsx` — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add app/components/FieldPicker.tsx app/components/FieldPicker.test.tsx
git commit -m "feat(ui): FieldPicker — plugin-aware autocomplete for template paths"
```

---

### Task 15: TriggerForm component

**Files:**
- Create: `app/components/TriggerForm.tsx`
- Create: `app/components/TriggerForm.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `app/components/TriggerForm.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TriggerForm } from './TriggerForm';
import type { WebhookPlugin } from '@/lib/shared/trigger';

const plugins: WebhookPlugin[] = [
  { id: 'generic', displayName: 'Generic', events: [{ type: 'any', displayName: 'Any', fields: [] }] },
  {
    id: 'github', displayName: 'GitHub', eventHeader: 'x-github-event',
    events: [
      {
        type: 'issues', displayName: 'Issue',
        fields: [
          { path: 'body.action', type: 'string', description: 'opened, closed' },
          { path: 'body.issue.number', type: 'number' },
        ],
      },
    ],
  },
];

const workflows = [
  { id: 'wf-a', name: 'A', inputs: [{ name: 'msg', type: 'string' as const }] },
  { id: 'wf-b', name: 'B', inputs: [] },
];

describe('TriggerForm', () => {
  test('renders empty form with defaults', () => {
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/trigger name/i)).toBeTruthy();
    expect(screen.getByText(/Save trigger/)).toBeTruthy();
  });

  test('picking GitHub plugin reveals the Event picker', () => {
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Plugin/i), { target: { value: 'github' } });
    expect(screen.getByLabelText(/Event/i)).toBeTruthy();
  });

  test('picking a target workflow renders its inputs as rows', async () => {
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Target/i), { target: { value: 'wf-a' } });
    await waitFor(() => {
      expect(screen.getByText('msg')).toBeTruthy();
    });
  });

  test('save calls onSave with the built payload', async () => {
    let captured: unknown = null;
    render(
      <TriggerForm
        plugins={plugins}
        workflows={workflows}
        initial={null}
        origin="http://localhost:3000"
        onSave={async (t) => { captured = t; }}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/trigger name/i), { target: { value: 'my-trigger' } });
    fireEvent.change(screen.getByLabelText(/Plugin/i), { target: { value: 'generic' } });
    fireEvent.change(screen.getByLabelText(/Target/i), { target: { value: 'wf-b' } });
    fireEvent.click(screen.getByText(/Save trigger/));
    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    expect((captured as { name: string }).name).toBe('my-trigger');
    expect((captured as { workflowId: string }).workflowId).toBe('wf-b');
    expect((captured as { pluginId: string }).pluginId).toBe('generic');
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test app/components/TriggerForm.test.tsx` — module not found.

- [ ] **Step 3: Implement TriggerForm**

Create `app/components/TriggerForm.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { WebhookPlugin, WebhookTrigger, TriggerPredicate } from '@/lib/shared/trigger';
import { FieldPicker } from './FieldPicker';

export interface TriggerFormProps {
  plugins: WebhookPlugin[];
  workflows: Array<{ id: string; name: string; inputs: Array<{ name: string; type: string }> }>;
  initial: WebhookTrigger | null;     // null = creating new
  origin: string;
  onSave: (payload: Omit<WebhookTrigger, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
}

const OPS: TriggerPredicate['op'][] = ['==', '!=', 'contains', 'matches'];

export function TriggerForm({
  plugins, workflows, initial, origin, onSave, onCancel,
}: TriggerFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [pluginId, setPluginId] = useState(initial?.pluginId ?? 'generic');
  const [eventType, setEventType] = useState(initial?.eventType ?? '');
  const [workflowId, setWorkflowId] = useState(initial?.workflowId ?? '');
  const [match, setMatch] = useState<TriggerPredicate[]>(initial?.match ?? []);
  const [inputs, setInputs] = useState<Record<string, string>>(initial?.inputs ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const plugin = plugins.find((p) => p.id === pluginId);
  const event = plugin?.events.find((e) => e.type === eventType);
  const fields = event?.fields ?? [];
  const workflow = workflows.find((w) => w.id === workflowId);

  const url = useMemo(
    () => initial ? `${origin}/api/webhook/${initial.id}` : '',
    [initial, origin],
  );

  function handleSetPlugin(next: string) {
    setPluginId(next);
    setEventType('');
  }

  function handleAddPredicate() {
    setMatch((m) => [...m, { lhs: '', op: '==', rhs: '' }]);
  }

  function handleRemovePredicate(idx: number) {
    setMatch((m) => m.filter((_, i) => i !== idx));
  }

  function handleUpdatePredicate(idx: number, key: keyof TriggerPredicate, value: string) {
    setMatch((m) => m.map((p, i) => i === idx ? { ...p, [key]: value } : p));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const declaredInputNames = new Set(workflow?.inputs.map((i) => i.name) ?? []);
      const filteredInputs: Record<string, string> = {};
      for (const [k, v] of Object.entries(inputs)) {
        if (declaredInputNames.has(k) && v.length > 0) filteredInputs[k] = v;
      }
      await onSave({
        name,
        enabled,
        workflowId,
        pluginId,
        eventType: plugin?.eventHeader ? (eventType || undefined) : undefined,
        match,
        inputs: filteredInputs,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="trg-form">
      <label className="trg-form-row">
        <span className="trg-form-label">Name</span>
        <input
          className="trg-form-input"
          type="text"
          placeholder="trigger name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="trg-form-row">
        <span className="trg-form-label">Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </label>

      <label className="trg-form-row">
        <span className="trg-form-label">Plugin</span>
        <select
          className="trg-form-select"
          aria-label="Plugin"
          value={pluginId}
          onChange={(e) => handleSetPlugin(e.target.value)}
        >
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </label>

      {plugin?.eventHeader && (
        <label className="trg-form-row">
          <span className="trg-form-label">Event</span>
          <select
            className="trg-form-select"
            aria-label="Event"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option value="">— select —</option>
            {plugin.events.map((ev) => (
              <option key={ev.type} value={ev.type}>{ev.displayName}</option>
            ))}
          </select>
        </label>
      )}

      <label className="trg-form-row">
        <span className="trg-form-label">Target</span>
        <select
          className="trg-form-select"
          aria-label="Target"
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
        >
          <option value="">— select —</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </label>

      {initial && (
        <div className="trg-form-row">
          <span className="trg-form-label">URL</span>
          <code className="trg-form-url">{url}</code>
        </div>
      )}

      <section className="trg-form-section">
        <header className="trg-form-section-head">
          <span>Match (all must pass)</span>
          <button type="button" className="trg-form-add" onClick={handleAddPredicate}>+ Add predicate</button>
        </header>
        {match.map((p, idx) => (
          <div className="trg-form-predicate" key={idx}>
            <FieldPicker
              fields={fields}
              value={p.lhs}
              onChange={(v) => handleUpdatePredicate(idx, 'lhs', v)}
              ariaLabel={`Predicate ${idx + 1} lhs`}
            />
            <select
              className="trg-form-select"
              aria-label={`Predicate ${idx + 1} op`}
              value={p.op}
              onChange={(e) => handleUpdatePredicate(idx, 'op', e.target.value)}
            >
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input
              className="trg-form-input"
              type="text"
              value={p.rhs}
              onChange={(e) => handleUpdatePredicate(idx, 'rhs', e.target.value)}
              aria-label={`Predicate ${idx + 1} rhs`}
            />
            <button type="button" className="trg-form-remove" onClick={() => handleRemovePredicate(idx)}>×</button>
          </div>
        ))}
      </section>

      <section className="trg-form-section">
        <header className="trg-form-section-head">Inputs (from workflow)</header>
        {(workflow?.inputs ?? []).map((inp) => (
          <div className="trg-form-input-row" key={inp.name}>
            <span className="trg-form-input-name">{inp.name}</span>
            <FieldPicker
              fields={fields}
              value={inputs[inp.name] ?? ''}
              onChange={(v) => setInputs((s) => ({ ...s, [inp.name]: v }))}
              ariaLabel={`Input ${inp.name}`}
            />
          </div>
        ))}
        {(!workflow || workflow.inputs.length === 0) && (
          <p className="trg-form-hint">Selected workflow declares no inputs.</p>
        )}
      </section>

      {error && <div className="trg-form-error">{error}</div>}

      <div className="trg-form-actions">
        <button type="button" className="trg-form-save" disabled={saving} onClick={handleSave}>Save trigger</button>
        <button type="button" className="trg-form-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

`bun test app/components/TriggerForm.test.tsx` — 4 pass. If a test fails because the `<select>` element interaction differs from `<SelectMenu>`, adjust the tests to query by `aria-label` (already in place).

- [ ] **Step 5: Commit**

```bash
git add app/components/TriggerForm.tsx app/components/TriggerForm.test.tsx
git commit -m "feat(ui): TriggerForm with plugin/event/workflow wiring"
```

---

### Task 16: TestFireModal component

**Files:**
- Create: `app/components/TestFireModal.tsx`
- Create: `app/components/TestFireModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `app/components/TestFireModal.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestFireModal } from './TestFireModal';
import type { WebhookTrigger, WebhookPlugin } from '@/lib/shared/trigger';

const trigger: WebhookTrigger = {
  id: 'idTESTAAAAAAAAAAAAAAAA', name: 't', enabled: true,
  workflowId: 'wf', pluginId: 'github', eventType: 'issues',
  match: [], inputs: {},
  createdAt: 0, updatedAt: 0, lastFiredAt: null,
};

const plugin: WebhookPlugin = {
  id: 'github', displayName: 'GitHub', eventHeader: 'x-github-event',
  events: [
    {
      type: 'issues', displayName: 'Issue', fields: [],
      examplePayload: { action: 'opened', issue: { number: 1 } },
    },
  ],
};

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('TestFireModal', () => {
  test('Pre-fill button populates the payload from examplePayload', () => {
    render(<TestFireModal trigger={trigger} plugin={plugin} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Pre-fill example/i));
    const textarea = screen.getByLabelText(/Payload/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('"action": "opened"');
  });

  test('Send hits the test endpoint and shows the response', async () => {
    // @ts-expect-error fetch override
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 202, body: { queued: true } }),
    });
    render(<TestFireModal trigger={trigger} plugin={plugin} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Send/i));
    await waitFor(() => {
      expect(screen.getByText(/202/)).toBeTruthy();
      expect(screen.getByText(/queued/)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test app/components/TestFireModal.test.tsx` — module not found.

- [ ] **Step 3: Implement**

Create `app/components/TestFireModal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { WebhookPlugin, WebhookTrigger } from '@/lib/shared/trigger';

export interface TestFireModalProps {
  trigger: WebhookTrigger;
  plugin?: WebhookPlugin;
  onClose: () => void;
}

export function TestFireModal({ trigger, plugin, onClose }: TestFireModalProps) {
  const event = plugin?.events.find((e) => e.type === trigger.eventType);
  const [headers, setHeaders] = useState<string>(
    plugin?.eventHeader && trigger.eventType
      ? `${plugin.eventHeader}: ${trigger.eventType}`
      : '',
  );
  const [payload, setPayload] = useState<string>('{}');
  const [response, setResponse] = useState<{ status: number; body: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function handlePrefill() {
    if (event?.examplePayload !== undefined) {
      setPayload(JSON.stringify(event.examplePayload, null, 2));
    }
  }

  async function handleSend() {
    setError(null);
    setSending(true);
    setResponse(null);
    try {
      const parsedPayload = JSON.parse(payload);
      const parsedHeaders: Record<string, string> = {};
      for (const line of headers.split('\n')) {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k.length > 0) parsedHeaders[k] = v;
      }
      const res = await fetch(`/api/triggers/${trigger.id}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: parsedPayload, headers: parsedHeaders }),
      });
      if (!res.ok) {
        setError(`Test endpoint returned ${res.status}`);
        return;
      }
      const json = await res.json() as { status: number; body: unknown };
      setResponse(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal trg-form-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">Test fire — {trigger.name}</header>

        <label className="trg-form-row">
          <span className="trg-form-label">Headers (one per line, key: value)</span>
          <textarea
            className="trg-form-textarea"
            rows={2}
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            aria-label="Headers"
          />
        </label>

        <label className="trg-form-row">
          <span className="trg-form-label">Payload (JSON)</span>
          <textarea
            className="trg-form-textarea"
            rows={10}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            aria-label="Payload"
          />
        </label>

        <div className="modal-actions">
          {event?.examplePayload !== undefined && (
            <button type="button" className="btn" onClick={handlePrefill}>
              Pre-fill example
            </button>
          )}
          <button type="button" className="btn" disabled={sending} onClick={handleSend}>
            Send
          </button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>

        {error && <div className="trg-form-error">{error}</div>}
        {response && (
          <div className="trg-form-test-response">
            <code>{response.status}</code> <code>{JSON.stringify(response.body)}</code>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

`bun test app/components/TestFireModal.test.tsx` — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add app/components/TestFireModal.tsx app/components/TestFireModal.test.tsx
git commit -m "feat(ui): TestFireModal for synthetic-payload trigger testing"
```

---

### Task 17: DispatchView

**Files:**
- Create: `app/components/DispatchView.tsx`
- Create: `app/components/DispatchView.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `app/components/DispatchView.test.tsx`:

```tsx
import { afterEach, describe, expect, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { DispatchView } from './DispatchView';
import type { WebhookTrigger, WebhookPlugin } from '@/lib/shared/trigger';

const triggers: WebhookTrigger[] = [
  {
    id: 'idAAAAAAAAAAAAAAAAAAAA', name: 'github-issue-opened',
    enabled: true, workflowId: 'code-review',
    pluginId: 'github', eventType: 'issues',
    match: [], inputs: {}, lastFiredAt: null, createdAt: 1, updatedAt: 1,
  },
  {
    id: 'idBBBBBBBBBBBBBBBBBBBB', name: 'generic-debug',
    enabled: false, workflowId: 'test-flow',
    pluginId: 'generic', match: [], inputs: {},
    lastFiredAt: 1_700_000_000_000, createdAt: 1, updatedAt: 1,
  },
];

const plugins: WebhookPlugin[] = [
  { id: 'generic', displayName: 'Generic', events: [{ type: 'any', displayName: 'Any', fields: [] }] },
  { id: 'github', displayName: 'GitHub', eventHeader: 'x-github-event', events: [{ type: 'issues', displayName: 'Issue', fields: [] }] },
];

const workflows = [
  { id: 'code-review', name: 'Code review', inputs: [] },
  { id: 'test-flow', name: 'Test flow', inputs: [] },
];

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

function mockFetch(routes: Record<string, unknown>) {
  // @ts-expect-error fetch override
  globalThis.fetch = async (url: string) => {
    const path = typeof url === 'string' ? url : (url as Request).url;
    const key = Object.keys(routes).find((k) => path.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${path}`);
    return { ok: true, json: async () => routes[key] };
  };
}

describe('DispatchView', () => {
  test('lists triggers fetched from the API', async () => {
    mockFetch({
      '/api/triggers': { triggers },
      '/api/webhook-plugins': { plugins },
      '/api/workflows': { workflows },
    });
    render(<DispatchView origin="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText('github-issue-opened')).toBeTruthy();
      expect(screen.getByText('generic-debug')).toBeTruthy();
    });
  });

  test('renders empty state when no triggers exist', async () => {
    mockFetch({
      '/api/triggers': { triggers: [] },
      '/api/webhook-plugins': { plugins },
      '/api/workflows': { workflows },
    });
    render(<DispatchView origin="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(/No triggers yet/i)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

`bun test app/components/DispatchView.test.tsx` — module not found.

- [ ] **Step 3: Implement DispatchView**

Create `app/components/DispatchView.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WebhookPlugin, WebhookTrigger } from '@/lib/shared/trigger';
import { TriggerForm } from './TriggerForm';
import { TestFireModal } from './TestFireModal';

export interface DispatchViewProps {
  origin: string;
}

interface WorkflowSummary {
  id: string;
  name: string;
  inputs: Array<{ name: string; type: string }>;
}

export function DispatchView({ origin }: DispatchViewProps) {
  const [triggers, setTriggers] = useState<WebhookTrigger[] | null>(null);
  const [plugins, setPlugins] = useState<WebhookPlugin[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testingTrigger, setTestingTrigger] = useState<WebhookTrigger | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, p, w] = await Promise.all([
        fetch('/api/triggers').then((r) => r.json()),
        fetch('/api/webhook-plugins').then((r) => r.json()),
        fetch('/api/workflows').then((r) => r.json()),
      ]);
      setTriggers(t.triggers as WebhookTrigger[]);
      setPlugins(p.plugins as WebhookPlugin[]);
      // /api/workflows returns lightweight summaries; we need inputs too,
      // so re-fetch each workflow's full record on demand. For v2 simplicity,
      // we fetch a small per-id GET only when picked, kept locally via a
      // shallow cache.
      const summaries = w.workflows as Array<{ id: string; name: string }>;
      // Workflow inputs aren't on the summary; fetch full records in parallel.
      const full: WorkflowSummary[] = await Promise.all(
        summaries.map(async (s) => {
          const wf = await fetch(`/api/workflows/${encodeURIComponent(s.id)}`).then((r) => r.json());
          const inputs = (wf.workflow?.inputs as Array<{ name: string; type: string }>) ?? [];
          return { id: s.id, name: s.name, inputs };
        }),
      );
      setWorkflows(full);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleCreate(payload: Omit<WebhookTrigger, 'id' | 'createdAt' | 'updatedAt'>) {
    const res = await fetch('/api/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.reason ?? 'create failed');
    setCreating(false);
    await refresh();
    setSelectedId(json.trigger.id);
  }

  async function handleUpdate(payload: Omit<WebhookTrigger, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!selectedId) return;
    const res = await fetch(`/api/triggers/${encodeURIComponent(selectedId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, id: selectedId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.reason ?? 'update failed');
    setEditing(false);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this trigger? The URL stops working immediately.')) return;
    await fetch(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  if (triggers === null) {
    return <div className="dsp-loading">Loading…</div>;
  }

  const selected = triggers.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="dsp-root">
      <header className="dsp-head">
        <h2 className="dsp-title">Triggers</h2>
        <button type="button" className="dsp-new-btn" onClick={() => { setCreating(true); setSelectedId(null); setEditing(false); }}>
          + New trigger
        </button>
      </header>

      {error && <div className="dsp-error">{error}</div>}

      <div className="dsp-split">
        <aside className="dsp-list">
          {triggers.length === 0 ? (
            <p className="dsp-empty">No triggers yet. Click "New trigger" to add one.</p>
          ) : triggers.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`dsp-list-row ${selectedId === t.id ? 'dsp-list-row-selected' : ''}`}
              onClick={() => { setSelectedId(t.id); setCreating(false); setEditing(false); }}
            >
              <span className={`dsp-pip ${t.enabled ? 'on' : 'off'}`} aria-hidden />
              <span className="dsp-list-name">{t.name}</span>
              <span className="dsp-list-meta">
                {t.pluginId}{t.eventType ? ` · ${t.eventType}` : ''} → {t.workflowId}
              </span>
            </button>
          ))}
        </aside>

        <section className="dsp-detail">
          {creating ? (
            <TriggerForm
              plugins={plugins}
              workflows={workflows}
              initial={null}
              origin={origin}
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
            />
          ) : editing && selected ? (
            <TriggerForm
              plugins={plugins}
              workflows={workflows}
              initial={selected}
              origin={origin}
              onSave={handleUpdate}
              onCancel={() => setEditing(false)}
            />
          ) : selected ? (
            <div className="dsp-read">
              <header className="dsp-read-head">
                <h3>{selected.name}</h3>
                <div className="dsp-read-actions">
                  <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
                  <button type="button" className="btn" onClick={() => setTestingTrigger(selected)}>Test</button>
                  <button type="button" className="btn" onClick={() => handleDelete(selected.id)}>Delete</button>
                </div>
              </header>
              <p className="dsp-read-line"><span className="dsp-label">URL</span> <code>{`${origin}/api/webhook/${selected.id}`}</code></p>
              <p className="dsp-read-line"><span className="dsp-label">Plugin</span> {selected.pluginId}{selected.eventType ? ` · ${selected.eventType}` : ''}</p>
              <p className="dsp-read-line"><span className="dsp-label">Target</span> {selected.workflowId}</p>
              <p className="dsp-read-line"><span className="dsp-label">Match</span> {selected.match.length} predicate{selected.match.length === 1 ? '' : 's'}</p>
              <p className="dsp-read-line"><span className="dsp-label">Inputs</span> {Object.keys(selected.inputs).length} mapped</p>
              <p className="dsp-read-line"><span className="dsp-label">Last fired</span> {selected.lastFiredAt ? new Date(selected.lastFiredAt).toLocaleString() : 'Never'}</p>
            </div>
          ) : (
            <div className="dsp-empty">Select a trigger or click "New trigger".</div>
          )}
        </section>
      </div>

      {testingTrigger && (
        <TestFireModal
          trigger={testingTrigger}
          plugin={plugins.find((p) => p.id === testingTrigger.pluginId)}
          onClose={() => setTestingTrigger(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

`bun test app/components/DispatchView.test.tsx` — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add app/components/DispatchView.tsx app/components/DispatchView.test.tsx
git commit -m "feat(ui): DispatchView master/detail list + form"
```

---

### Task 18: Top-bar Dispatch button + hash router; shrink TriggersPanel

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/components/TriggersPanel.tsx`

- [ ] **Step 1: Read app/page.tsx to find the top-bar render block**

```bash
sed -n '1,40p' app/page.tsx
grep -n "WorkflowMenu\|run-controls\|topbar\|class=\"top" app/page.tsx | head -10
```

Note the top-bar JSX location for the Dispatch button insertion.

- [ ] **Step 2: Add hash-based view switching**

In `app/page.tsx`, add the hash state at the top of the component (alongside other `useState`/`useEffect` blocks):

```tsx
import { DispatchView } from './components/DispatchView';

// inside the component, after existing useState/useEffect:
const [view, setView] = useState<'editor' | 'dispatch'>('editor');

useEffect(() => {
  if (typeof window === 'undefined') return;
  const sync = () => setView(window.location.hash.startsWith('#dispatch') ? 'dispatch' : 'editor');
  sync();
  window.addEventListener('hashchange', sync);
  return () => window.removeEventListener('hashchange', sync);
}, []);
```

In the top bar JSX, add the Dispatch button next to the WorkflowMenu / Editor toggle:

```tsx
<button
  type="button"
  className={`btn ${view === 'dispatch' ? 'btn-active' : ''}`}
  onClick={() => { window.location.hash = view === 'dispatch' ? '' : '#dispatch'; }}
>
  Dispatch
</button>
```

In the body, swap the rendered content based on `view`:

```tsx
{view === 'dispatch' ? (
  <DispatchView origin={typeof window !== 'undefined' ? window.location.origin : ''} />
) : (
  /* existing palette + canvas + right-panel JSX */
)}
```

- [ ] **Step 3: Shrink TriggersPanel**

Open `app/components/TriggersPanel.tsx`. Replace the body with a small summary card:

```tsx
'use client';

import type { Workflow } from '@/lib/shared/workflow';
import { useEffect, useState } from 'react';
import type { WebhookTrigger } from '@/lib/shared/trigger';

export interface TriggersPanelProps {
  workflow: Workflow;
  origin: string;
}

export function TriggersPanel({ workflow }: TriggersPanelProps) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/triggers?workflowId=${encodeURIComponent(workflow.id)}`);
        if (!r.ok) return;
        const json = (await r.json()) as { triggers: WebhookTrigger[] };
        if (alive) setCount(json.triggers.length);
      } catch {
        /* ignore */
      }
    })();
    return () => { alive = false; };
  }, [workflow.id]);

  return (
    <div className="trg-summary">
      <span className="trg-summary-count">
        {count === null ? '…' : count} trigger{count === 1 ? '' : 's'} route{count === 1 ? 's' : ''} here.
      </span>
      <a
        href="#dispatch"
        className="trg-summary-link"
        onClick={(e) => { e.preventDefault(); window.location.hash = `#dispatch?workflow=${encodeURIComponent(workflow.id)}`; }}
      >
        Manage in Dispatch →
      </a>
    </div>
  );
}
```

(The 4 old TriggersPanel tests need updates to assert the new summary shape — adjust them to count the `route` text and the link, drop the persisted-lastFiredAt rendering tests since that data is in Dispatch now.)

- [ ] **Step 4: Update TriggersPanel tests**

Replace `app/components/TriggersPanel.test.tsx` with:

```tsx
import { afterEach, describe, expect, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { TriggersPanel } from './TriggersPanel';
import type { Workflow } from '@/lib/shared/workflow';

const wf: Workflow = {
  id: 'wf-a', name: 'A', version: 1, createdAt: 0, updatedAt: 0,
  nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('TriggersPanel (summary card)', () => {
  test('shows trigger count fetched from /api/triggers?workflowId=', async () => {
    // @ts-expect-error
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ triggers: [{}, {}, {}] }) });
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(/3 triggers route here/i)).toBeTruthy();
    });
  });

  test('singular wording for one trigger', async () => {
    // @ts-expect-error
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ triggers: [{}] }) });
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(/1 trigger routes here/i)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 5: Typecheck + full suite**

```bash
bun run typecheck
bun test
```

All green.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/components/TriggersPanel.tsx app/components/TriggersPanel.test.tsx
git commit -m "feat(ui): top-bar Dispatch button + shrunken TriggersPanel summary"
```

---

### Task 19: CSS for dsp-*, trg-form-*, fp-*

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append the new CSS block to the end of `app/globals.css`**

Use the existing project palette tokens (`--bg-elevated`, `--border`, `--border-strong`, `--bg-input`, `--accent-ok`, `--fg`, `--fg-soft`, `--fg-dim`, `--mono`). Match the style of the existing `trg-*` block. Suggested content:

```css
/* ─── Dispatch (Dispatch v2) ─────────────────────────────────────────── */

.dsp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 12px;
}

.dsp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dsp-title {
  font-family: var(--mono);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-soft);
  margin: 0;
}

.dsp-new-btn {
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  background: var(--bg-input);
  color: var(--fg);
  cursor: pointer;
}

.dsp-new-btn:hover { background: var(--bg-elevated); }

.dsp-split {
  display: grid;
  grid-template-columns: 40% 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.dsp-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  border: 1px solid var(--border);
  padding: 6px;
}

.dsp-list-row {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid transparent;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg);
}

.dsp-list-row:hover { background: var(--bg-input); }
.dsp-list-row-selected { border-color: var(--border-strong); }

.dsp-pip {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--fg-dim);
}
.dsp-pip.on { background: var(--accent-ok); }
.dsp-pip.off { background: var(--fg-dim); }

.dsp-list-name { font-weight: 600; }
.dsp-list-meta { font-size: 11px; color: var(--fg-soft); }

.dsp-detail {
  overflow-y: auto;
  border: 1px solid var(--border);
  padding: 14px;
}

.dsp-empty, .dsp-loading {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-dim);
  padding: 16px;
}

.dsp-error {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg);
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  padding: 6px 10px;
}

.dsp-read {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dsp-read-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.dsp-read-actions { display: flex; gap: 6px; }

.dsp-read-line {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
}

.dsp-label {
  display: inline-block;
  min-width: 90px;
  color: var(--fg-soft);
  text-transform: uppercase;
  font-size: 11px;
}

/* ─── Trigger form ─────────────────────────────────────────────────── */

.trg-form { display: flex; flex-direction: column; gap: 10px; }

.trg-form-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px;
  align-items: center;
}

.trg-form-label {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-soft);
  text-transform: uppercase;
}

.trg-form-input,
.trg-form-select,
.trg-form-textarea {
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--fg);
}

.trg-form-textarea { font-family: var(--mono); resize: vertical; }

.trg-form-section {
  border-top: 1px dashed var(--border);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trg-form-section-head {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  color: var(--fg-soft);
  display: flex;
  justify-content: space-between;
}

.trg-form-add,
.trg-form-remove {
  font-family: var(--mono);
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}

.trg-form-predicate {
  display: grid;
  grid-template-columns: 1fr 100px 1fr 24px;
  gap: 6px;
  align-items: center;
}

.trg-form-input-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  align-items: center;
}

.trg-form-input-name {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg);
}

.trg-form-hint {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-dim);
  margin: 0;
}

.trg-form-error {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg);
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  padding: 6px 10px;
}

.trg-form-actions { display: flex; gap: 8px; padding-top: 4px; }

.trg-form-save,
.trg-form-cancel {
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  background: var(--bg-input);
  color: var(--fg);
  cursor: pointer;
}

.trg-form-save:hover { background: var(--bg-elevated); }

.trg-form-url {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg);
  background: var(--bg-input);
  padding: 2px 6px;
  border: 1px solid var(--border);
}

.trg-form-test-response {
  font-family: var(--mono);
  font-size: 12px;
  padding: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
}

/* ─── Field picker ─────────────────────────────────────────────────── */

.fp-root {
  position: relative;
  width: 100%;
}

.fp-input {
  font-family: var(--mono);
  font-size: 12px;
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--fg);
}

.fp-menu {
  position: absolute;
  top: 100%; left: 0; right: 0;
  z-index: 10;
  max-height: 220px;
  overflow-y: auto;
  margin: 2px 0 0 0;
  padding: 4px 0;
  list-style: none;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  font-family: var(--mono);
  font-size: 12px;
}

.fp-option {
  padding: 4px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.fp-option:hover { background: var(--bg-input); }

.fp-option-path { color: var(--fg); }
.fp-option-desc { color: var(--fg-soft); font-size: 11px; }
.fp-option-empty { color: var(--fg-dim); cursor: default; }
.fp-option-empty:hover { background: transparent; }

/* ─── TriggersPanel summary card (replaces v1 list) ──────────────── */

.trg-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 12px;
}

.trg-summary-count { color: var(--fg); }

.trg-summary-link {
  color: var(--fg-soft);
  text-decoration: none;
  cursor: pointer;
}

.trg-summary-link:hover { color: var(--fg); }
```

- [ ] **Step 2: Run typecheck + tests**

```bash
bun run typecheck
bun test
```

All green (CSS doesn't affect tests).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(ui): CSS for Dispatch, TriggerForm, FieldPicker"
```

---

### Task 20: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the v1 "Triggering workflows from webhooks" section**

Read the current README and find the `## Triggering workflows from webhooks` heading. Replace its entire body with this v2 version:

````markdown
## Triggering workflows from webhooks

Open the **Dispatch** view from the top-bar button (next to the workflow
menu) to create, edit, and test webhook triggers visually. Each trigger
exposes a unique URL; when an HTTP POST hits it, InfLoop matches the
trigger's predicates against the request and queues a workflow run with
templated inputs.

### Creating a trigger

1. Click **Dispatch** in the top bar → **+ New trigger**.
2. Set a name and pick the target workflow.
3. Pick a **plugin** that describes the webhook source:
   - **Generic** — any JSON POST. Predicates and input mappings are
     free-form `{{body.x.y.z}}` template strings.
   - **GitHub** — declares `push`, `issues`, `issue_comment`, and
     `pull_request` events; the form's field-picker autocompletes from
     the event's known schema.
   Drop a new plugin JSON file in `webhook-plugins/` to add more (see
   [Adding a plugin](#adding-a-plugin)).
4. Configure **Match** predicates (AND-joined). For the GitHub plugin,
   the `x-github-event` header check is implicit — pick the event in
   the form and you only write predicates for body fields.
5. Map **Inputs** — each declared workflow input becomes a row; fill
   in a template string (use the field picker dropdown).
6. **Save**. Copy the URL from the detail pane.

### Wiring up GitHub

InfLoop listens on `http://localhost:3000` by default. To reach it
from `github.com`, expose your machine with a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then in your repo: **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://<your-tunnel>.trycloudflare.com/api/webhook/<id>` |
| Content type | `application/json` |
| Secret | (leave blank — URL is the secret in v2) |
| Events | Choose specific events or "Send everything" + filter via Dispatch |

### Test fire

From any trigger row in Dispatch, click **Test** to open the test-fire
modal. Edit a JSON payload (or pre-fill from the plugin event's
example), set headers, and Send. The modal shows the real webhook
response (202, 204, 422, etc.) so you can debug predicates and input
mapping without leaving the UI.

### Adding a plugin

Plugins are pure JSON. Create `webhook-plugins/<id>.json`:

```json
{
  "id": "stripe",
  "displayName": "Stripe",
  "eventHeader": "stripe-event-type",
  "events": [
    {
      "type": "checkout.session.completed",
      "displayName": "Checkout session completed",
      "fields": [
        { "path": "body.data.object.id",       "type": "string" },
        { "path": "body.data.object.amount",   "type": "number" },
        { "path": "body.data.object.customer", "type": "string" }
      ],
      "examplePayload": { "data": { "object": { "id": "cs_…", "amount": 5000 } } }
    }
  ]
}
```

Restart InfLoop. The plugin appears in the trigger form's Plugin
dropdown.

### Behavior reference

- Match succeeds → `202 { queued, queueId, position }`. Run is queued
  in memory and starts when the engine is idle.
- Match fails or plugin event-header mismatches → `204 No Content`.
- Unknown / disabled trigger id → `404 not-found`.
- Body > 1 MiB → `413 payload-too-large`.
- Queue at cap (100) → `503 queue-full` with `Retry-After: 30`.

### Security

The unguessable `triggerId` in the URL is the credential. There's no
HMAC verification in v2 — treat trigger URLs like passwords; rotate
via the regenerate-id button in the Dispatch form. `INFLOOP_API_TOKEN`
does NOT apply to webhook ingress (external services can't carry
custom auth headers); it does gate the management API.

### Storage

- `triggers/<id>.json` — one file per trigger.
- `webhook-plugins/<id>.json` — one file per plugin (Generic is
  built-in; you don't need to ship a file for it).
- Existing workflows with legacy `triggers[]` inline are auto-migrated
  into the registry on first load. The migration is idempotent.

### Limitations

- Queued runs are lost on process restart. The webhook caller already
  received `202`; the upstream service owns retry semantics.
- The engine runs one workflow at a time; concurrent webhook hits
  queue in FIFO order.
- No service-specific signature verification (GitHub HMAC, Stripe
  signing) in v2. Planned as a follow-up.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): Dispatch v2 — UI-driven trigger management + plugins"
```

---

### Task 21: End-to-end integration test

**Files:**
- Create: `lib/server/dispatch-integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `lib/server/dispatch-integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST as webhookPOST } from '@/app/api/webhook/[triggerId]/route';
import { saveTrigger } from './trigger-store';
import { triggerIndex } from './trigger-index';
import { triggerQueue } from './trigger-queue-singleton';
import { eventBus } from './event-bus';
import type { WorkflowEvent } from '../shared/workflow';

const tmpWfDir = path.join(os.tmpdir(), `infloop-dispatch-int-wf-${process.pid}`);
const tmpTrDir = path.join(os.tmpdir(), `infloop-dispatch-int-tr-${process.pid}`);

beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  triggerIndex.invalidate();
  triggerQueue.clear();
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
});

test('Dispatch v2 end-to-end: GitHub issues event fires the right workflow', async () => {
  // Workflow declares a number-typed input (exercises the coercion fix).
  await fs.writeFile(
    path.join(tmpWfDir, 'triage.json'),
    JSON.stringify({
      id: 'triage', name: 'Triage', version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      inputs: [
        { name: 'issue_number', type: 'number' },
        { name: 'title',        type: 'string' },
      ],
    }),
  );

  await saveTrigger({
    id: 'integGHGHGHGHGHGHGHGHGH', name: 'gh', enabled: true,
    workflowId: 'triage', pluginId: 'github', eventType: 'issues',
    match: [{ lhs: '{{body.action}}', op: '==', rhs: 'opened' }],
    inputs: {
      issue_number: '{{body.issue.number}}',
      title:        '{{body.issue.title}}',
    },
  });

  const events: WorkflowEvent[] = [];
  const unsub = eventBus.subscribe((e) => events.push(e));

  // Real GitHub-shape payload, event header set.
  const req = new Request('http://test/api/webhook/integGHGHGHGHGHGHGHGHGH', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'issues',
    },
    body: JSON.stringify({
      action: 'opened',
      issue: { number: 42, title: 'Webhook integration broken on weekends' },
    }),
  });
  const res = await webhookPOST(req, {
    params: Promise.resolve({ triggerId: 'integGHGHGHGHGHGHGHGHGH' }),
  });

  expect(res.status).toBe(202);

  // Coerced "42" → 42; predicate matched; trigger_enqueued fired.
  const enq = events.find((e) => e.type === 'trigger_enqueued');
  expect(enq).toBeDefined();
  if (enq && enq.type === 'trigger_enqueued') {
    expect(enq.workflowId).toBe('triage');
    expect(enq.triggerId).toBe('integGHGHGHGHGHGHGHGHGH');
  }

  unsub();
  triggerQueue.clear();
});

test('predicate-miss returns 204 and does NOT enqueue', async () => {
  await fs.writeFile(
    path.join(tmpWfDir, 'wf.json'),
    JSON.stringify({
      id: 'wf', name: 'wf', version: 1, createdAt: 0, updatedAt: 0,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
      edges: [], inputs: [],
    }),
  );
  await saveTrigger({
    id: 'integGHGHGHGHGHGHGH222', name: 'miss', enabled: true,
    workflowId: 'wf', pluginId: 'github', eventType: 'issues',
    match: [{ lhs: '{{body.action}}', op: '==', rhs: 'opened' }],
    inputs: {},
  });

  const req = new Request('http://test/api/webhook/integGHGHGHGHGHGHGH222', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'issues',
    },
    body: JSON.stringify({ action: 'closed' }),
  });
  const res = await webhookPOST(req, {
    params: Promise.resolve({ triggerId: 'integGHGHGHGHGHGHGH222' }),
  });

  expect(res.status).toBe(204);
});
```

- [ ] **Step 2: Run**

```bash
bun test lib/server/dispatch-integration.test.ts
bun test
```

Both green.

- [ ] **Step 3: Commit**

```bash
git add lib/server/dispatch-integration.test.ts
git commit -m "test: Dispatch v2 end-to-end (GitHub issues plugin + coercion)"
```

---

## Verification Checklist

After all tasks complete, run from the repo root:

- [ ] `bun run typecheck` — clean.
- [ ] `bun test` — all pass.
- [ ] `bun run build` — production build succeeds.
- [ ] Manual smoke test:
  1. Start `bun run dev`.
  2. Click **Dispatch** in the top bar — list renders (with the
     migrated `github-issue-triage` trigger from v1's testing).
  3. Click **+ New trigger**. Pick `GitHub` plugin → `issues` event →
     a workflow. Field picker autocompletes for predicate lhs.
  4. Save. URL appears in the detail pane.
  5. Click **Test**. Pre-fill example payload. Send. Response shows
     `202 {queued: true, …}`.
  6. Hash-navigate to `#dispatch?workflow=<id>` — the list filters to
     that workflow.
  7. Click **Editor** to return to the canvas. The TriggersPanel in
     the right-side workflow settings now shows the summary card with
     the count.
  8. Trigger an actual GitHub issue via curl with
     `x-github-event: issues` and a body containing
     `{"action": "opened", "issue": {"number": 7, "title": "..."}}`.
     The Triage workflow runs with `issue_number=7` (coerced from the
     string `"7"`).
