# External Trigger: HTTP API + MCP Server

**Status:** Design
**Date:** 2026-05-12
**Author:** rhoninlee (with Claude)

## Problem

InfLoop workflows can only be started from the browser today: click **Run**
in the top bar, which POSTs `/api/run`. There is no first-class path for an
external system — an agent runtime such as Hermes, an MCP-speaking client
such as Claude Code or Cursor, or any HTTP caller — to start a workflow,
discover what workflows exist, or pick up the result of a run it kicked off.

The mechanics for "start a run with typed inputs" already live in
`/api/run` (the Begin-node inputs design). What is missing is:

1. A response shape that lets an async caller poll its own run (the API
   does not return a `runId`).
2. A way for a polling caller to see status while the run is in flight,
   before the run is persisted on settle.
3. A discoverable, agent-friendly surface — one MCP tool per saved
   workflow, with the workflow's declared inputs as typed parameters.

## Goal

Two surfaces, one feature:

- **HTTP API** — minimal additions to existing routes so any HTTP client
  can start a workflow, get a `runId`, and poll for the result.
- **MCP server** — a standalone process that exposes each saved workflow
  as its own MCP tool, with input schema derived from `workflow.inputs[]`,
  so any MCP client (Claude Code, Cursor, Cline, …) can invoke InfLoop
  workflows by name.

Async at the HTTP layer (caller gets a `runId`, polls). MCP wraps the
async API with internal polling so an agent sees one tool call →
final result.

## Non-goals

- Multi-run engine / queueing. The engine stays single-run-at-a-time; a
  second concurrent trigger returns `409 busy`.
- Live filesystem-watching for new/edited workflows. The MCP server reads
  workflows once at startup; restart to refresh.
- Streaming partial tokens to the MCP caller via MCP progress
  notifications. Future work.
- Opinionated webhook routes for specific services (GitHub, Slack, …).
  Those can be built on top of this API later.
- Replacing the browser **Run** button.

## Design

### 1. HTTP API changes

The trigger pathway is mostly already there. Two surgical changes:

**1a. Surface `runId` on the engine snapshot.**

`RunSnapshot` (`lib/shared/workflow.ts`) gains an optional field:

```ts
export interface RunSnapshot {
  status: RunStatus;
  runId?: string;             // ← new
  workflowId?: string;
  currentNodeId?: string;
  // …
}
```

Lifecycle — the engine never returns to a fresh `idle` after a run today;
it holds the terminal status (`succeeded` / `failed` / `cancelled`) on
the snapshot until the next `start()` overwrites everything. `runId`
follows the same lifecycle:

- `start()` assigns `snapshot.runId = currentRunId` together with
  flipping `snapshot.status` to `running`. Both are set in the same
  synchronous block — no window where the snapshot reports `running`
  without a `runId`.
- On settle, `status` becomes terminal but `snapshot.runId` is **not**
  cleared; it stays valid for fall-through reads of the just-finished
  run.
- The next `start()` overwrites `snapshot.runId` with the new id.

`POST /api/run` returns `{ runId, state }` on `202` instead of just
`{ state }`. The UI ignores `runId` (it already reads from `state`), so
this is additive.

**1b. Fall-through to engine state in the run-detail route.**

`GET /api/runs/:workflowId/:runId` today only reads from the persisted
run store. Persistence happens on settle as a fire-and-forget call
(`workflow-engine.ts` near line 225), so there are two windows where the
persisted record is absent: while the run is in flight, and briefly
between settle and disk-write.

The route precedence becomes:

1. **Persisted record** (run-store hit) → return it. Authoritative.
2. **Engine snapshot match** — if the persisted record is missing AND
   `engine.getState().runId === runId` AND
   `engine.getState().workflowId === workflowId`, return a synthetic
   record built from the snapshot. This covers **both** the in-flight
   case and the terminal-but-not-yet-persisted case:

   ```ts
   {
     runId,
     workflowId,
     status,                    // 'running' | 'succeeded' | 'failed' | 'cancelled'
     currentNodeId,             // surfaces progress so a polling client
     iterationByLoopId,         //   can tell a 10-min run isn't wedged
     scope,                     // partial scope while running; full on settle
     startedAt,
     finishedAt,                // present once status is terminal
     errorMessage,              // present on 'failed'
     events: undefined,         // omit; the SSE bus is the canonical live stream
   }
   ```

3. **Neither** → `404`.

The MCP polling loop therefore never has to treat `404` as "wait and
retry": persisted-or-synthetic-snapshot covers the entire lifetime of a
run that the engine knows about. A `404` means the run is genuinely
unknown (wrong id, or the engine has since started a new run).

**1c. Optional bearer-token auth.**

One env var: `INFLOOP_API_TOKEN`.

- Unset (default) → no auth. Today's behavior; suitable for
  localhost / single-user dev.
- Set → all `/api/run*` and `/api/runs*` routes require
  `Authorization: Bearer <token>`. The browser UI is expected to run
  same-origin; it reads the token via `NEXT_PUBLIC_INFLOOP_API_TOKEN`
  and forwards it on its own requests.

> ⚠ **Important caveat.** `NEXT_PUBLIC_*` is inlined into the client
> bundle, so this token is visible to anyone who can load the page.
> Do **not** enable `INFLOOP_API_TOKEN` if your InfLoop UI is reachable
> by anyone you would not give the token to. The token defends the API
> against off-host callers (other devices on your LAN that can't load
> the UI), not against anyone with a browser tab. A stronger
> origin-cookie scheme is a follow-up.

The MCP server reads `INFLOOP_API_TOKEN` from its own env and forwards
`Authorization: Bearer …` on every request.

No other route protection is in scope. This is opt-in hardening for
users exposing InfLoop on LAN / Tailscale.

### 2. MCP server

**Why a standalone process and not an in-process Next route?** MCP
clients (Claude Code, Cursor, Cline) speak stdio: they *spawn* the
server as a child process and exchange JSON-RPC on stdin/stdout. There
is no first-class "MCP-over-HTTP from a long-lived web server" pattern
in the ecosystem yet. We could shoehorn a stdio bridge into the Next
custom server, but it would still have to be spawned by the MCP client,
duplicating the lifecycle. The cost of a standalone process is small —
two HTTP calls per tool invocation and a startup `GET /api/workflows`.

Trade-off: tool discovery is snapshotted at startup (workflow added or
renamed → restart MCP). A filesystem watcher with
`notifications/tools/list_changed` is the natural follow-up; it's
omitted from v1 to keep the surface tight.

A standalone Bun process under `mcp/inflooop-mcp/`:

```
mcp/inflooop-mcp/
  package.json        # @modelcontextprotocol/sdk + zod
  index.ts            # entry point (stdio MCP)
  tsconfig.json
```

#### 2a. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `INFLOOP_BASE_URL` | `http://localhost:3000` | InfLoop HTTP endpoint |
| `INFLOOP_API_TOKEN` | unset | Forwarded as `Authorization: Bearer` if set |
| `INFLOOP_TOOL_TIMEOUT_MS` | `600000` (10 min) | Per-call polling cap |
| `INFLOOP_POLL_INTERVAL_MS` | `500` | Base polling cadence (jittered ±20%) |

#### 2b. Startup

1. Fetch `GET {INFLOOP_BASE_URL}/api/workflows`.
2. For each workflow, register a tool:
   - **name** — `workflow.id` sanitized: lowercase, `[a-z0-9_]+`, dashes
     and other separators → `_`. On collision, append `_2`, `_3`, … and
     log a warning to stderr.
   - **description** — `workflow.name` plus a one-line tail:
     `Runs InfLoop workflow "${workflow.id}". Returns once the run settles
     (or after timeout).`
   - **inputSchema** — JSON-schema object derived from `workflow.inputs[]`.
     Each declared input becomes a property:
     - `type: 'string' | 'number' | 'boolean'` (Begin-node `'text'` →
       `string`)
     - `description` from the input's `description`
     - listed in `required` iff `required: true && default === undefined`
     Workflows with no declared inputs get `{ type: 'object',
     properties: {}, additionalProperties: false }`.
3. Register two fixed utility tools (described in 2d).

If the workflow fetch fails at startup, register zero per-workflow tools,
keep the utility tools, and log the error. The MCP server stays up so the
user can fix the URL without killing their MCP client.

#### 2c. Per-workflow tool invocation

```
agent calls tool "summarize_pr" with { pr_url: "https://…" }
  │
  ├─ POST /api/run { workflowId: "summarize-pr", inputs: { pr_url: … } }
  │     • 409 busy            → response body includes the in-flight
  │                              { runId, workflowId } when known;
  │                              MCP returns a retryable tool error
  │                              naming the in-flight run so the agent
  │                              can choose to poll/wait or abandon
  │     • 400 invalid-inputs  → MCP error: "<field>: <reason>"
  │     • 404 not found       → MCP error: "Workflow no longer exists
  │                              (restart MCP server to refresh)"
  │     • 202 → grab { runId }
  │
  └─ poll GET /api/runs/<workflowId>/<runId> every ~500ms (jittered)
        • status === 'running' → keep polling, up to TOOL_TIMEOUT_MS
        • timeout              → return text result that includes runId
                                  and instructs agent to use
                                  inflooop_get_run_status to check later
        • status settled (succeeded | failed | cancelled) →
              return { runId, status, durationMs, outputs }
```

`outputs` is filtered from the persisted run's terminal `scope`:

- **Drop** keys the caller already knows: `inputs`, `__inputs`, `globals`.
- **Keep** everything else as-is (per-node outputs keyed by node id).

This is the minimum filter for v1 to keep response sizes sane while
preserving full reachability of node outputs. A future iteration may
add a `WorkflowOutputDecl[]` field on the workflow root (mirroring
inputs) so a workflow can declare a named subset of outputs to return;
that change is deferred until we have real callers driving the shape.

If the run did not settle into a terminal status (e.g. timed out from
the MCP side), `outputs` is omitted and the MCP tool's text result
points the agent at `inflooop_get_run_status` with the `runId`.

#### 2d. Utility tools

Three fixed tools to recover from timeouts, introspect history, and
recover from mis-fires:

- **`inflooop_get_run_status({ workflowId, runId })`** — direct
  read-through to `GET /api/runs/<workflowId>/<runId>`. Returns the run
  record (status, filtered scope, errorMessage, durationMs).
- **`inflooop_list_runs({ workflowId? })`** — read-through to
  `GET /api/runs?workflowId=…`. Returns the list of persisted runs,
  newest first.
- **`inflooop_cancel_run({ workflowId, runId })`** — calls
  `POST /api/run/stop` if `runId` matches the currently-running run.
  Returns `{ cancelled: true }` on a hit, `{ cancelled: false,
  reason }` otherwise (e.g. run already settled, runId mismatch). This
  lets an agent abort a mis-fired long run without forcing the user to
  open the browser.

These are intentionally minimal. The per-workflow tools are the everyday
surface; the utility tools exist so an agent can recover when a per-call
tool timed out, mis-fired, or wants to inspect history.

#### 2e. Install

Users add the MCP server once via their MCP client's standard
mechanism. For Claude Code:

```bash
claude mcp add inflooop -- bun run /path/to/InfLoop/mcp/inflooop-mcp/index.ts
```

For other clients, the equivalent `mcpServers` JSON block. README gets a
short section.

### 3. Edge cases

1. **Tool name collisions** — suffix and log; see 2b.
2. **Workflow renamed / deleted while MCP is running** — cached tool
   exists; call gets `404 workflow not found` from `/api/run`, surfaced
   to the agent as a tool error. User restarts MCP to refresh.
3. **MCP can't reach InfLoop at startup** — registers utility tools
   only, logs error, stays up.
4. **Run cancelled while MCP is polling** — `cancelled` is a terminal
   status, returned as a normal result, not as a tool error.
5. **Race between settle and polling** — handled by the precedence
   rule in §1b: persisted record > synthetic snapshot (running or
   terminal, runId-matched) > 404. After the engine starts a new run,
   an old runId either has a persisted record (returned) or 404s.
6. **Two concurrent MCP clients** — second `start_workflow` call hits
   `409 busy`. Surfaced as a retryable tool error that names the
   in-flight run so the second agent can poll/wait via
   `inflooop_get_run_status` rather than abandon.
7. **HMR / process restart with a run in flight** — the engine
   comment in `workflow-engine.ts` already notes this orphans the
   in-flight run with no persisted record. MCP polling will time out
   on `INFLOOP_TOOL_TIMEOUT_MS` and surface a clear error; it will not
   hang. The user-visible failure mode is bounded by the timeout, not
   by the orphan.

## Validation plan

- **Unit:** `RunSnapshot.runId` lifecycle (mints on start, clears on
  idle); run-detail route's fall-through to engine state.
- **Integration:** `bun:test` against the live server — POST
  `/api/run`, poll `/api/runs/...`, assert the synthetic-running record
  then the persisted-settled record.
- **Auth:** with `INFLOOP_API_TOKEN` set, unauthenticated request →
  `401`; correct bearer → `2xx`.
- **MCP server:** small harness that boots the server with a fake
  `INFLOOP_BASE_URL` (HTTP mock), runs the tool registration, asserts
  the resulting tool list and one end-to-end tool call.
- **Manual:** install the MCP server in Claude Code, list tools, run a
  test workflow, observe outputs.

## Risks / open follow-ups

- **Single-run engine** is the hardest constraint to live with for an
  external-trigger surface. Concurrent agents will collide. Acceptable
  for v1; surfaced clearly as `409`. A multi-run refactor (per-run
  scope, per-run event bus, per-run currentRunId, per-run cancel) is a
  separate, larger design.
- **Outputs = terminal scope** is broad. A future iteration could let a
  workflow declare named outputs (mirroring inputs) so MCP returns just
  those keys.
- **Live workflow refresh** is intentionally absent. If it becomes
  annoying, a filesystem watcher + `tools/list_changed` notification
  is the natural follow-up.
- **Streaming via MCP progress notifications** would let agents see
  partial tokens. Wiring engine events through the MCP server is
  straightforward but deferred to keep v1 tight.
