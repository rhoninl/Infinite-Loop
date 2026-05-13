# Trigger API + MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let external HTTP callers and MCP-speaking agents trigger InfLoop workflows asynchronously, with one MCP tool per saved workflow.

**Architecture:** Two surfaces over the existing engine. (1) HTTP: surface `runId` on `RunSnapshot`, return it from `POST /api/run`, fall through to the engine snapshot on `GET /api/runs/:workflowId/:runId` so a polling caller sees both running and just-settled-but-not-persisted states. Optional bearer-token auth. (2) MCP: a standalone Bun stdio MCP server in `mcp/inflooop-mcp/` that lists workflows at startup and registers one tool per workflow with input schema derived from `workflow.inputs[]`. Per-tool flow: `POST /api/run` → poll `/api/runs/:wf/:rid` until settled or timeout.

**Tech Stack:** Bun, Next.js 15 (App Router), TypeScript, `@modelcontextprotocol/sdk`, `zod`. Tests: `bun:test`.

**Spec:** `specs/trigger-api-mcp.md`

---

## Phase A — HTTP API

### Task A1: Surface `runId` on `RunSnapshot` and the engine

**Files:**
- Modify: `lib/shared/workflow.ts:283-298`
- Modify: `lib/server/workflow-engine.ts:143-149`
- Test: `lib/server/workflow-engine.test.ts` *(append a new `describe('runId on snapshot')` block)*

- [ ] **Step 1: Write the failing test**

Append to `lib/server/workflow-engine.test.ts`:

```ts
describe('runId on snapshot', () => {
  it('exposes runId after start() and keeps it on terminal status', async () => {
    const engine = new WorkflowEngine();
    expect(engine.getState().runId).toBeUndefined();

    const wf: Workflow = {
      id: 'wf-runid',
      name: 'runid test',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'e', type: 'end', position: { x: 0, y: 0 }, config: { outcome: 'succeeded' } },
      ],
      edges: [{ id: 'e1', source: 's', sourceHandle: 'next', target: 'e' }],
    };
    await engine.start(wf);

    const after = engine.getState();
    expect(typeof after.runId).toBe('string');
    expect(after.runId!.length).toBeGreaterThan(8);
    expect(after.status).toBe('succeeded');
    // runId stays valid on terminal status (not cleared between runs)
    expect(after.runId).toBe(after.runId);
  });

  it('overwrites runId on the next start()', async () => {
    const engine = new WorkflowEngine();
    const wf: Workflow = {
      id: 'wf-runid-2',
      name: 'runid test 2',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'e', type: 'end', position: { x: 0, y: 0 }, config: { outcome: 'succeeded' } },
      ],
      edges: [{ id: 'e1', source: 's', sourceHandle: 'next', target: 'e' }],
    };
    await engine.start(wf);
    const first = engine.getState().runId;
    await engine.start(wf);
    const second = engine.getState().runId;
    expect(second).not.toBe(first);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test lib/server/workflow-engine.test.ts -t "runId on snapshot"
```

Expected: FAIL (`runId` is `undefined`).

- [ ] **Step 3: Add `runId?` to `RunSnapshot`**

In `lib/shared/workflow.ts`, modify the `RunSnapshot` interface (around line 283):

```ts
export interface RunSnapshot {
  status: RunStatus;
  /** Stable id of the current or most-recent run. Set on `start()`,
   *  preserved on terminal statuses, overwritten by the next `start()`.
   *  `undefined` only on a fresh engine that has never run anything. */
  runId?: string;
  workflowId?: string;
  currentNodeId?: string;
  iterationByLoopId: Record<string, number>;
  scope: Scope;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  events?: WorkflowEvent[];
}
```

- [ ] **Step 4: Write `runId` into the snapshot on `start()`**

In `lib/server/workflow-engine.ts`, modify the `start()` snapshot assignment (around line 143):

```ts
this.currentRunId = crypto.randomUUID();
// … seedScope construction unchanged …
this.snapshot = {
  status: 'running',
  runId: this.currentRunId,
  workflowId: workflow.id,
  iterationByLoopId: {},
  scope: seedScope,
  startedAt,
};
```

The terminal-status update later in `start()` already does `...this.snapshot`, so `runId` is preserved automatically — no change needed there.

- [ ] **Step 5: Run the test to confirm it passes**

```bash
bun test lib/server/workflow-engine.test.ts -t "runId on snapshot"
```

Expected: PASS.

- [ ] **Step 6: Run the full engine test file to check for regressions**

```bash
bun test lib/server/workflow-engine.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/shared/workflow.ts lib/server/workflow-engine.ts lib/server/workflow-engine.test.ts
git commit -m "feat(engine): expose runId on RunSnapshot"
```

---

### Task A2: `POST /api/run` returns `runId`; `409` carries in-flight `{ runId, workflowId }`

**Files:**
- Modify: `app/api/run/route.ts:71-74` (`202` response) and `:60-65` (`409` response)
- Test: `app/api/run/route.test.ts` *(extend existing describe block)*

- [ ] **Step 1: Write the failing tests**

Append to `app/api/run/route.test.ts` inside `describe('POST /api/run', …)`:

```ts
it('includes runId in the 202 response when engine assigns one', async () => {
  getWorkflowMock.mockResolvedValue(sampleWorkflow);
  getStateMock.mockReturnValue({
    ...runningState,
    runId: 'rid-abc',
  });

  const res = await POST(jsonRequest({ workflowId: 'wf-1' }));

  expect(res.status).toBe(202);
  const body = (await res.json()) as { runId?: string; state: RunSnapshot };
  expect(body.runId).toBe('rid-abc');
  expect(body.state.runId).toBe('rid-abc');
});

it('returns 409 with the in-flight runId and workflowId when busy', async () => {
  getWorkflowMock.mockResolvedValue(sampleWorkflow);
  getStateMock.mockReturnValue({
    ...runningState,
    runId: 'rid-busy',
    workflowId: 'wf-other',
  });

  const res = await POST(jsonRequest({ workflowId: 'wf-1' }));

  expect(res.status).toBe(409);
  const body = (await res.json()) as {
    error: string;
    runId?: string;
    workflowId?: string;
  };
  expect(body.error).toMatch(/already active|busy/i);
  expect(body.runId).toBe('rid-busy');
  expect(body.workflowId).toBe('wf-other');
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
bun test app/api/run/route.test.ts -t "includes runId"
bun test app/api/run/route.test.ts -t "409 with the in-flight"
```

Expected: FAIL.

- [ ] **Step 3: Update the route**

In `app/api/run/route.ts`, replace the 409 block and the 202 block:

```ts
if (workflowEngine.getState().status === 'running') {
  const s = workflowEngine.getState();
  return NextResponse.json(
    {
      error: 'a run is already active',
      ...(s.runId ? { runId: s.runId } : {}),
      ...(s.workflowId ? { workflowId: s.workflowId } : {}),
    },
    { status: 409 },
  );
}

workflowEngine.start(workflow, { resolvedInputs }).catch((err) => {
  console.error('[api/run] engine.start failed:', err);
});

const stateAfter = workflowEngine.getState();
return NextResponse.json(
  {
    ...(stateAfter.runId ? { runId: stateAfter.runId } : {}),
    state: stateAfter,
  },
  { status: 202 },
);
```

- [ ] **Step 4: Run the tests**

```bash
bun test app/api/run/route.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/run/route.ts app/api/run/route.test.ts
git commit -m "feat(api/run): return runId on 202; surface in-flight runId on 409"
```

---

### Task A3: `GET /api/runs/:workflowId/:runId` falls through to engine snapshot

**Files:**
- Modify: `app/api/runs/[workflowId]/[runId]/route.ts`
- Test: `app/api/runs/[workflowId]/[runId]/route.test.ts` *(create)*

- [ ] **Step 1: Write the failing test**

Create `app/api/runs/[workflowId]/[runId]/route.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it, mock, type Mock } from 'bun:test';
import type { RunSnapshot } from '@/lib/shared/workflow';

const realEngine = { ...(await import('@/lib/server/workflow-engine')) };
const realStore = { ...(await import('@/lib/server/run-store')) };

mock.module('@/lib/server/workflow-engine', () => ({
  workflowEngine: { getState: mock() },
}));
mock.module('@/lib/server/run-store', () => ({
  getRun: mock(),
}));

const { workflowEngine } = await import('@/lib/server/workflow-engine');
const { getRun } = await import('@/lib/server/run-store');
const { GET } = await import('./route');

afterAll(() => {
  mock.module('@/lib/server/workflow-engine', () => realEngine);
  mock.module('@/lib/server/run-store', () => realStore);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<(...args: any[]) => any>;
const getStateMock = workflowEngine.getState as unknown as AnyMock;
const getRunMock = getRun as unknown as AnyMock;

function notFound() {
  const err = new Error('not found') as Error & { code?: string };
  err.code = 'ENOENT';
  return err;
}

function reqCtx(workflowId: string, runId: string) {
  const req = new Request(`http://localhost/api/runs/${workflowId}/${runId}`);
  return [req, { params: Promise.resolve({ workflowId, runId }) }] as const;
}

beforeEach(() => {
  getStateMock.mockReset();
  getRunMock.mockReset();
});

describe('GET /api/runs/:workflowId/:runId fall-through', () => {
  it('returns the persisted record when present', async () => {
    getRunMock.mockResolvedValue({ runId: 'rid', workflowId: 'wf', status: 'succeeded' });
    const [req, ctx] = reqCtx('wf', 'rid');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { status: string } };
    expect(body.run.status).toBe('succeeded');
  });

  it('synthesises a running record from engine snapshot when not persisted yet', async () => {
    getRunMock.mockRejectedValue(notFound());
    const snap: RunSnapshot = {
      status: 'running',
      runId: 'rid',
      workflowId: 'wf',
      iterationByLoopId: { 'loop-1': 2 },
      scope: { 'claude-1': { stdout: 'partial' } },
      startedAt: 1000,
      currentNodeId: 'claude-1',
    };
    getStateMock.mockReturnValue(snap);

    const [req, ctx] = reqCtx('wf', 'rid');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { status: string; currentNodeId?: string; iterationByLoopId?: Record<string, number> };
    };
    expect(body.run.status).toBe('running');
    expect(body.run.currentNodeId).toBe('claude-1');
    expect(body.run.iterationByLoopId).toEqual({ 'loop-1': 2 });
  });

  it('synthesises a terminal record from engine snapshot during the persist gap', async () => {
    getRunMock.mockRejectedValue(notFound());
    getStateMock.mockReturnValue({
      status: 'succeeded',
      runId: 'rid',
      workflowId: 'wf',
      iterationByLoopId: {},
      scope: { 'end-1': { outcome: 'succeeded' } },
      startedAt: 1000,
      finishedAt: 1500,
    });
    const [req, ctx] = reqCtx('wf', 'rid');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { status: string; finishedAt?: number } };
    expect(body.run.status).toBe('succeeded');
    expect(body.run.finishedAt).toBe(1500);
  });

  it('404s when neither persisted nor matching engine snapshot', async () => {
    getRunMock.mockRejectedValue(notFound());
    getStateMock.mockReturnValue({
      status: 'idle',
      iterationByLoopId: {},
      scope: {},
    });
    const [req, ctx] = reqCtx('wf', 'rid');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test app/api/runs/[workflowId]/[runId]/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update the route**

Replace `app/api/runs/[workflowId]/[runId]/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { getRun } from '@/lib/server/run-store';
import { isNotFoundError } from '@/app/api/workflows/validate';
import { workflowEngine } from '@/lib/server/workflow-engine';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workflowId: string; runId: string }> },
) {
  const { workflowId, runId } = await ctx.params;

  try {
    const run = await getRun(workflowId, runId);
    return NextResponse.json({ run }, { status: 200 });
  } catch (err) {
    if (!isNotFoundError(err)) {
      const message = err instanceof Error ? err.message : 'load failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }
    // Fall through to engine snapshot.
  }

  const snap = workflowEngine.getState();
  if (snap.runId === runId && snap.workflowId === workflowId) {
    const synthetic = {
      runId,
      workflowId,
      status: snap.status,
      startedAt: snap.startedAt,
      finishedAt: snap.finishedAt,
      errorMessage: snap.errorMessage,
      currentNodeId: snap.currentNodeId,
      iterationByLoopId: snap.iterationByLoopId,
      scope: snap.scope,
    };
    return NextResponse.json({ run: synthetic }, { status: 200 });
  }

  return NextResponse.json({ error: 'run not found' }, { status: 404 });
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test app/api/runs/[workflowId]/[runId]/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full API test suite for regressions**

```bash
bun test app/api
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/runs/[workflowId]/[runId]/route.ts app/api/runs/[workflowId]/[runId]/route.test.ts
git commit -m "feat(api/runs): fall through to engine snapshot for in-flight and just-settled runs"
```

---

### Task A4: Optional `INFLOOP_API_TOKEN` bearer-token auth

**Files:**
- Create: `app/api/_auth.ts`
- Create: `app/api/_auth.test.ts`
- Modify: `app/api/run/route.ts` (call `requireAuth` at top of `POST` and `GET`)
- Modify: `app/api/run/stop/route.ts` (call `requireAuth`)
- Modify: `app/api/runs/route.ts` (call `requireAuth` on `GET`)
- Modify: `app/api/runs/[workflowId]/[runId]/route.ts` (call `requireAuth`)

- [ ] **Step 1: Write the failing tests**

Create `app/api/_auth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { requireAuth } from './_auth';

const orig = process.env.INFLOOP_API_TOKEN;

afterEach(() => {
  if (orig === undefined) delete process.env.INFLOOP_API_TOKEN;
  else process.env.INFLOOP_API_TOKEN = orig;
});

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/run', { method: 'POST', headers });
}

describe('requireAuth', () => {
  it('returns null when no token is configured (open mode)', () => {
    delete process.env.INFLOOP_API_TOKEN;
    expect(requireAuth(req())).toBeNull();
  });

  it('returns 401 when token is configured and header is missing', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    const res = requireAuth(req());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('returns 401 on wrong token', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    const res = requireAuth(req({ authorization: 'Bearer wrong' }));
    expect(res!.status).toBe(401);
  });

  it('returns null on correct bearer token', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    expect(requireAuth(req({ authorization: 'Bearer secret' }))).toBeNull();
  });

  it('accepts case-insensitive scheme', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    expect(requireAuth(req({ authorization: 'bearer secret' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test app/api/_auth.test.ts
```

Expected: FAIL (`requireAuth` doesn't exist).

- [ ] **Step 3: Implement `requireAuth`**

Create `app/api/_auth.ts`:

```ts
import { NextResponse } from 'next/server';

/**
 * Returns `null` if the request is authorized (or if no token is
 * configured), or a `401` NextResponse to return immediately if not.
 *
 * When `INFLOOP_API_TOKEN` is unset, the server is in open mode and
 * every call is allowed — matches today's behaviour.
 *
 * When set, the request must carry `Authorization: Bearer <token>`
 * matching the env var exactly (constant-time compare).
 */
export function requireAuth(req: Request): NextResponse | null {
  const token = process.env.INFLOOP_API_TOKEN;
  if (!token) return null;

  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!constantTimeEq(m[1], token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
bun test app/api/_auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire `requireAuth` into the four routes**

Add this pattern at the top of each handler in the four files listed above:

```ts
import { requireAuth } from '@/app/api/_auth';
// or relative path '../_auth' / '../../_auth' depending on depth

export async function POST(req: Request /* …other args */) {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  // … existing body …
}
```

Apply to:
- `app/api/run/route.ts` — wrap both `POST` and `GET`.
- `app/api/run/stop/route.ts` — wrap `POST`.
- `app/api/runs/route.ts` — wrap `GET`.
- `app/api/runs/[workflowId]/[runId]/route.ts` — wrap `GET`.

For `GET` handlers that take `(req, ctx)`, name the first arg `req` (not `_req`) so `requireAuth(req)` compiles.

- [ ] **Step 6: Run the full API test suite**

```bash
bun test app/api
```

Expected: all pass (no test sets `INFLOOP_API_TOKEN`, so all existing tests run in open mode and continue passing).

- [ ] **Step 7: Add an integration test that exercises auth on a real route**

Append to `app/api/run/route.test.ts`:

```ts
describe('POST /api/run with INFLOOP_API_TOKEN', () => {
  const orig = process.env.INFLOOP_API_TOKEN;
  afterAll(() => {
    if (orig === undefined) delete process.env.INFLOOP_API_TOKEN;
    else process.env.INFLOOP_API_TOKEN = orig;
  });

  it('returns 401 without the bearer header', async () => {
    process.env.INFLOOP_API_TOKEN = 'shh';
    const res = await POST(jsonRequest({ workflowId: 'wf-1' }));
    expect(res.status).toBe(401);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('proceeds with the correct bearer header', async () => {
    process.env.INFLOOP_API_TOKEN = 'shh';
    getWorkflowMock.mockResolvedValue(sampleWorkflow);
    getStateMock.mockReturnValue({ ...runningState, runId: 'rid' });

    const req = new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer shh' },
      body: JSON.stringify({ workflowId: 'wf-1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
  });
});
```

Run it:

```bash
bun test app/api/run/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/_auth.ts app/api/_auth.test.ts \
        app/api/run/route.ts app/api/run/route.test.ts \
        app/api/run/stop/route.ts \
        app/api/runs/route.ts \
        app/api/runs/[workflowId]/[runId]/route.ts
git commit -m "feat(api): optional INFLOOP_API_TOKEN bearer-token auth"
```

---

## Phase B — MCP server

### Task B1: Scaffold `mcp/inflooop-mcp/` package

**Files:**
- Create: `mcp/inflooop-mcp/package.json`
- Create: `mcp/inflooop-mcp/tsconfig.json`
- Create: `mcp/inflooop-mcp/index.ts` *(skeleton — just boots and exits)*

- [ ] **Step 1: Create `mcp/inflooop-mcp/package.json`**

```json
{
  "name": "inflooop-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "start": "bun run index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `mcp/inflooop-mcp/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["bun-types"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Create the skeleton `mcp/inflooop-mcp/index.ts`**

```ts
#!/usr/bin/env bun
// InfLoop MCP server: spawned over stdio by an MCP client (Claude Code, etc.)
// and exposes each saved workflow as its own tool. See
// specs/trigger-api-mcp.md

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const baseUrl = process.env.INFLOOP_BASE_URL ?? 'http://localhost:3000';
const token = process.env.INFLOOP_API_TOKEN;
const toolTimeoutMs = Number(process.env.INFLOOP_TOOL_TIMEOUT_MS ?? 600_000);
const pollIntervalMs = Number(process.env.INFLOOP_POLL_INTERVAL_MS ?? 500);

const server = new Server(
  { name: 'inflooop', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Tool registration happens in B6; this file is a skeleton for now.

await server.connect(new StdioServerTransport());
process.stderr.write(`[inflooop-mcp] connected to ${baseUrl}\n`);
```

- [ ] **Step 4: Install dependencies in the new sub-package**

The root `package.json` uses Bun's workspaces. Add `mcp/inflooop-mcp` to the workspaces list. Read the root `package.json` first to confirm the field exists; if not, run:

```bash
cd mcp/inflooop-mcp
bun install
cd ../..
```

Either way, after install, run:

```bash
bun run mcp/inflooop-mcp/index.ts < /dev/null
```

It should print `[inflooop-mcp] connected to http://localhost:3000` to stderr and exit cleanly when stdin closes.

- [ ] **Step 5: Commit**

```bash
git add mcp/inflooop-mcp/
# add any root package.json/bun.lock changes from the workspace edit
git add package.json bun.lock 2>/dev/null || true
git commit -m "feat(mcp): scaffold inflooop-mcp package"
```

---

### Task B2: Workflow → MCP tool schema mapping

**Files:**
- Create: `mcp/inflooop-mcp/workflow-to-tool.ts`
- Create: `mcp/inflooop-mcp/workflow-to-tool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp/inflooop-mcp/workflow-to-tool.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { Workflow } from '../../lib/shared/workflow';
import { workflowToTool, sanitizeToolName, deconflictNames } from './workflow-to-tool';

function wf(partial: Partial<Workflow>): Workflow {
  return {
    id: 'wf',
    name: 'wf',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    nodes: [],
    edges: [],
    ...partial,
  };
}

describe('sanitizeToolName', () => {
  it('lowercases, replaces non-[a-z0-9_] with _', () => {
    expect(sanitizeToolName('Summarize-PR')).toBe('summarize_pr');
    expect(sanitizeToolName('loop-claude-until-condition'))
      .toBe('loop_claude_until_condition');
    expect(sanitizeToolName('foo bar baz!')).toBe('foo_bar_baz_');
  });
});

describe('deconflictNames', () => {
  it('suffixes _2, _3 on collision', () => {
    const out = deconflictNames(['foo', 'foo', 'foo', 'bar']);
    expect(out).toEqual(['foo', 'foo_2', 'foo_3', 'bar']);
  });
});

describe('workflowToTool', () => {
  it('builds a tool with empty object schema when no inputs declared', () => {
    const tool = workflowToTool(wf({ id: 'simple', name: 'Simple' }), 'simple');
    expect(tool.name).toBe('simple');
    expect(tool.description).toContain('Simple');
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('maps declared inputs to JSON-schema properties', () => {
    const tool = workflowToTool(
      wf({
        id: 'pr',
        name: 'Summarize PR',
        inputs: [
          { name: 'pr_url', type: 'string', description: 'The PR URL' },
          { name: 'max_iters', type: 'number', default: 5 },
          { name: 'verbose', type: 'boolean', default: false },
          { name: 'notes', type: 'text', description: 'Free-form notes' },
        ],
      }),
      'pr',
    );

    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        pr_url: { type: 'string', description: 'The PR URL' },
        max_iters: { type: 'number', default: 5 },
        verbose: { type: 'boolean', default: false },
        notes: { type: 'string', description: 'Free-form notes' },
      },
      required: ['pr_url'],
      additionalProperties: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test mcp/inflooop-mcp/workflow-to-tool.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `mcp/inflooop-mcp/workflow-to-tool.ts`**

```ts
import type { Workflow, WorkflowInputDecl } from '../../lib/shared/workflow';

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

export function sanitizeToolName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/** Apply `_2`, `_3`, … suffixes so the returned list has no duplicates,
 *  preserving order. Used after sanitising workflow ids in case two ids
 *  collide on the same sanitised name. */
export function deconflictNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((n) => {
    const seen = counts.get(n) ?? 0;
    counts.set(n, seen + 1);
    return seen === 0 ? n : `${n}_${seen + 1}`;
  });
}

function inputToSchemaProperty(input: WorkflowInputDecl): Record<string, unknown> {
  // 'text' is multi-line string in InfLoop; JSON schema doesn't
  // distinguish, so we map both to 'string'.
  const jsonType: 'string' | 'number' | 'boolean' =
    input.type === 'number' ? 'number'
    : input.type === 'boolean' ? 'boolean'
    : 'string';

  const prop: Record<string, unknown> = { type: jsonType };
  if (input.description) prop.description = input.description;
  if (input.default !== undefined) prop.default = input.default;
  return prop;
}

export function workflowToTool(
  workflow: Workflow,
  toolName: string,
): McpToolSpec {
  const inputs = workflow.inputs ?? [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const input of inputs) {
    properties[input.name] = inputToSchemaProperty(input);
    if (input.default === undefined) required.push(input.name);
  }

  const description =
    `${workflow.name}\n\nRuns InfLoop workflow "${workflow.id}". ` +
    `Returns once the run settles (or after timeout).`;

  const inputSchema: McpToolSpec['inputSchema'] = {
    type: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) inputSchema.required = required;

  return { name: toolName, description, inputSchema };
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test mcp/inflooop-mcp/workflow-to-tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/inflooop-mcp/workflow-to-tool.ts mcp/inflooop-mcp/workflow-to-tool.test.ts
git commit -m "feat(mcp): map workflow inputs to MCP tool JSON schemas"
```

---

### Task B3: Output filter

**Files:**
- Create: `mcp/inflooop-mcp/filter-outputs.ts`
- Create: `mcp/inflooop-mcp/filter-outputs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp/inflooop-mcp/filter-outputs.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { filterOutputs } from './filter-outputs';

describe('filterOutputs', () => {
  it('strips inputs, __inputs, globals', () => {
    const scope = {
      inputs: { foo: 'bar' },
      __inputs: { foo: 'bar' },
      globals: { url: 'https://…' },
      'claude-1': { stdout: 'hello', exitCode: 0 },
      'end-1': { outcome: 'succeeded' },
    };
    expect(filterOutputs(scope)).toEqual({
      'claude-1': { stdout: 'hello', exitCode: 0 },
      'end-1': { outcome: 'succeeded' },
    });
  });

  it('returns an empty object for an empty scope', () => {
    expect(filterOutputs({})).toEqual({});
  });

  it('passes through undefined or non-object input safely', () => {
    expect(filterOutputs(undefined)).toEqual({});
    expect(filterOutputs(null as unknown as Record<string, unknown>)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test mcp/inflooop-mcp/filter-outputs.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `mcp/inflooop-mcp/filter-outputs.ts`**

```ts
const HIDDEN_KEYS = new Set(['inputs', '__inputs', 'globals']);

/** Drop caller-supplied keys from a run scope before returning it to an
 *  MCP caller. The caller already supplied `inputs` and the workflow's
 *  `globals` are static; both add noise without signal. */
export function filterOutputs(
  scope: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!scope || typeof scope !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(scope)) {
    if (HIDDEN_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test mcp/inflooop-mcp/filter-outputs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/inflooop-mcp/filter-outputs.ts mcp/inflooop-mcp/filter-outputs.test.ts
git commit -m "feat(mcp): strip caller-known keys from returned outputs"
```

---

### Task B4: HTTP client + per-workflow tool runtime

**Files:**
- Create: `mcp/inflooop-mcp/inflooop-client.ts`
- Create: `mcp/inflooop-mcp/inflooop-client.test.ts`
- Create: `mcp/inflooop-mcp/run-tool.ts`
- Create: `mcp/inflooop-mcp/run-tool.test.ts`

- [ ] **Step 1: Write failing tests for the HTTP client**

Create `mcp/inflooop-mcp/inflooop-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { InflooopClient } from './inflooop-client';

const fetchMock = mock(async (_url: string, _init?: RequestInit) => new Response());
// Replace global fetch for this test process.
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

describe('InflooopClient.startRun', () => {
  it('POSTs to /api/run with workflowId+inputs and parses { runId }', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ runId: 'rid', state: {} }), { status: 202 }),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', { foo: 'bar' });
    expect(out).toEqual({ ok: true, runId: 'rid' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://infloop/api/run');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      workflowId: 'wf',
      inputs: { foo: 'bar' },
    });
  });

  it('returns { ok:false, kind:"busy", runId, workflowId } on 409', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'busy', runId: 'other', workflowId: 'wf-other' }),
        { status: 409 },
      ),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', {});
    expect(out).toEqual({
      ok: false,
      kind: 'busy',
      runId: 'other',
      workflowId: 'wf-other',
    });
  });

  it('returns { ok:false, kind:"invalid-inputs", field, reason } on 400', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'invalid-inputs', field: 'pr_url', reason: 'required' }),
        { status: 400 },
      ),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', {});
    expect(out).toEqual({
      ok: false,
      kind: 'invalid-inputs',
      field: 'pr_url',
      reason: 'required',
    });
  });

  it('forwards Authorization: Bearer when token is set', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ runId: 'r', state: {} }), { status: 202 }),
    );
    const c = new InflooopClient('http://infloop', 'tok');
    await c.startRun('wf', {});
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });
});

describe('InflooopClient.getRun', () => {
  it('returns the run record on 200', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ run: { status: 'running', runId: 'r' } }), { status: 200 }),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.getRun('wf', 'r');
    expect(out).toEqual({ ok: true, run: { status: 'running', runId: 'r' } });
  });

  it('returns { ok:false, kind:"not-found" } on 404', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nf' }), { status: 404 }));
    const c = new InflooopClient('http://infloop');
    const out = await c.getRun('wf', 'r');
    expect(out).toEqual({ ok: false, kind: 'not-found' });
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
bun test mcp/inflooop-mcp/inflooop-client.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `mcp/inflooop-mcp/inflooop-client.ts`**

```ts
export interface PersistedRun {
  runId: string;
  workflowId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  currentNodeId?: string;
  iterationByLoopId?: Record<string, number>;
  scope?: Record<string, unknown>;
}

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; kind: 'busy'; runId?: string; workflowId?: string }
  | { ok: false; kind: 'invalid-inputs'; field?: string; reason?: string }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'http-error'; status: number; message: string };

export type GetRunResult =
  | { ok: true; run: PersistedRun }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'http-error'; status: number; message: string };

export type CancelRunResult =
  | { ok: true }
  | { ok: false; kind: 'unauthorized' | 'http-error'; status?: number; message?: string };

export class InflooopClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  async listWorkflowSummaries(): Promise<
    Array<{ id: string; name: string; version: number; updatedAt: number; source?: string }>
  > {
    const r = await fetch(`${this.baseUrl}/api/workflows`, { headers: this.headers() });
    if (!r.ok) throw new Error(`listWorkflows: HTTP ${r.status}`);
    const body = (await r.json()) as { workflows: Array<{ id: string; name: string; version: number; updatedAt: number; source?: string }> };
    return body.workflows;
  }

  async getWorkflow(id: string): Promise<unknown> {
    const r = await fetch(`${this.baseUrl}/api/workflows/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    });
    if (!r.ok) throw new Error(`getWorkflow(${id}): HTTP ${r.status}`);
    const body = (await r.json()) as { workflow: unknown };
    return body.workflow;
  }

  async startRun(workflowId: string, inputs: Record<string, unknown>): Promise<StartRunResult> {
    const r = await fetch(`${this.baseUrl}/api/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ workflowId, inputs }),
    });
    const body = await r.json().catch(() => ({} as Record<string, unknown>));

    if (r.status === 202) {
      return { ok: true, runId: String((body as { runId?: string }).runId ?? '') };
    }
    if (r.status === 409) {
      const b = body as { runId?: string; workflowId?: string };
      return { ok: false, kind: 'busy', runId: b.runId, workflowId: b.workflowId };
    }
    if (r.status === 400) {
      const b = body as { field?: string; reason?: string };
      return { ok: false, kind: 'invalid-inputs', field: b.field, reason: b.reason };
    }
    if (r.status === 401) return { ok: false, kind: 'unauthorized' };
    if (r.status === 404) return { ok: false, kind: 'not-found' };
    return {
      ok: false,
      kind: 'http-error',
      status: r.status,
      message: String((body as { error?: string }).error ?? r.statusText),
    };
  }

  async getRun(workflowId: string, runId: string): Promise<GetRunResult> {
    const r = await fetch(
      `${this.baseUrl}/api/runs/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}`,
      { headers: this.headers() },
    );
    if (r.status === 200) {
      const body = (await r.json()) as { run: PersistedRun };
      return { ok: true, run: body.run };
    }
    if (r.status === 404) return { ok: false, kind: 'not-found' };
    if (r.status === 401) return { ok: false, kind: 'unauthorized' };
    const body = await r.json().catch(() => ({}));
    return {
      ok: false,
      kind: 'http-error',
      status: r.status,
      message: String((body as { error?: string }).error ?? r.statusText),
    };
  }

  async listRuns(workflowId?: string): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/runs`);
    if (workflowId) url.searchParams.set('workflowId', workflowId);
    const r = await fetch(url.toString(), { headers: this.headers() });
    if (!r.ok) throw new Error(`listRuns: HTTP ${r.status}`);
    return (await r.json()) as { runs: unknown };
  }

  async cancelRun(): Promise<CancelRunResult> {
    const r = await fetch(`${this.baseUrl}/api/run/stop`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, kind: 'unauthorized' };
    return { ok: false, kind: 'http-error', status: r.status };
  }
}
```

- [ ] **Step 4: Run the client tests**

```bash
bun test mcp/inflooop-mcp/inflooop-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing tests for the run-tool poll loop**

Create `mcp/inflooop-mcp/run-tool.test.ts`:

```ts
import { describe, expect, it, mock } from 'bun:test';
import type { InflooopClient, PersistedRun } from './inflooop-client';
import { runWorkflowTool } from './run-tool';

function fakeClient(opts: {
  start: Awaited<ReturnType<InflooopClient['startRun']>>;
  pollResults: Awaited<ReturnType<InflooopClient['getRun']>>[];
}): InflooopClient {
  let i = 0;
  return {
    startRun: mock(async () => opts.start),
    getRun: mock(async () => {
      const r = opts.pollResults[Math.min(i++, opts.pollResults.length - 1)]!;
      return r;
    }),
  } as unknown as InflooopClient;
}

const succeededRun: PersistedRun = {
  runId: 'r',
  workflowId: 'wf',
  status: 'succeeded',
  startedAt: 1,
  finishedAt: 5,
  scope: {
    inputs: { foo: 'bar' },
    'claude-1': { stdout: 'hello' },
  },
};
const runningRun: PersistedRun = {
  runId: 'r',
  workflowId: 'wf',
  status: 'running',
  startedAt: 1,
  scope: {},
};

describe('runWorkflowTool', () => {
  it('returns filtered outputs on settled run', async () => {
    const client = fakeClient({
      start: { ok: true, runId: 'r' },
      pollResults: [
        { ok: true, run: runningRun },
        { ok: true, run: succeededRun },
      ],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: { foo: 'bar' },
      pollIntervalMs: 1,
      timeoutMs: 500,
    });
    expect(out.status).toBe('succeeded');
    expect(out.runId).toBe('r');
    expect(out.outputs).toEqual({ 'claude-1': { stdout: 'hello' } });
  });

  it('surfaces a busy error with the in-flight runId', async () => {
    const client = fakeClient({
      start: { ok: false, kind: 'busy', runId: 'other', workflowId: 'wf-other' },
      pollResults: [],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: {},
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/busy/i);
    expect(out.error).toContain('other');
  });

  it('returns a timeout result with the runId for later polling', async () => {
    const client = fakeClient({
      start: { ok: true, runId: 'r' },
      pollResults: [{ ok: true, run: runningRun }],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: {},
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    expect(out.status).toBe('timeout');
    expect(out.runId).toBe('r');
  });

  it('surfaces invalid-inputs error with the offending field', async () => {
    const client = fakeClient({
      start: { ok: false, kind: 'invalid-inputs', field: 'pr_url', reason: 'required' },
      pollResults: [],
    });
    const out = await runWorkflowTool(client, {
      workflowId: 'wf',
      inputs: {},
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/pr_url/);
    expect(out.error).toMatch(/required/);
  });
});
```

- [ ] **Step 6: Confirm it fails**

```bash
bun test mcp/inflooop-mcp/run-tool.test.ts
```

Expected: FAIL.

- [ ] **Step 7: Implement `mcp/inflooop-mcp/run-tool.ts`**

```ts
import type { InflooopClient, PersistedRun } from './inflooop-client';
import { filterOutputs } from './filter-outputs';

export interface RunToolOptions {
  workflowId: string;
  inputs: Record<string, unknown>;
  pollIntervalMs: number;
  timeoutMs: number;
}

export interface RunToolResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'timeout' | 'error';
  runId?: string;
  durationMs?: number;
  outputs?: Record<string, unknown>;
  errorMessage?: string;
  error?: string;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function jitter(baseMs: number): number {
  // ±20% jitter so concurrent MCP servers don't lock-step the API.
  const delta = baseMs * 0.4 * (Math.random() - 0.5);
  return Math.max(50, Math.round(baseMs + delta));
}

export async function runWorkflowTool(
  client: InflooopClient,
  opts: RunToolOptions,
): Promise<RunToolResult> {
  const start = await client.startRun(opts.workflowId, opts.inputs);
  if (!start.ok) {
    if (start.kind === 'busy') {
      return {
        status: 'error',
        error:
          `InfLoop engine is busy with another run` +
          (start.runId ? ` (runId=${start.runId}, workflowId=${start.workflowId ?? '?'})` : '') +
          `. Use inflooop_get_run_status to track it, or retry later.`,
      };
    }
    if (start.kind === 'invalid-inputs') {
      return {
        status: 'error',
        error: `Invalid input "${start.field ?? '?'}": ${start.reason ?? 'rejected'}`,
      };
    }
    if (start.kind === 'not-found') {
      return {
        status: 'error',
        error:
          `Workflow "${opts.workflowId}" not found. ` +
          `If you added it recently, restart the MCP server to refresh.`,
      };
    }
    if (start.kind === 'unauthorized') {
      return { status: 'error', error: 'Unauthorized — check INFLOOP_API_TOKEN.' };
    }
    return {
      status: 'error',
      error: `HTTP ${start.status}: ${start.message}`,
    };
  }

  const runId = start.runId;
  const deadline = Date.now() + opts.timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, jitter(opts.pollIntervalMs)));

    const polled = await client.getRun(opts.workflowId, runId);
    if (!polled.ok) {
      // 404 means the engine moved on; treat as terminal-but-lost.
      return {
        status: 'error',
        runId,
        error:
          polled.kind === 'not-found'
            ? `Run ${runId} no longer tracked (engine may have restarted).`
            : polled.kind === 'unauthorized'
              ? 'Unauthorized — check INFLOOP_API_TOKEN.'
              : `HTTP error fetching run status.`,
      };
    }

    const run: PersistedRun = polled.run;
    if (TERMINAL.has(run.status)) {
      return {
        status: run.status as 'succeeded' | 'failed' | 'cancelled',
        runId,
        durationMs:
          run.finishedAt != null && run.startedAt != null
            ? run.finishedAt - run.startedAt
            : undefined,
        outputs: filterOutputs(run.scope),
        errorMessage: run.errorMessage,
      };
    }
    // else: still running — loop.
  }

  return {
    status: 'timeout',
    runId,
    error:
      `Run did not settle within ${opts.timeoutMs}ms. ` +
      `Use inflooop_get_run_status with runId=${runId} to check later.`,
  };
}
```

- [ ] **Step 8: Run the run-tool tests**

```bash
bun test mcp/inflooop-mcp/run-tool.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mcp/inflooop-mcp/inflooop-client.ts mcp/inflooop-mcp/inflooop-client.test.ts \
        mcp/inflooop-mcp/run-tool.ts mcp/inflooop-mcp/run-tool.test.ts
git commit -m "feat(mcp): HTTP client and per-workflow tool poll loop"
```

---

### Task B5: Utility tools (`get_run_status`, `list_runs`, `cancel_run`)

**Files:**
- Create: `mcp/inflooop-mcp/utility-tools.ts`
- Create: `mcp/inflooop-mcp/utility-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Create `mcp/inflooop-mcp/utility-tools.test.ts`:

```ts
import { describe, expect, it, mock } from 'bun:test';
import type { InflooopClient, PersistedRun } from './inflooop-client';
import { getRunStatus, listRuns, cancelRun } from './utility-tools';

function clientWith(overrides: Partial<InflooopClient>): InflooopClient {
  return overrides as InflooopClient;
}

const settled: PersistedRun = {
  runId: 'r',
  workflowId: 'wf',
  status: 'succeeded',
  startedAt: 1,
  finishedAt: 5,
  scope: { inputs: { hidden: 1 }, 'a': { result: 'ok' } },
};

describe('getRunStatus', () => {
  it('returns status + filtered outputs', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: true, run: settled })),
    });
    const out = await getRunStatus(c, { workflowId: 'wf', runId: 'r' });
    expect(out.status).toBe('succeeded');
    expect(out.outputs).toEqual({ a: { result: 'ok' } });
  });

  it('surfaces not-found cleanly', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: false, kind: 'not-found' as const })),
    });
    const out = await getRunStatus(c, { workflowId: 'wf', runId: 'r' });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/not found/i);
  });
});

describe('listRuns', () => {
  it('forwards to client.listRuns', async () => {
    const list = mock(async () => ({ runs: [{ runId: 'a' }, { runId: 'b' }] }));
    const c = clientWith({ listRuns: list });
    const out = await listRuns(c, { workflowId: 'wf' });
    expect(out.runs?.length).toBe(2);
    expect(list).toHaveBeenCalledWith('wf');
  });
});

describe('cancelRun', () => {
  it('returns cancelled:true when the runId matches the in-flight run', async () => {
    const c = clientWith({
      getRun: mock(async () => ({
        ok: true,
        run: { ...settled, status: 'running', runId: 'r' } as PersistedRun,
      })),
      cancelRun: mock(async () => ({ ok: true as const })),
    });
    const out = await cancelRun(c, { workflowId: 'wf', runId: 'r' });
    expect(out.cancelled).toBe(true);
  });

  it('returns cancelled:false when the run already settled', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: true, run: settled })),
    });
    const out = await cancelRun(c, { workflowId: 'wf', runId: 'r' });
    expect(out.cancelled).toBe(false);
    expect(out.reason).toMatch(/already settled/i);
  });

  it('returns cancelled:false when the runId does not match the current run', async () => {
    const c = clientWith({
      getRun: mock(async () => ({ ok: false, kind: 'not-found' as const })),
    });
    const out = await cancelRun(c, { workflowId: 'wf', runId: 'rid-old' });
    expect(out.cancelled).toBe(false);
    expect(out.reason).toMatch(/no longer/i);
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
bun test mcp/inflooop-mcp/utility-tools.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `mcp/inflooop-mcp/utility-tools.ts`**

```ts
import type { InflooopClient } from './inflooop-client';
import { filterOutputs } from './filter-outputs';

export async function getRunStatus(
  client: InflooopClient,
  args: { workflowId: string; runId: string },
): Promise<{
  status: string;
  runId?: string;
  durationMs?: number;
  outputs?: Record<string, unknown>;
  errorMessage?: string;
  error?: string;
}> {
  const r = await client.getRun(args.workflowId, args.runId);
  if (!r.ok) {
    if (r.kind === 'not-found') {
      return { status: 'error', error: `Run ${args.runId} not found.` };
    }
    if (r.kind === 'unauthorized') {
      return { status: 'error', error: 'Unauthorized — check INFLOOP_API_TOKEN.' };
    }
    return { status: 'error', error: `HTTP error fetching run.` };
  }
  const run = r.run;
  return {
    status: run.status,
    runId: run.runId,
    durationMs:
      run.finishedAt != null && run.startedAt != null
        ? run.finishedAt - run.startedAt
        : undefined,
    outputs: filterOutputs(run.scope),
    errorMessage: run.errorMessage,
  };
}

export async function listRuns(
  client: InflooopClient,
  args: { workflowId?: string },
): Promise<{ runs?: unknown[] }> {
  const out = (await client.listRuns(args.workflowId)) as { runs?: unknown[] };
  return { runs: out.runs };
}

export async function cancelRun(
  client: InflooopClient,
  args: { workflowId: string; runId: string },
): Promise<{ cancelled: boolean; reason?: string }> {
  const polled = await client.getRun(args.workflowId, args.runId);
  if (!polled.ok) {
    return {
      cancelled: false,
      reason:
        polled.kind === 'not-found'
          ? `Run ${args.runId} is no longer tracked by the engine.`
          : `Could not check run status (${polled.kind}).`,
    };
  }
  if (polled.run.status !== 'running') {
    return {
      cancelled: false,
      reason: `Run already settled with status "${polled.run.status}".`,
    };
  }
  const stop = await client.cancelRun();
  if (!stop.ok) {
    return { cancelled: false, reason: `Stop call failed (${stop.kind}).` };
  }
  return { cancelled: true };
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test mcp/inflooop-mcp/utility-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/inflooop-mcp/utility-tools.ts mcp/inflooop-mcp/utility-tools.test.ts
git commit -m "feat(mcp): utility tools — get_run_status, list_runs, cancel_run"
```

---

### Task B6: Wire MCP server in `index.ts`

**Files:**
- Modify: `mcp/inflooop-mcp/index.ts`

This is the only task without a unit test — the MCP SDK glue is the bulk and is exercised manually. Module-level pieces (schemas, tool runtime, utility tools) are unit-tested via the earlier tasks.

- [ ] **Step 1: Replace `mcp/inflooop-mcp/index.ts`**

```ts
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { Workflow } from '../../lib/shared/workflow';
import { InflooopClient } from './inflooop-client';
import { runWorkflowTool } from './run-tool';
import { getRunStatus, listRuns, cancelRun } from './utility-tools';
import {
  sanitizeToolName,
  deconflictNames,
  workflowToTool,
  type McpToolSpec,
} from './workflow-to-tool';

const baseUrl = process.env.INFLOOP_BASE_URL ?? 'http://localhost:3000';
const token = process.env.INFLOOP_API_TOKEN;
const toolTimeoutMs = Number(process.env.INFLOOP_TOOL_TIMEOUT_MS ?? 600_000);
const pollIntervalMs = Number(process.env.INFLOOP_POLL_INTERVAL_MS ?? 500);

const client = new InflooopClient(baseUrl, token);

// ─── Workflow discovery + tool registration ──────────────────────────────
//
// Per the spec, workflows are fetched once at startup. Adding/renaming a
// workflow requires restarting the MCP server. Live refresh is a follow-up.

interface RegisteredWorkflowTool {
  spec: McpToolSpec;
  workflowId: string;
}

async function discoverWorkflowTools(): Promise<RegisteredWorkflowTool[]> {
  let summaries: Awaited<ReturnType<InflooopClient['listWorkflowSummaries']>>;
  try {
    summaries = await client.listWorkflowSummaries();
  } catch (err) {
    process.stderr.write(
      `[inflooop-mcp] could not fetch /api/workflows from ${baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }\n[inflooop-mcp] registering utility tools only; restart once InfLoop is reachable.\n`,
    );
    return [];
  }

  const fulls: Workflow[] = [];
  for (const s of summaries) {
    try {
      const wf = (await client.getWorkflow(s.id)) as Workflow;
      fulls.push(wf);
    } catch (err) {
      process.stderr.write(
        `[inflooop-mcp] skipped workflow ${s.id}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }

  const rawNames = fulls.map((w) => sanitizeToolName(w.id));
  const finalNames = deconflictNames(rawNames);

  for (let i = 0; i < fulls.length; i++) {
    if (rawNames[i] !== finalNames[i]) {
      process.stderr.write(
        `[inflooop-mcp] tool-name collision: "${fulls[i]!.id}" -> "${finalNames[i]}"\n`,
      );
    }
  }

  return fulls.map((wf, i) => ({
    workflowId: wf.id,
    spec: workflowToTool(wf, finalNames[i]!),
  }));
}

// ─── Utility-tool specs (fixed) ──────────────────────────────────────────

const UTILITY_TOOLS: McpToolSpec[] = [
  {
    name: 'inflooop_get_run_status',
    description: 'Fetch the status and outputs of an InfLoop run by id.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'The workflow id.' },
        runId: { type: 'string', description: 'The run id returned by a tool call.' },
      },
      required: ['workflowId', 'runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'inflooop_list_runs',
    description: 'List recent InfLoop runs, optionally filtered by workflowId.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Optional workflow id filter.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inflooop_cancel_run',
    description: 'Cancel an in-flight InfLoop run, if runId matches the current run.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        runId: { type: 'string' },
      },
      required: ['workflowId', 'runId'],
      additionalProperties: false,
    },
  },
];

// ─── Server setup ────────────────────────────────────────────────────────

const workflowTools = await discoverWorkflowTools();
const workflowToolByName = new Map(workflowTools.map((t) => [t.spec.name, t]));

const server = new Server(
  { name: 'inflooop', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...workflowTools.map((t) => t.spec),
    ...UTILITY_TOOLS,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  if (name === 'inflooop_get_run_status') {
    const out = await getRunStatus(client, args as { workflowId: string; runId: string });
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'inflooop_list_runs') {
    const out = await listRuns(client, args as { workflowId?: string });
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'inflooop_cancel_run') {
    const out = await cancelRun(client, args as { workflowId: string; runId: string });
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }

  const wt = workflowToolByName.get(name);
  if (!wt) {
    return {
      content: [{ type: 'text', text: `Unknown tool "${name}".` }],
      isError: true,
    };
  }

  const out = await runWorkflowTool(client, {
    workflowId: wt.workflowId,
    inputs: args as Record<string, unknown>,
    pollIntervalMs,
    timeoutMs: toolTimeoutMs,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
    isError: out.status === 'error',
  };
});

await server.connect(new StdioServerTransport());
process.stderr.write(
  `[inflooop-mcp] connected — ${workflowTools.length} workflow tool(s) registered, ` +
    `base=${baseUrl}\n`,
);
```

- [ ] **Step 2: Type-check the MCP package**

```bash
bunx tsc -p mcp/inflooop-mcp/tsconfig.json --noEmit
```

Expected: no errors. (If `tsc` isn't on PATH, fall back to `bun run --tsconfig mcp/inflooop-mcp/tsconfig.json -- bunx tsc --noEmit` or skip and rely on bun's runtime type-stripping; the unit tests are the safety net.)

- [ ] **Step 3: Manual smoke test against a running InfLoop**

In one terminal:

```bash
bun run dev
```

In another:

```bash
# List tools — should print workflow tools + utility tools.
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | bun run mcp/inflooop-mcp/index.ts
```

Expected: stderr says `connected — N workflow tool(s) registered`; stdout contains a `tools/list` response listing `loop_claude_until_condition` (or whichever workflows exist) plus the three utility tools.

- [ ] **Step 4: Commit**

```bash
git add mcp/inflooop-mcp/index.ts
git commit -m "feat(mcp): wire workflow + utility tools into stdio MCP server"
```

---

## Phase C — Docs

### Task C1: README — MCP install section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a new section after the existing "Configuration" section**

Find the `## Configuration` section's closing (just before `## Tech stack`). Insert the following markdown before `## Tech stack` (note the use of `~~~` fences below so this plan file's nested code blocks render correctly — when you write it into `README.md`, swap `~~~` back to triple backticks):

~~~markdown
## Triggering workflows from agents (MCP)

InfLoop ships a small MCP server that exposes each saved workflow as its
own tool, with input schema derived from the workflow's declared
`inputs[]`. Any MCP-speaking client (Claude Code, Cursor, Cline, …) can
discover and invoke InfLoop workflows by name.

The server lives in `mcp/inflooop-mcp/`. It is a long-lived stdio process
spawned by the MCP client; it talks to a running InfLoop over HTTP.

### Install in Claude Code

~~~bash
claude mcp add inflooop -- bun run /absolute/path/to/InfLoop/mcp/inflooop-mcp/index.ts
~~~

For other MCP clients, the equivalent `mcpServers` block:

~~~json
{
  "mcpServers": {
    "inflooop": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/InfLoop/mcp/inflooop-mcp/index.ts"],
      "env": {
        "INFLOOP_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
~~~

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `INFLOOP_BASE_URL` | `http://localhost:3000` | Where InfLoop is reachable. |
| `INFLOOP_API_TOKEN` | unset | If set, forwarded as `Authorization: Bearer …` on every call. Must match the InfLoop server's `INFLOOP_API_TOKEN`. |
| `INFLOOP_TOOL_TIMEOUT_MS` | `600000` | How long a per-workflow tool call waits before returning a timeout result with the `runId`. |
| `INFLOOP_POLL_INTERVAL_MS` | `500` | Base polling cadence (jittered ±20%). |

### Tools exposed

- **One tool per workflow** — named after the workflow id (sanitized to
  `[a-z0-9_]`), with inputs derived from the workflow's `inputs[]`.
  Calling the tool starts a run and blocks until it settles (or the
  configured timeout fires), then returns `{ runId, status, outputs }`.
- **`inflooop_get_run_status({ workflowId, runId })`** — read a run's
  current status and outputs.
- **`inflooop_list_runs({ workflowId? })`** — list recent runs.
- **`inflooop_cancel_run({ workflowId, runId })`** — cancel an in-flight
  run if the runId matches.

### Limitations

- The engine runs one workflow at a time. A second concurrent tool call
  gets a busy error naming the in-flight `runId`; use `inflooop_get_run_status`
  to wait for it.
- Workflow discovery happens at MCP-server startup. Add a new workflow
  → restart the MCP server. Live refresh is a planned follow-up.

~~~

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document the MCP server"
```

---

## Validation

After all tasks complete, run the full suite as a final check:

- [ ] **Full test run**

```bash
bun run typecheck
bun run test
```

Both must pass before considering the work done.

- [ ] **Manual: end-to-end with Claude Code**

1. Start InfLoop: `bun run dev`.
2. Register the MCP server: `claude mcp add inflooop -- bun run /path/to/InfLoop/mcp/inflooop-mcp/index.ts`.
3. In a Claude Code session, ask "list inflooop tools" — confirm at least one workflow tool and the three utility tools appear.
4. Invoke a workflow tool with valid inputs. Confirm the tool returns
   `{ runId, status, outputs }` once the run settles.
5. Invoke again immediately while still running — confirm the second
   call surfaces the in-flight `runId` as a busy error.
6. Invoke `inflooop_cancel_run` with that `runId` — confirm `cancelled: true`.

If all six work, the feature is shippable.
