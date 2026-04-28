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

- 🎨 **Drag-and-drop canvas** — composable workflows with `@xyflow/react`. Drag containers, resize them, click an inner node and edit its config.
- ↻ **Built-in `Loop` container** — repeat a body until a `Condition` says stop, with a max-iteration cap. The default workflow ships as Start → Loop[Claude → Condition[sentinel "DONE"]] → End.
- ⋔ **Branch / If-Else** — structured `lhs op rhs` predicates (`==`, `!=`, `contains`, `matches`) with templating in both sides. Routes to `true` / `false` / `error` ports.
- ⟳ **Three Condition kinds** — `sentinel` (text match in stdout), `command` (shell exit 0), `judge` (a second Claude call that reads the output and decides).
- 📡 **Real-time token streaming** — every token from `claude --print` lands in the right-side console as it's generated. Spawns claude with `--output-format stream-json --include-partial-messages` and parses text deltas live.
- 🔁 **Refresh-safe** — close the tab and reopen mid-run; the engine keeps a sliding-window event buffer, the SSE first frame rehydrates the run status, the live-node highlight, and the streaming log.
- 📝 **Templating in any text field** — `{{node-id.field}}` resolves against a flat scope keyed by node id, so a downstream Claude can read the upstream Claude's stdout.
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
bun run test        # vitest run (currently 131 tests)
bun run typecheck   # tsc --noEmit
bun run build       # next build (production)
bun run start       # NODE_ENV=production bun server.ts
```

## Nodes

| Node | Config | Outputs (scope) | Branches |
|---|---|---|---|
| **Start** | — | — | `next` |
| **End** | `outcome: succeeded \| failed` | — | (terminal) |
| **Claude** | `prompt`, `cwd`, `timeoutMs` | `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut` | `next` (exit 0) / `error` |
| **Condition** | `kind: sentinel \| command \| judge`, `against?`, plus per-kind config | `met`, `detail` | `met` / `not_met` / `error` |
| **Loop** | `maxIterations`, `mode: while-not-met \| unbounded` | `iterations`, `broke` | `next` |
| **Branch** | `lhs`, `op: == \| != \| contains \| matches`, `rhs` | `result`, `lhs`, `rhs`, `op` | `true` / `false` / `error` |

Both `lhs` and `rhs` of a Branch (and Claude's `prompt` and `cwd`, and Condition's `against`) are templating-aware. Write `{{claude-1.stdout}} contains "DONE"` and the engine resolves it against the run's flat scope before evaluating.

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

## Configuration

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `INFLOOP_CLAUDE_BIN` | `claude` | Path to the Claude binary; useful for testing with the bundled `tests/fixtures/fake-claude.sh` |
| `INFLOOP_WORKFLOWS_DIR` | `<cwd>/workflows` | Where workflow JSON files live |

## Tech stack

- **Runtime:** Bun
- **Server:** Next.js 15 (App Router) + custom server (`server.ts`)
- **Frontend:** React 19, Zustand for state, `@xyflow/react` v12 for the canvas, hand-written CSS (no Tailwind)
- **Transport:** Server-Sent Events (`/api/events`)
- **Tests:** Vitest, `@testing-library/react`, jsdom

## Roadmap

The current build ships **Phase 1** of the spec: 6 node types (Start, End, Claude, Condition, Loop, Branch) and the live SSE pipeline. Future phases:

- **Phase 2:** `Shell` (run arbitrary command), `Judge` as its own node type, `SetVar` (write a named variable), `Catch` (run a subgraph on error before settling), predicate DSL with `&&` / `||` / `!`.
- **Phase 3:** `Parallel` (fan-out/fan-in), `Subworkflow` (call another workflow as a node), `Wait`, `HTTP`, `Switch` (multi-way).

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
  client/               Zustand store + SSE hook
  server/
    workflow-engine.ts  graph walker + Loop semantics + cancellation
    workflow-store.ts   filesystem-backed Workflow CRUD
    claude-runner.ts    spawns `claude --print`, parses stream-json
    event-bus.ts        typed pub/sub
    nodes/              one executor per node type
    conditions/         sentinel / command / judge strategies
docs/
  superpowers/specs/    design specs (this repo's history is in here)
workflows/              the workflow JSON store (live data, gitignored on real installs)
```

## Contributing

Issues and PRs welcome. The codebase is small; start by reading the spec at `docs/superpowers/specs/2026-04-28-workflow-dag-design.md` and the engine at `lib/server/workflow-engine.ts`.

## License

Specify a license here (e.g. MIT) once you've decided.
