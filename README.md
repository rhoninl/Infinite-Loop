<h1 align="center">InfLoop</h1>

<p align="center">
  <em>A visual workflow editor that drives Claude Code in a loop until your condition is met.</em>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> •
  <a href="#nodes">Nodes</a> •
  <a href="#how-it-works">How it works</a> •
  <a href="#workflow-files">Workflow files</a> •
  <a href="#tech-stack">Tech stack</a> •
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-fbf0df" alt="Bun">
  <img src="https://img.shields.io/badge/Next.js-15-black" alt="Next.js 15">
  <img src="https://img.shields.io/badge/React-19-149eca" alt="React 19">
  <img src="https://img.shields.io/badge/canvas-%40xyflow%2Freact-ff0072" alt="xyflow">
  <img src="https://img.shields.io/badge/transport-SSE-2d2d2d" alt="SSE">
</p>

<p align="center">
  <img src="docs/images/console-running.png" alt="InfLoop console mid-run — palette, canvas, and live streaming claude output" width="100%">
</p>

---

## Why?

`claude --print "<prompt>"` is one-shot. Real automations want to **loop until something is true**, **branch on the output**, **check the filesystem**, or **run another `claude` to judge the answer**. Wiring those flows from a shell script is painful and opaque.

**InfLoop** is a local web app that gives you a node canvas to drag those flows into shape, then drives Claude Code (`claude --print`) according to the graph — streaming tokens live to the page as the model generates.

It's the difference between *one Claude call* and *a Claude pipeline you can rerun, edit, and watch in real time*.

## Features

- 🎨 **Drag-and-drop canvas** — composable workflows with `@xyflow/react`. Drag containers, resize them, click an inner node and edit its config. Right-click an empty area to add a node; `Cmd/Ctrl+Z` undoes edits.
- ↻ **Built-in `Loop` container** — repeat a body until a `Condition` says stop, with a max-iteration cap. The default workflow ships as Start → Loop[Claude → Condition[sentinel "DONE"]] → End.
- ⋔ **Branch / If-Else** — structured `lhs op rhs` predicates (`==`, `!=`, `contains`, `matches`) with templating in both sides. Routes to `true` / `false` / `error` ports.
- ⟳ **Three Condition kinds** — `sentinel` (text match in stdout), `command` (shell exit 0), `judge` (a second Claude call that reads the output and decides).
- 🧩 **Multi-agent primitives** — `Parallel` fans children out (`wait-all` / `race` / `quorum`), `Subworkflow` calls another workflow as a single node with declared `inputs`/`outputs`, `Judge` picks a winner from N candidates with structured scoring.
- 🐚 **Script node** — drop in TypeScript (run via Bun) or Python and read upstream outputs through a typed `inputs` object; the return value is stored under `script-N.result`.
- 🔌 **Pluggable agent runners** — each agent node picks a provider from `providers/*.json` (Claude, Codex, or a custom HTTP runner like Hermes). The provider declares the binary, args template, and output parser.
- 📡 **Real-time token streaming** — every token from the active runner lands in the right-side console as it's generated. For Claude: `--output-format stream-json --include-partial-messages` parsed live.
- 🕘 **Run history** — completed runs are persisted under `runs/<workflowId>/<runId>/`; the History panel lists them, replays per-node input/output cards, and links each card back to its node on the canvas.
- 🔁 **Refresh-safe** — close the tab and reopen mid-run; the engine keeps a sliding-window event buffer, the SSE first frame rehydrates the run status, the live-node highlight, and the streaming log.
- 📝 **Templating in any text field** — `{{node-id.field}}` resolves against a flat scope keyed by node id, with autocomplete in the config panel. `__inputs.*` is reserved for subworkflow inputs.
- 💾 **Workflows are JSON files** — saved under `workflows/<id>.json`, atomically written, version-bumped on each save, listable from a top-bar menu.
- 🛂 **Cancellation** — Stop kills the active child process via `SIGTERM` → `SIGKILL` after a 2 s grace, settles the run as `cancelled`.
- 🎛️ **Resizable right panel + smooth elapsed timer** — column-resize gutter, persisted to localStorage; elapsed counter updates every animation frame.

## Demo

The screenshot at the top shows a real run mid-flight: the palette on
the left, the workflow on the canvas (Start → Loop[Claude] → End), and
the right-side run view streaming claude's output line-by-line as the
model generates. The status pill flips through `idle → running →
succeeded / failed / cancelled`; the `LIVE` tag on the active node
pulses; the elapsed timer ticks every animation frame.

The same trace as plain text:

```
run_started     Loop Claude until condition
node_started    start-1
node_finished   start-1 → next
node_started    loop-1
node_started    claude-1
claude-1 │ Already logged in. Let me test the
claude-1 │ other pages for frontend issues first.
claude-1 │ All frontend pages render cleanly. Now
claude-1 │ let me SSH to the edge node and check USB devices…
node_finished   claude-1 → next
node_started    cond-1
condition_checked  cond-1 met:Y matched at index 6
node_finished   cond-1 → met
node_started    end-1
node_finished   end-1 → next
run_finished    succeeded
```

## Quickstart

**Requirements:** [Bun](https://bun.sh) ≥ 1.3 and the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) on your `PATH` (or set `INFLOOP_CLAUDE_BIN`).

```bash
git clone https://github.com/rhoninl/Infinite-Loop.git
cd Infinite-Loop
bun install
bun run dev
```

Open `http://localhost:3000`.

The default workflow `loop-claude-until-condition.json` loads automatically. Edit the inner `Claude` node's prompt and `cwd`, then click **Run** in the top bar. The right-side console fills with streaming tokens as the model generates.

### Other commands

```bash
bun run test        # bun:test
bun run typecheck   # tsc --noEmit
bun run build       # next build (production)
bun run start       # NODE_ENV=production bun server.ts
```

The dev server binds to all interfaces by default (LAN-accessible). If `PORT` is taken, it falls through to the next free port.

## Nodes

| Node | Config | Outputs (scope) | Branches |
|---|---|---|---|
| **Start** | — | — | `next` |
| **End** | `outcome: succeeded \| failed` | — | (terminal) |
| **Claude / Agent** | `prompt`, `cwd`, `timeoutMs`, `providerId` | `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut` | `next` (exit 0) / `error` |
| **Script** | `language: ts \| py`, `code`, `inputs: Record<string,string>` (templated), `timeoutMs` | `result` (return value), `stdout`, `stderr`, `durationMs` | `next` / `error` |
| **Condition** | `kind: sentinel \| command \| judge`, `against?`, plus per-kind config | `met`, `detail` | `met` / `not_met` / `error` |
| **Loop** | `maxIterations`, `mode: while-not-met \| unbounded` | `iterations`, `broke` | `next` |
| **Branch** | `lhs`, `op: == \| != \| contains \| matches`, `rhs` | `result`, `lhs`, `rhs`, `op` | `true` / `false` / `error` |
| **Parallel** | `mode: wait-all \| race \| quorum`, `quorumN?`, `onError: fail-fast \| best-effort` | `mode`, `completed`, `failed`, `children: { [branchId]: { status, outputs, error? } }`, `winner?`, `winners?` | `all_done` / `first_done` / `quorum_met` / `error` |
| **Subworkflow** | `workflowId`, `inputs: Record<string,string>` (templated), `outputs: Record<string,string>` (dotted child paths) | declared output names mapped from child terminal scope, plus `status`, `errorMessage?` | `next` / `error` |
| **Judge** | `criteria`, `candidates: string[]`, `judgePrompt?`, `model?`, `providerId?` | `winner_index`, `winner`, `scores`, `reasoning` | `next` / `error` |

Both `lhs` and `rhs` of a Branch (and an Agent's `prompt` and `cwd`, Condition's `against`, and a Script's `inputs.*`) are templating-aware. Write `{{claude-1.stdout}} contains "DONE"` and the engine resolves it against the run's flat scope before evaluating. The config-panel text fields autocomplete `{{…}}` references from the workflow's predecessor graph.

**Multi-agent primitives.** `Parallel` is a container that runs N child branches concurrently with a configurable join (`wait-all`, `race`, or `quorum:N`) and error policy (`fail-fast` cancels siblings; `best-effort` lets them finish). `Subworkflow` calls another workflow as a single node with isolated I/O — declared `inputs` are templated from parent scope into the child's `__inputs`, and named `outputs` are copied back. `Judge` takes N candidate texts and asks a Claude judge to pick the best, exposing structured `winner_index`, `scores`, and `reasoning`.

### Sentinel vs Command vs Judge

| Kind | Best for | Cost |
|---|---|---|
| **sentinel** | Claude reliably emits a marker token (`DONE`, `PASS`) | Free, instant |
| **command** | Ground-truth check on disk: `test -f hello.txt`, `pytest -q`, `tsc --noEmit` | One subprocess per iteration |
| **judge** | Qualitative goals: "is the README complete?", "did the explanation match the user's level?" | A second `claude --print` per iteration |

## How it works

```
 Browser
   ├─ canvas (xyflow)  ◀──── /api/workflows/<id>   (loads from JSON)
   ├─ palette (drag)
   ├─ config panel (debounced edits → updateNode)
   └─ run view (SSE consumer)
                            ▲
                            │ HTTP (start/stop/save) and Server-Sent Events
                            ▼
 Bun + Next.js (server.ts)
   ├─ /api/workflows         CRUD against workflows/*.json
   ├─ /api/run               POST → workflowEngine.start(wf)
   ├─ /api/run/stop          POST → workflowEngine.stop()
   └─ /api/events            text/event-stream → eventBus → live frames
                            │
                            ▼
 WorkflowEngine (singleton)
   ├─ BFS walker, built-in Loop semantics, AbortController for stop
   ├─ Per-node executor → spawn(claude --print --output-format stream-json …)
   ├─ Templating resolver: {{node-id.field}} over flat scope
   └─ Sliding-window event buffer (2000 events) for refresh hydration
```

**Why SSE, not WebSockets?** Native HTML/JSON, one-way (engine → browser), bun-friendly, no upgrade dance, no `ws` package, no compat shims. Stop and save go through normal `fetch` calls in the other direction.

**Why Bun?** Native TypeScript + ESM execution (no `tsx` shim), faster cold start than `node`, single binary.

## Workflow files

Each workflow is one JSON file in `workflows/`:

```jsonc
{
  "id": "loop-claude-until-condition",
  "name": "Loop Claude until condition",
  "version": 1,
  "createdAt": 1777359000000,
  "updatedAt": 1777359000000,
  "nodes": [
    { "id": "start-1", "type": "start", "position": { "x": 80, "y": 200 }, "config": {} },
    {
      "id": "loop-1",
      "type": "loop",
      "position": { "x": 280, "y": 120 },
      "config": { "maxIterations": 5, "mode": "while-not-met" },
      "children": [
        { "id": "claude-1", "type": "claude", "position": { "x": 40, "y": 60 },
          "config": { "prompt": "…", "cwd": "/tmp", "timeoutMs": 60000 } },
        { "id": "cond-1", "type": "condition", "position": { "x": 320, "y": 60 },
          "config": { "kind": "sentinel", "against": "{{claude-1.stdout}}",
                      "sentinel": { "pattern": "DONE", "isRegex": false } } }
      ]
    },
    { "id": "end-1", "type": "end", "position": { "x": 760, "y": 200 },
      "config": { "outcome": "succeeded" } }
  ],
  "edges": [
    { "id": "e1", "source": "start-1", "sourceHandle": "next", "target": "loop-1" },
    { "id": "e2", "source": "loop-1",  "sourceHandle": "next", "target": "end-1" },
    { "id": "e3", "source": "claude-1","sourceHandle": "next", "target": "cond-1" }
  ]
}
```

Edit by hand, drop in `workflows/`, refresh the page — the menu picks it up. Save from the top-bar menu to validate + bump version + atomic-rename.

### Workflow library

`workflows/library/` holds read-only repo-shipped presets. They appear in the workflow menu with a `[library]` tag and can be opened, run, or duplicated into your local `workflows/` for editing — but never overwritten in place.

The `Team` preset fans three Claudes out in parallel and lets a Judge pick the winner. Open it from the workflow menu, set the `__inputs.task` and `__inputs.criteria`, and run.

## Configuration

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` (then next free) | HTTP port |
| `HOST` | `0.0.0.0` | Bind address; set to `127.0.0.1` to disable LAN access |
| `INFLOOP_CLAUDE_BIN` | `claude` | Path to the Claude binary; useful for testing with the bundled `tests/fixtures/fake-claude.sh` |
| `INFLOOP_PYTHON_BIN` | `python3` | Interpreter for `Script` nodes with `language: py` |
| `INFLOOP_BUN_BIN` | `bun` | Interpreter for `Script` nodes with `language: ts` |
| `INFLOOP_WORKFLOWS_DIR` | `<cwd>/workflows` | Where workflow JSON files live |
| `INFLOOP_RUNS_DIR` | `<cwd>/runs` | Where completed-run records are persisted |

### Providers

Each agent node picks a runner from `providers/*.json`. A provider declares
how to spawn an external CLI (`bin`, `args`, `promptVia`) or an HTTP endpoint
(`host`, `token`, `ports`), and which output format the engine should parse
(`claude-stream-json` for token-by-token streaming, `plain` for end-of-process
stdout). Drop a new JSON file in to add a runner; the palette shows its
brand mark and the agent's config panel exposes it as a selectable provider.

## Triggering workflows from agents (MCP)

InfLoop ships a small MCP server that exposes each saved workflow as its
own tool, with input schema derived from the workflow's declared
`inputs[]`. Any MCP-speaking client (Claude Code, Cursor, Cline, …) can
discover and invoke InfLoop workflows by name.

The server lives in `mcp/inflooop-mcp/`. It is a long-lived stdio process
spawned by the MCP client; it talks to a running InfLoop over HTTP.

### Install in Claude Code

```bash
claude mcp add inflooop -- bun run /absolute/path/to/InfLoop/mcp/inflooop-mcp/index.ts
```

For other MCP clients, the equivalent `mcpServers` block:

```json
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
```

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `INFLOOP_BASE_URL` | `http://localhost:3000` | Where InfLoop is reachable. |
| `INFLOOP_API_TOKEN` | unset | If set, forwarded as `Authorization: Bearer …` on every call. Must match the InfLoop server's `INFLOOP_API_TOKEN`. |
| `INFLOOP_TOOL_TIMEOUT_MS` | `600000` | How long a per-workflow tool call waits before returning a timeout result with the `runId`. |
| `INFLOOP_POLL_INTERVAL_MS` | `500` | Base polling cadence (jittered ±20%). |

> **Note.** Setting `INFLOOP_API_TOKEN` on the InfLoop server protects
> the HTTP API against off-host callers but **disables the browser
> UI** for that server (the UI doesn't forward the token, and the SSE
> stream isn't auth-gated). Use this only when the UI doesn't need to
> work — e.g. an InfLoop instance that exists purely to back the MCP
> server.

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

## Tech stack

- **Runtime:** Bun
- **Server:** Next.js 15 (App Router) + custom server (`server.ts`)
- **Frontend:** React 19, Zustand for state, `@xyflow/react` v12 for the canvas, hand-written CSS with multi-hue Tokyo-Night-inspired tokens
- **Transport:** Server-Sent Events (`/api/events`)
- **Runners:** pluggable providers (subprocess via spawn, or HTTP — see `providers/`)
- **Tests:** `bun:test`, `@testing-library/react`, `@happy-dom/global-registrator`

## Roadmap

The current build ships **Phase 1** of the spec — 6 base node types (Start, End, Claude, Condition, Loop, Branch) and the live SSE pipeline — plus the Phase 1.5 multi-agent primitives. Future phases:

- **Phase 1.5:** `Parallel`, `Subworkflow`, and `Judge` are first-class node types; ships with a Team preset workflow. See [`docs/superpowers/specs/2026-05-06-multi-agent-orchestration-design.md`](docs/superpowers/specs/2026-05-06-multi-agent-orchestration-design.md).
- **Phase 2 (in progress):** `Script` (TS/Python) and pluggable HTTP providers have landed. Still on deck: `Shell` (run arbitrary command), `SetVar` (write a named variable), `Catch` (run a subgraph on error before settling), predicate DSL with `&&` / `||` / `!`.
- **Phase 3:** `Wait`, `HTTP` node, `Switch` (multi-way).

Recent UI work — run history persistence, per-node input/output cards, and a canvas ↔ history-log link — is documented in [`docs/superpowers/specs/2026-05-12-canvas-history-link-design.md`](docs/superpowers/specs/2026-05-12-canvas-history-link-design.md).

See [`docs/superpowers/specs/2026-04-28-workflow-dag-design.md`](docs/superpowers/specs/2026-04-28-workflow-dag-design.md) for the full design.

## Project layout

```
app/
  api/                  Next.js route handlers (workflows CRUD, run, events SSE)
  components/
    canvas/             xyflow wrapper + custom node UIs
    Palette.tsx         draggable node-type list
    ConfigPanel.tsx     per-node-type config form (templating-aware)
    RunView.tsx         live event log + status pill + elapsed timer
    WorkflowMenu.tsx    top-bar dropdown: list / new / duplicate / save / delete
  page.tsx              top bar + tri-pane layout (palette · canvas · right-panel)
lib/
  shared/workflow.ts    immutable types contract (Workflow, WorkflowNode, ...)
  shared/template-refs  template-ref linting + scope graph
  client/               Zustand store + SSE hook + undo/redo
  server/
    workflow-engine.ts  graph walker + Loop semantics + cancellation
    workflow-store.ts   filesystem-backed Workflow CRUD
    run-store.ts        persists completed runs under runs/
    claude-runner.ts    spawns `claude --print`, parses stream-json
    event-bus.ts        typed pub/sub
    nodes/              one executor per node type (agent, script, branch, …)
    conditions/         sentinel / command / judge strategies
    providers/          loads and validates providers/*.json runner specs
providers/              runner specs (Claude, Codex, Hermes, …) — drop a JSON file to add one
runs/                   persisted run records, one folder per workflow
docs/
  superpowers/specs/    design specs (this repo's history is in here)
workflows/              the workflow JSON store (live data, gitignored on real installs)
```

## Contributing

Issues and PRs welcome. The codebase is small; start by reading the spec at `docs/superpowers/specs/2026-04-28-workflow-dag-design.md` and the engine at `lib/server/workflow-engine.ts`.

## License

Specify a license here (e.g. MIT) once you've decided.
