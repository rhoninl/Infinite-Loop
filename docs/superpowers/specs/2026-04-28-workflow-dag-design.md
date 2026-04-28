# InfLoop · Workflow DAG Design

**Date:** 2026-04-28
**Status:** Draft for review
**Supersedes:** the single-loop runtime described in `2026-04-28-infloop-design.md`. The existing app's behavior is preserved as one specific workflow (Start → Loop[Claude → Condition] → End).

## Context

The current InfLoop UI is a single form that drives a fixed inner loop: spawn `claude --print`, evaluate one of three exit conditions, repeat until met or capped. The user wants this replaced with a **node-based workflow editor** so the engine can express:

- Multi-step iterations (run Claude, then a shell check, then a judge call, then loop).
- Branching on outputs ("if `git diff` is empty, stop; else loop").
- Parallel work and cleanup (`Catch`).
- Reusable subworkflows.
- Variable templating in any prompt or command (`{{step1.stdout}}`).

The DAG IS the program (no implicit outer loop), with a built-in `Loop` block container for the common "until condition met" case.

## Scope

In scope (Phase 1 MVP):
- Workflow data model (nodes, edges, variable scope, templating).
- Workflow engine that walks the graph, manages the variable scope, supports cancellation.
- 5 core node types: `Start`, `End`, `Claude`, `Condition`, `Loop`.
- ReactFlow canvas (`@xyflow/react` v12), palette, node config panel, live execution overlay.
- Workflows persisted as JSON files under `workflows/<slug>.json`.
- Run history in-memory only (one active run at a time, matching today).
- Cancellation kills the current node and runs any reachable `Catch`-handled cleanup before settling the run.

In scope (Phase 2): `Shell`, `Judge`, `Branch`, `SetVar`, `Catch`.

In scope (Phase 3): `Parallel`, `Subworkflow`, `Wait`, `HTTP`, `Switch`.

Out of scope: multi-tenant auth, scheduled triggers, marketplace, time-travel debugging, version history beyond JSON-file git history.

## Decisions log (from brainstorming)

- **Q1 — workflow vs iteration body: C, hybrid.** DAG is the entire program; built-in `Loop` block sugars the common case.
- **Q2 — node vocabulary: C, heavy (12+).** Phased rollout: 5 in MVP, 5 more in Phase 2, 5 more in Phase 3.
- **Q3 — data flow: A, n8n-style.** Edges carry control flow with named branches (`next` / `met` / `not_met` / `error`); each node writes outputs to a flat shared scope keyed by node id; other nodes reference via `{{nodeId.field}}` templating in any text field.
- **Q-final/1 — cancellation: b, catch-aware.** Stop kills the current node and lets reachable `Catch` subgraphs run before final cancellation.
- **Q-final/2 — persistence: b.** Workflows saved as JSON files; run history in-memory.
- **Q-final/3 — canvas: a.** `@xyflow/react` v12.

## Architecture

```
 Browser (xyflow canvas + palette + side panel + run overlay)
   │
   │  HTTP: list/save/load workflows
   │  HTTP: POST /api/run (workflow-id) → 202
   │  WS  /ws : live engine events
   ▼
 server.ts (Next.js + ws)
   ├─ WorkflowStore (filesystem JSON)
   └─ WorkflowEngine (singleton, in-memory current run)
        ├─ Variable scope
        ├─ Node executors (one per node type, in lib/server/nodes/)
        └─ Templating engine (handlebars-lite)
```

**Single Node process, single active run** (matches today). On boot, server.ts hands HTTP to Next.js, attaches `ws` to the same HTTP server, and the engine is a singleton that emits events to the bus.

## Workflow data model

```ts
type Workflow = {
  id: string;            // slug, e.g. "fix-failing-tests"
  name: string;
  version: number;       // bump on save
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
};

type WorkflowNode = {
  id: string;            // unique within workflow, e.g. "claude-1"
  type: NodeType;        // 'start' | 'end' | 'claude' | 'condition' | 'loop' | ...
  position: { x: number; y: number };
  config: Record<string, unknown>;  // shape per node type, see vocabulary below
  // For container nodes (Loop, Parallel, Subworkflow): children live here
  children?: WorkflowNode[];
};

type WorkflowEdge = {
  id: string;
  source: string;        // node id
  sourceHandle: string;  // 'next' | 'met' | 'not_met' | 'error' | <custom>
  target: string;        // node id
  targetHandle?: string; // usually 'in', containers may have multiple
};
```

**Persistence:** `workflows/<id>.json` containing the full `Workflow` object. Atomic write via `<id>.json.tmp` → rename. List by `readdir`.

**Validation on save:** must have exactly one `Start` (top-level), at least one `End` reachable from `Start`, no orphan nodes, no edges to nonexistent nodes, no cycles outside `Loop`/`Parallel` containers (Phase 1: only `Loop` containers may close cycles).

## Variable scope and templating

There is one flat scope per run, keyed by node id. Each node, on completion, writes its result object under its id:

```ts
scope = {
  "claude-1": { stdout: "...", stderr: "...", exitCode: 0, durationMs: 132 },
  "condition-1": { met: true, detail: "matched at 6" },
  ...
};
```

Templating syntax in any text-typed config field: `{{nodeId.field}}` or `{{nodeId.nested.field}}`. Implementation: a tiny handlebars-lite (~30 LOC) — no `eval`, no logic, just key-path lookup. Missing keys render empty string and emit a `template_warning` event. **No** dependency on `handlebars` package; we want hermetic evaluation.

Reserved namespace: `{{run.iteration}}` (current iteration index inside the nearest `Loop`), `{{run.startedAt}}`, `{{run.id}}`. `{{env.NAME}}` is **not** supported in MVP (escape hatch deferred — too easy to leak secrets into prompts).

## Node vocabulary

For each node: declared inputs (other than the implicit incoming control edge), declared outputs (variables it writes), branches (named output handles for control flow), error semantics.

### Phase 1 (MVP)

**Start**
- Config: `{}`. One per workflow, top-level only.
- Outputs: `{}`.
- Branches: `next`.

**End**
- Config: `{ outcome?: 'succeeded' | 'failed' }` (default `'succeeded'`).
- Outputs: `{}`. Reaching End settles the run.
- Branches: none.

**Claude**
- Config: `{ prompt: string; cwd: string; timeoutMs: number }`. Both `prompt` and `cwd` accept templating.
- Reuses `lib/server/claude-runner.ts` (today's implementation).
- Outputs: `{ stdout: string; stderr: string; exitCode: number | null; durationMs: number; timedOut: boolean }`.
- Branches: `next` (if exit 0), `error` (if exit ≠ 0 or timeout). If no `error` edge is wired, an error settles the run as failed.

**Condition**
- Config: `{ kind: 'sentinel' | 'command' | 'judge'; against?: string; sentinel?: SentinelConfig; command?: CommandConfig; judge?: JudgeConfig }`.
- `against` is templating-resolved to the text the strategy evaluates (default `{{<incoming-source>.stdout}}` if not set). Reuses today's strategies from `lib/server/conditions/`.
- Outputs: `{ met: boolean; detail: string }`.
- Branches: `met`, `not_met`, `error`. `error` triggers if the strategy itself errored (e.g., command not found AND no graceful met=false fallback).

**Loop**
- Container node. Holds child nodes (`children: WorkflowNode[]`) and child edges (stored in the parent workflow's edges array, but their endpoints reference child ids).
- Config: `{ maxIterations: number; mode: 'while-not-met' | 'unbounded' }`.
- Implicit child structure: a `LoopStart` and `LoopEnd` are auto-generated; user wires the body between them. `LoopEnd` accepts two incoming branches: `break` (exits the loop with the loop body's last variable scope merged) and `continue` (back-edges to `LoopStart`).
- Outputs (visible to nodes after the Loop): `{ iterations: number; broke: boolean }`.
- Branches: `next`, `error`.

### Phase 2

**Shell**
- Config: `{ cmd: string; cwd?: string; timeoutMs?: number }`. `cmd` and `cwd` templating-resolved.
- Spawn via `child_process.exec` (or `spawn` with `shell: true`). Cwd defaults to the workflow's working dir if unset.
- Outputs: `{ stdout: string; stderr: string; exitCode: number; durationMs: number }`.
- Branches: `next`, `error` (non-zero exit or spawn fail).

**Judge**
- Config: `{ rubric: string; against?: string; model?: string }`. `rubric` and `against` templating-resolved.
- Calls `claude --print` with the judge prompt. Reuses `lib/server/conditions/judge.ts` internals.
- Outputs: `{ met: boolean; detail: string }`.
- Branches: `met`, `not_met`, `error`.

**Branch**
- Generic boolean if/else.
- Config: `{ predicate: string }`. Predicate is a small boolean expression DSL (e.g., `{{shell-1.exitCode}} == 0`, `{{claude-1.stdout}} contains "DONE"`). Expressions: `==`, `!=`, `contains`, `matches` (regex), `&&`, `||`, `!`. No arbitrary JS.
- Branches: `true`, `false`, `error` (predicate parse/eval error).

**SetVar**
- Config: `{ name: string; value: string }`. Both templating-resolved.
- Outputs: writes `{ value: string }` under its node id, AND under the global key `vars.<name>` so other nodes can use `{{vars.foo}}`.
- Branches: `next`.

**Catch**
- Config: `{ scope: 'workflow' | 'subgraph' }`. Workflow-level catches handle any unhandled `error` branch in the run; scoped catches handle errors only from a connected subgraph.
- Special: an inbound `caught` branch is generated automatically and connects to the body that runs on error. The original error is exposed as `{{<catch-id>.error}}` (`{ message, source: nodeId }`).
- Branches: `next` (after handler completes — settles the run if connected to End, or rejoins flow).

### Phase 3

**Parallel** — container; runs N child branches concurrently; rejoins on a barrier; surfaces the worst outcome.
**Subworkflow** — config `{ workflowId: string; inputs?: Record<string, string> }`; runs another workflow as a node, exposing its End-node `outputs` map.
**Wait** — config `{ ms: number }`; sleeps and emits no outputs.
**HTTP** — config `{ method, url, headers?, body? }`; outputs `{ status, body, durationMs }`. URL/body templating-resolved.
**Switch** — multi-way branch on `{{expr}}` value; user labels each output handle with a literal match.

## Execution semantics

### Engine loop

```
state = idle
on start(workflow):
  state = running
  scope = {}; emit run_started
  visit(start node) — single threaded, BFS along control edges
  
visit(node):
  emit node_started(id)
  scope[id] = await node.execute(config_resolved, scope, abortSignal)
  emit node_finished(id, scope[id])
  branch = pick branch port from scope[id]
  for edge in outgoing(node, branch): visit(target(edge))
  
  on error: try to route to nearest reachable Catch via 'caught' edge;
            if none, settle run as failed.
```

Single-threaded for Phase 1/2. `Parallel` (Phase 3) introduces concurrent branches; the engine becomes a job graph with a wait barrier at the rejoin node.

### Cancellation (catch-aware)

`stop()` sets `abortSignal.aborted = true`. The active node observes the signal and kills its child process (Claude / Shell / HTTP).

- **Phase 1 (no `Catch` node yet):** the engine settles the run as `cancelled` immediately after the active node is killed.
- **Phase 2+ (with `Catch`):** the engine routes to any reachable `Catch` of `scope: 'workflow'` and runs its handler subgraph to completion (which itself can't be re-cancelled — a second `stop()` is a hard kill). When the handler finishes, the run settles as `cancelled`.

### Loop container execution

The engine treats a `Loop` node as a synchronous block: enter the body, walk it, when execution reaches `LoopEnd` via `continue`, increment `{{run.iteration}}` and re-enter `LoopStart`; via `break`, exit the loop and continue the parent flow. Variable scope writes inside the loop body are visible after the loop *as the values from the last iteration*. Iteration count enforced against `maxIterations` (default 100).

### Subworkflow execution (Phase 3)

Subworkflow runs as if `Start` of the inner is `Start` of the run, but with a private scope that doesn't leak. The inner's `End` config gains an optional `outputs: Record<string, string>` whose values are templated against the inner scope and exposed to the parent under the Subworkflow node's id.

## Persistence

```
workflows/
  fix-failing-tests.json
  rewrite-readme.json
  ...
```

Each file is the full `Workflow` object. Endpoints:

- `GET /api/workflows` → `{ workflows: Array<{id, name, updatedAt}> }`.
- `GET /api/workflows/:id` → the full `Workflow`.
- `PUT /api/workflows/:id` → save (creates or replaces); validates structure; bumps `version` and `updatedAt`.
- `DELETE /api/workflows/:id` → unlink.
- `POST /api/run` body `{ workflowId: string }` → starts engine on that workflow; 409 if a run is active.
- `POST /api/run/stop` (unchanged behavior).
- `GET /api/run` (unchanged behavior — returns engine state including current node id).

Run history: still in-memory, last run only (Phase 1 keeps current single-task constraint).

## Frontend

### Layout

The current asymmetric "rail + main" layout becomes "left palette + center canvas + right config panel" while a run is being designed. When a run is active, the right panel switches to the live execution view (per-node status overlays on canvas + a running event log).

```
┌────────┬────────────────────────────────────┬─────────────┐
│ palette│            xyflow canvas            │  config /  │
│        │                                      │  live run  │
└────────┴────────────────────────────────────┴─────────────┘
```

The top bar is unchanged (brand, iter counter, runtime, Link/status pills).

### Canvas (`@xyflow/react` v12)

- Each node type registers a custom React component matching the design system (hairline border, mono labels, serif numerals for iteration counts inside the Loop container, condition verdict badges).
- Edges have labels matching their handle (`met` / `not_met` / `error` / `next` / etc.). Edge color follows the destination's accent: green for `met`, rust for `error`, ivory for `next`.
- Container nodes (`Loop`, `Parallel`, `Subworkflow`) render as group sub-canvases (xyflow has built-in subflows).
- During a run, each node displays a state badge (idle / live / succeeded / failed / skipped) with a pulsing dot for live, matching the existing pill system.

### Palette

Left rail. Categories: Control (Start, End, Loop, Branch, Switch, Catch, Parallel), I/O (Claude, Shell, HTTP, Subworkflow), Data (SetVar, Wait), per-phase availability gated.

Drag a node from palette → drops at cursor on canvas. Newly-dropped nodes are auto-id'd (`claude-1`, `claude-2`).

### Config panel

When a node is selected, the right panel shows its config form. Fields use the existing field component (label, hint, hairline-bordered input). Templating-aware text fields show available variables in a dropdown when the user types `{{`.

### Live run view

When a run starts, the right panel switches. Shows:
- Run-level status pill at top.
- Currently executing node's id and elapsed time.
- A scrollable event log of `node_started` / `node_finished` / `template_warning` / `error` events.
- Canvas dims non-current nodes; current node gets the amber pulsing border.

### Workflow management

A small dropdown in the top bar shows the current workflow name; clicking opens a list of saved workflows + "New" + "Duplicate" + "Delete" actions.

## Migration from the existing app

- The current `RunConfig` form-based UI ships as a **preset workflow**: opening the app for the first time loads a default workflow `loop-claude-until-condition.json` (Start → Loop[Claude → Condition] → End). The user can edit it like any other.
- `lib/server/loop-manager.ts` is replaced by `lib/server/workflow-engine.ts`. The existing condition strategies and claude-runner are reused as node executors.
- `app/api/run/route.ts` is rewritten to accept `{ workflowId }` instead of a `RunConfig`. The validation logic is replaced with `workflow.validate()`.
- The existing TaskForm and RunPanel components are deleted; replaced by the canvas + palette + config panel + live run view.
- Existing tests: condition-strategy and claude-runner tests stay (they test reused modules); LoopManager tests are deleted (LoopManager is gone); API route tests are rewritten; new tests added for the engine, templating, each new node executor, and the canvas.
- Spec `2026-04-28-infloop-design.md` stays as historical context but is marked superseded.

## Testing strategy

- **Unit:** templating engine; each node executor (success path + error branch); engine state machine; predicate parser (Phase 2); subworkflow scope isolation (Phase 3).
- **Integration:** run end-to-end workflows against the `fake-claude.sh` fixture for Claude/Judge nodes and shell-based fixtures for Shell. Cover: linear, branching, loop-until-met, error → catch → recovery, manual stop → catch handler.
- **Frontend:** drag-from-palette adds a node; connecting two nodes creates an edge with the correct sourceHandle; node config panel writes back to the workflow; canvas state survives reload.
- **Manual smoke (post-merge):** load the migrated default workflow, run it against fake-claude, verify it succeeds; build a 2-step branching workflow (Claude → Condition → Loop back / End) and run it; click Stop mid-run and verify a Catch handler runs to completion.

## Phased rollout

**Phase 1 (MVP, ~10 worker units)** — biggest single milestone. Ship before Phase 2. After Phase 1 the app supports linear and `Loop`-cycled workflows whose only branching is the `Condition` node's `met` / `not_met` ports; full branching (`Branch`, `Switch`) and side-step nodes (`Shell`, `Judge`, `SetVar`, `Catch`) arrive in Phase 2.

| # | Worker unit | Files owned (rough) |
|---|---|---|
| 1 | Workflow types + validator | `lib/shared/workflow.ts`, validator + tests |
| 2 | Templating engine | `lib/server/templating.ts` + tests |
| 3 | Workflow store (filesystem) | `lib/server/workflow-store.ts` + tests |
| 4 | Workflow engine (BFS walker, no parallel) | `lib/server/workflow-engine.ts` + tests |
| 5 | Node executors: Start, End, Claude, Condition, Loop | `lib/server/nodes/*.ts` + tests |
| 6 | API routes (workflows CRUD + run/stop) | `app/api/workflows/**`, `app/api/run/**` + tests |
| 7 | xyflow canvas + custom node components | `app/components/canvas/**` + tests |
| 8 | Palette + drag-to-add | `app/components/Palette.tsx` + tests |
| 9 | Config panel + templating dropdown | `app/components/ConfigPanel.tsx` + tests |
| 10 | Live run view + page assembly | `app/components/RunView.tsx`, `app/page.tsx` + tests |

**Phase 2 (~6 worker units):** Shell, Judge, Branch, SetVar, Catch executors; predicate parser; cancellation-with-catch wiring; UI palette categories.

**Phase 3 (~6 worker units):** Parallel container + barrier scheduler; Subworkflow execution + scope isolation; Wait/HTTP/Switch executors; UI sub-canvas + multi-way switch UI.

Each phase: Phase A foundation (scaffold + immutable contracts + stubs) followed by parallel-worker batch, exactly like the original Phase A/B model.

## Verification (Phase 1 acceptance)

- `bun run test` — all engine, templating, store, node executor, and route tests pass.
- `bun run typecheck` — clean.
- `bun run dev` boots; canvas loads; palette renders; you can:
  1. Open the migrated default workflow `loop-claude-until-condition.json`.
  2. Run it against `INFLOOP_CLAUDE_BIN=tests/fixtures/fake-claude.sh` with `FAKE_STDOUT_LINES="hello\nDONE"`. Final run status `succeeded`. Loop iteration node updated live.
  3. Drag a new `Claude` node from the palette, configure its prompt with `{{claude-1.stdout}}`, wire it after the existing Claude. Save. Run. Verify the second Claude's prompt was templated correctly (visible in the live run log).
  4. Click Stop mid-run. Verify the run settles as `cancelled` (no Catch yet in Phase 1; just clean cancellation).
- All workflows persist to `workflows/*.json` and survive a server restart.
