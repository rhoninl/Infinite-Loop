<h1 align="center">InfLoop</h1>

<p align="center">
  <em>Turn Claude Code from a single answer into a pipeline you can see, replay, and trust.</em>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> •
  <a href="#what-you-can-build">What you can build</a> •
  <a href="#nodes">Nodes</a> •
  <a href="#trigger-from-anywhere">Triggers</a> •
  <a href="#configuration">Configuration</a> •
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
  <img src="docs/images/console-running.png" alt="InfLoop console mid-run — palette, canvas, and live streaming agent output" width="100%">
</p>

---

## Why InfLoop

`claude --print "<prompt>"` gives you one answer. Real work usually wants more:

- **Loop** until the model says it's done.
- **Branch** on what the output looks like.
- **Check** the filesystem, run tests, or let *another* model grade the answer.
- **Fan out** to several agents and pick the best result.

Wiring that into a shell script is painful and disappears the moment it runs — you can't see what's happening, can't rerun a single step, and can't share the flow with anyone else.

**InfLoop is a local app that turns those flows into something you can draw.** Drag nodes onto a canvas, connect them, hit Run, and watch every token stream into the console as it's generated. Workflows are plain JSON files you can version, share, and trigger from agents or webhooks.

It's the difference between *one Claude call* and *a Claude pipeline you can edit, rerun, and watch in real time*.

## What you can build

- **Iterate until the test passes.** Loop an agent over a codebase until `pytest -q` exits 0 — InfLoop checks the exit code each round and stops as soon as ground truth says done.
- **Multi-agent debate.** Fan three different prompts (idiomatic, contrarian, conservative) out to Claude in parallel, then let a Judge node read all three and pick the winner with structured reasoning. The shipped `Team` preset does exactly this.
- **Self-grading content.** Let one agent draft, a second agent grade it against a rubric, and loop until the grade is high enough.
- **GitHub-driven automations.** Open a PR, have InfLoop run a review workflow, post a comment back. Triggers fire from any webhook.
- **Agent-on-agent.** Expose your workflow as an MCP tool so Claude Code, Cursor, Cline, or Zed can call it by name — they get tool discovery for free.

## Highlights

- 🎨 **A canvas for your prompts** — drag, drop, resize, and wire nodes together. Edit any node's config inline. `Cmd/Ctrl+Z` to undo, `Cmd/Ctrl+Shift+Z` to redo.
- ↻ **Loop until done** — repeat a body until a condition is met, capped by max iterations (or genuinely unbounded if you opt in). Conditions can match a sentinel string, a shell exit code, or a second model's judgment.
- ⋔ **Branch on real signals** — structured `lhs op rhs` predicates with `==`, `!=`, `contains`, `matches`, templated on both sides.
- 🧩 **Multi-agent, out of the box** — `Parallel` fans work out (`wait-all` / `race` / `quorum:N`) with a configurable error policy. `Subworkflow` calls another workflow as a single step with isolated inputs and outputs. `Judge` picks a winner from N candidates with structured scoring.
- 🐚 **TypeScript or Python in-line** — `Script` nodes execute against upstream outputs and feed their return value back into the graph. Bun runs TS, `python3` runs Py.
- 🔌 **Bring your own agent runner** — Claude, Codex, or any HTTP service (Hermes, your own backend). Add a JSON manifest to `providers/` and it shows up in the palette.
- 📡 **See it as it happens** — every token from the active agent streams to the console live. A live-node highlight, status pill, and elapsed timer update at animation-frame cadence.
- 🕘 **Replay any run** — every completed run is saved with per-node inputs and outputs you can scrub through, each card linked back to its node on the canvas.
- 🔁 **Refresh-safe** — close the tab mid-run and reopen; InfLoop rehydrates the live state and resumes the stream.
- 📝 **Templates everywhere** — `{{node-id.field}}` works in any text field, with autocomplete from the upstream graph. Reserved scopes: `{{__inputs.*}}` for run inputs, `{{globals.*}}` for workflow-level constants.
- 🛰 **MCP-native** — every saved workflow is also an MCP tool. One URL, no client install.
- 🪝 **Webhook triggers** — visual Dispatch view to wire up GitHub, Stripe, or any JSON POST, with a test-fire panel for debugging.
- 🛂 **Cancel cleanly** — Stop signals the active child with `SIGTERM`, escalates to `SIGKILL` after a 2 s grace, and settles the run as `cancelled`.

## See it run

The screenshot at the top is a real run mid-flight: palette on the left, the workflow on the canvas, and the right-side run view streaming the agent's output line-by-line as the model generates. The same trace as plain text:

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

Open `http://localhost:3000`. A starter workflow loads automatically — edit any agent node's prompt and `cwd`, then click **Run** in the top bar. The right panel fills with streaming tokens as the model generates.

### Other commands

```bash
bun run test        # bun:test
bun run typecheck   # tsc --noEmit
bun run build       # next build (production)
bun run start       # NODE_ENV=production bun server.ts
```

The dev server binds to all interfaces by default (LAN-accessible). If `PORT` is taken, InfLoop walks forward to the next free port automatically. Set `HOST=127.0.0.1` to keep it loopback-only.

## Nodes

| Node | What it does | Outputs in scope | Branches |
|---|---|---|---|
| **Start** | Entry point. Holds the workflow's input declarations. | — | `next` |
| **End** | Settles the run as `succeeded` or `failed`. | — | (terminal) |
| **Agent** | Runs an agent through any provider — Claude, Codex, Hermes, your own. | `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut` | `next` (exit 0) / `error` |
| **Script** | Inline TypeScript (Bun) or Python (`python3`). Reads typed named inputs; the function's return value is stored as `result`. | `result`, `stdout`, `stderr`, `durationMs` | `next` / `error` |
| **Condition** | Decides whether to continue. Three kinds: `sentinel`, `command`, `judge`. | `met`, `detail` | `met` / `not_met` / `error` |
| **Loop** | Repeats its body until a `Condition` says stop. Capped by `maxIterations` (or genuinely unbounded with `infinite: true`). | `iterations`, `broke` | `next` |
| **Branch** | Structured `lhs op rhs` predicate (`==`, `!=`, `contains`, `matches`) on templated values. | `result`, `lhs`, `rhs`, `op` | `true` / `false` / `error` |
| **Parallel** | Runs N children concurrently. Join modes: `wait-all`, `race`, `quorum`. Error policy: `fail-fast` or `best-effort`. | `mode`, `completed`, `failed`, `children`, `winner?`, `winners?` | `all_done` / `first_done` / `quorum_met` / `error` |
| **Subworkflow** | Calls another workflow as a single step with isolated I/O. Inputs are templated in; named outputs are copied back. | declared output names, plus `status`, `errorMessage?` | `next` / `error` |
| **Judge** | Reads N candidate texts and lets a model pick a winner with structured scoring. | `winner_index`, `winner`, `scores`, `reasoning` | `next` / `error` |
| **Sidenote** | A free-form sticky note on the canvas. No effect at runtime. | — | — |

Every text field — an Agent's `prompt` and `cwd`, a Condition's `against`, a Branch's `lhs`/`rhs`, a Script's `inputs.*`, a Subworkflow's `inputs.*` — supports `{{node-id.field}}` templating, resolved against the run's flat scope before the node executes. The config panel autocompletes references from the upstream graph.

### Conditions: sentinel vs command vs judge

| Kind | Best for | Cost |
|---|---|---|
| **sentinel** | The agent reliably emits a marker (`DONE`, `PASS`) when it's finished | Free, instant |
| **command** | Ground-truth checks on disk — `test -f hello.txt`, `pytest -q`, `tsc --noEmit` | One subprocess per iteration |
| **judge** | Qualitative goals — "is the README clear?", "did the answer match the user's level?" | One extra agent call per iteration |

## Trigger from anywhere

InfLoop workflows can be started three ways: from the canvas Run button, from an MCP client, or from a webhook.

### From the canvas

Click **Run** in the top bar. If the workflow declares inputs (on the Start node), a modal opens to collect them.

### From an MCP client

Every saved workflow is exposed as an MCP tool via Streamable HTTP at `POST /api/mcp`. Input schema is derived from the workflow's declared inputs. Any MCP-speaking client — Claude Code, Cursor, Cline, Zed, Continue.dev, OpenAI Codex CLI — can discover and invoke InfLoop workflows by name.

**Workflow discovery is per-call**, so a workflow you save right now is visible on the very next `tools/list`. No restart, no client redeploy.

The contract is just two things — a **URL** and (optionally) a **bearer token**:

| Field | Value |
|---|---|
| **url** | `http://localhost:3000/api/mcp` (or wherever InfLoop runs) |
| **auth** | `Authorization: Bearer <INFLOOP_API_TOKEN>` — required only when `INFLOOP_API_TOKEN` is set on the server |

**Claude Code:**

```bash
claude mcp add --transport http inflooop http://localhost:3000/api/mcp
```

(The exact transport flag may vary across Claude Code versions; try `--transport streamable-http` if the above doesn't work. Run `claude mcp add --help` to see what your version accepts.)

Then `/mcp` in any session, or just ask "what inflooop tools do you have?".

**Cursor, Cline, Zed, Continue.dev, OpenAI Codex CLI** — open your client's MCP config and add:

```json
{
  "mcpServers": {
    "inflooop": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

That's the whole entry. No `command`, no `args`, no local runtime to install on the client.

**Hermes or any runtime that accepts an MCP URL:**

```yaml
mcp_servers:
  inflooop:
    url: http://localhost:3000/api/mcp
```

#### Authenticating

If `INFLOOP_API_TOKEN` is set on the server, clients must send the token on every request. Most clients accept a `headers` map:

```json
{
  "mcpServers": {
    "inflooop": {
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

> **Note.** Setting `INFLOOP_API_TOKEN` protects the HTTP API against off-host callers but **disables the browser UI** for that server (the UI doesn't forward the token). Use this for InfLoop instances that exist purely to serve agent traffic.

#### Tools exposed

- **One tool per workflow** — named after the workflow id (sanitized to `[a-z0-9_]`), with inputs derived from the workflow's `inputs[]`. The call **enqueues** a run (non-blocking) and returns `{ queueId, position }`. Poll with `inflooop_get_run_status` using the `queueId`.
- **`inflooop_get_run_status({ workflowId?, runId?, queueId? })`** — fetch status and outputs for a run. Use `queueId` to track a call returned by a workflow tool: it transitions `queued → started` and exposes `runId` once it starts.
- **`inflooop_list_runs({ workflowId? })`** — list recent runs.
- **`inflooop_cancel_run({ workflowId, runId })`** — cancel the active run if its id matches.
- **`inflooop_list_queue()`** — list pending workflow runs in queue order.
- **`inflooop_remove_from_queue({ queueId })`** — drop a queued run before it starts.

#### Verify without an MCP client

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

You'll see one tool per saved workflow plus the five `inflooop_*` utility tools.

#### Concurrency

The engine runs **one workflow at a time**. Additional MCP calls and webhook hits queue in FIFO order (cap 100); the UI shows a queue badge and a `/queue` page where you can cancel individual queued items.

### From a webhook

Open the **Dispatch** view (top-bar button, next to the workflow menu) to create, edit, and test webhook triggers visually. Each trigger gets a unique URL. When an HTTP POST hits it, InfLoop matches the trigger's predicates against the request, queues a workflow run with templated inputs, and returns `202 { queued, queueId, position }`.

**Creating a trigger:**

1. **Dispatch → + New trigger**.
2. Name it and pick the target workflow.
3. Pick a **plugin** that describes the webhook source:
   - **Generic** — any JSON POST. Predicates and input mappings are free-form `{{body.x.y.z}}` template strings.
   - **GitHub** — declares `push`, `issues`, `issue_comment`, and `pull_request` events; the form's field-picker autocompletes from the event's schema.
   - Drop a JSON file in `webhook-plugins/` to add more (see below).
4. Configure **Match** predicates (AND-joined). For GitHub, the `x-github-event` header check is implicit — pick the event, and you only write predicates for body fields.
5. Map **Inputs** — each declared workflow input becomes a row; fill in a template string using the field picker.
6. **Save**, then copy the URL from the detail pane.

**Wiring up GitHub.** InfLoop listens on `http://localhost:3000` by default. To reach it from `github.com`, expose your machine with a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then in your repo: **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://<your-tunnel>.trycloudflare.com/api/webhook/<id>` |
| Content type | `application/json` |
| Secret | (leave blank — the URL is the credential in v2) |
| Events | Pick specific events, or "Send everything" and filter in Dispatch |

**Test fire.** Hit **Test** on any trigger row to open the test-fire modal. Edit a JSON payload (pre-filled from the plugin's example), set headers, and Send. You'll see the real webhook response (202, 204, 422, …) so you can debug predicates and input mapping without leaving the UI.

**Add a plugin.** Create `webhook-plugins/<id>.json`:

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

Restart InfLoop. The plugin appears in the trigger form's plugin dropdown.

**Behavior reference:**

- Match succeeds → `202 { queued, queueId, position }`. Run is queued in memory.
- Match fails or plugin event-header mismatches → `204 No Content`.
- Unknown / disabled trigger id → `404 not-found`.
- Body > 1 MiB → `413 payload-too-large`.
- Queue at cap (100) → `503 queue-full` with `Retry-After: 30`.

**Security.** The unguessable `triggerId` in the URL is the credential. There's no HMAC verification in v2 — treat trigger URLs like passwords; rotate via the regenerate-id button in the Dispatch form. `INFLOOP_API_TOKEN` does **not** apply to webhook ingress (external services can't carry custom auth headers); it gates the management API only.

**Limitations.** Queued runs are lost on process restart (the webhook caller already received `202`; upstream services own retry). No service-specific signature verification yet — planned as a follow-up.

## Workflow files

Each workflow lives as one JSON file in `workflows/`:

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
        { "id": "agent-1", "type": "agent", "position": { "x": 40, "y": 60 },
          "config": { "providerId": "claude", "prompt": "…", "cwd": "/tmp", "timeoutMs": 60000 } },
        { "id": "cond-1", "type": "condition", "position": { "x": 320, "y": 60 },
          "config": { "kind": "sentinel", "against": "{{agent-1.stdout}}",
                      "sentinel": { "pattern": "DONE", "isRegex": false } } }
      ]
    },
    { "id": "end-1", "type": "end", "position": { "x": 760, "y": 200 },
      "config": { "outcome": "succeeded" } }
  ],
  "edges": [
    { "id": "e1", "source": "start-1", "sourceHandle": "next", "target": "loop-1" },
    { "id": "e2", "source": "loop-1",  "sourceHandle": "next", "target": "end-1" },
    { "id": "e3", "source": "agent-1", "sourceHandle": "next", "target": "cond-1" }
  ]
}
```

Saves are atomic and bump `version` on every write. Drop a hand-written JSON file in `workflows/` and refresh — the menu picks it up.

### Workflow library

`workflows/library/` holds repo-shipped, read-only presets. They appear in the workflow menu with a `[library]` tag — you can open, run, or duplicate them into your own `workflows/` for editing, but they can never be overwritten in place.

The **Team** preset fans three Claudes out in parallel (idiomatic, contrarian, conservative) and lets a Judge pick the winner. Open it from the menu, fill in `__inputs.task` and `__inputs.criteria`, and run.

### Run history

Every finished run is persisted at `runs/<workflowId>/<runId>.json` — one JSON file per run, capturing the full event log, final scope, and per-node outputs. The History panel lists them, replays per-node input/output cards, and links each card back to the node on the canvas. The persisted log is capped at 50,000 events per run (oldest dropped first); per-workflow history retention is capped by `INFLOOP_RUN_HISTORY_LIMIT` (default 100).

## Configuration

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` (then next free, up to +20) | HTTP port |
| `HOST` | `0.0.0.0` | Bind address; `127.0.0.1` to disable LAN access |
| `INFLOOP_API_TOKEN` | _(unset)_ | When set, all `/api/*` calls require `Authorization: Bearer <token>`. Disables the browser UI — use for headless servers only. |
| `INFLOOP_WORKFLOWS_DIR` | `<cwd>/workflows` | Where workflow JSON lives |
| `INFLOOP_TRIGGERS_DIR` | `<cwd>/triggers` | Where webhook trigger JSON lives |
| `INFLOOP_RUNS_DIR` | `<cwd>/runs` | Where completed-run records are persisted |
| `INFLOOP_RUN_HISTORY_LIMIT` | `100` | Max persisted runs per workflow (oldest pruned first) |
| `INFLOOP_PROVIDERS_DIR` | `<cwd>/providers` | Where provider manifests live |
| `INFLOOP_PROVIDER_BIN_<ID>` | _(unset)_ | Override the binary for provider `<ID>` (upper-cased), e.g. `INFLOOP_PROVIDER_BIN_CLAUDE=/opt/claude` |
| `INFLOOP_CLAUDE_BIN` | `claude` | Legacy override for the `claude` provider only — kept for back-compat |
| `INFLOOP_PYTHON_BIN` | `python3` | Interpreter for Script nodes with `language: py` |
| `INFLOOP_BUN_BIN` | `bun` | Interpreter for Script nodes with `language: ts` |
| `INFLOOP_WEBHOOK_PLUGINS_DIR` | `<cwd>/webhook-plugins` | Where webhook plugin manifests live |

### Providers

Each agent node picks a runner from `providers/*.json`. A manifest declares either a CLI to spawn (`bin`, `args`, `promptVia`) or an HTTP service to call (`host`, `token`, `ports`), and tells the engine how to parse the output (`claude-stream-json` for token-by-token streaming, `plain` for end-of-process stdout). Drop in a new manifest and the palette picks it up; the agent's config panel exposes it as a selectable provider.

Three manifests ship in the box: `claude.json` (the Claude CLI with `--print --output-format stream-json` for live token streaming), `codex.json` (the Codex CLI), and a sample Hermes HTTP runner.

## Architecture

In one diagram:

```
 Browser
   ├─ canvas (xyflow)  ◀──── /api/workflows/<id>      (loads workflow JSON)
   ├─ palette (drag)
   ├─ config panel
   └─ run view (SSE consumer)
                            ▲
                            │ HTTP (start/stop/save) + Server-Sent Events
                            ▼
 Bun + Next.js (server.ts)
   ├─ /api/workflows          CRUD against workflows/*.json
   ├─ /api/run                POST → workflowEngine.start(wf)
   ├─ /api/run/stop           POST → workflowEngine.stop()
   ├─ /api/events             text/event-stream → live events
   ├─ /api/mcp                Streamable HTTP MCP endpoint
   ├─ /api/webhook/<id>       webhook ingress (queues a run)
   └─ /api/triggers, /api/runs, /api/providers, /api/webhook-plugins
                            │
                            ▼
 WorkflowEngine (singleton)
   ├─ Graph walker with built-in Loop / Parallel / Subworkflow semantics
   ├─ Per-node executor → provider runner (spawn CLI or HTTP call)
   ├─ Templating resolver: {{node-id.field}} over flat scope
   └─ Event buffer (5k live for refresh hydration, 50k persisted per run)
```

**Why SSE, not WebSockets?** Native HTML/JSON, one-way (engine → browser), Bun-friendly, no upgrade dance. Stop and save go through normal `fetch` calls in the other direction.

**Why Bun?** Native TypeScript + ESM (no `tsx` shim), faster cold start than Node, single binary.

## Tech stack

- **Runtime:** Bun
- **Server:** Next.js 15 (App Router) + a thin custom server (`server.ts`)
- **Frontend:** React 19, Zustand for state, `@xyflow/react` v12 for the canvas, hand-written CSS with multi-hue Tokyo-Night-inspired tokens
- **Transport:** Server-Sent Events (`/api/events`)
- **Agent runners:** Pluggable providers — subprocess (`spawn`) or HTTP. See `providers/`.
- **Tests:** `bun:test`, `@testing-library/react`, `@happy-dom/global-registrator`

## Roadmap

The current build ships **Phase 1** (the 6 base node types: Start, End, Agent, Condition, Loop, Branch — plus the live event pipeline) and **Phase 1.5** (the multi-agent primitives: Parallel, Subworkflow, Judge — including the Team preset).

- **Phase 2 (in progress):** `Script` (TS/Python) and pluggable HTTP providers have landed. Still on deck: `Shell` (arbitrary command), `SetVar` (write a named variable), `Catch` (run a subgraph on error before settling), and a predicate DSL with `&&` / `||` / `!`.
- **Phase 3:** `Wait`, `HTTP` node, `Switch` (multi-way branch).

Recent UI work — run history persistence, per-node input/output cards, and a canvas ↔ history-log link — is documented in [`docs/superpowers/specs/2026-05-12-canvas-history-link-design.md`](docs/superpowers/specs/2026-05-12-canvas-history-link-design.md).

See [`docs/superpowers/specs/2026-04-28-workflow-dag-design.md`](docs/superpowers/specs/2026-04-28-workflow-dag-design.md) for the full original design.

## Project layout

```
app/
  api/                  Next.js route handlers (workflows, run, events, mcp, webhook, …)
  components/
    canvas/             xyflow wrapper + custom node UIs
    Palette.tsx         draggable node-type list
    ConfigPanel.tsx     per-node-type config form (templating-aware)
    RunView.tsx         live event log + status pill + elapsed timer
    DispatchView.tsx    webhook trigger management UI
    WorkflowMenu.tsx    top-bar dropdown: list / new / duplicate / save / delete
  queue/                /queue page — pending workflow runs, per-item cancel
  page.tsx              top bar + tri-pane layout (palette · canvas · right panel)
lib/
  shared/workflow.ts    immutable types contract (Workflow, WorkflowNode, …)
  client/               Zustand store + SSE hook + undo/redo
  server/
    workflow-engine.ts  graph walker + Loop / Parallel / Subworkflow semantics
    workflow-store.ts   filesystem-backed CRUD
    run-store.ts        persists completed runs under runs/
    trigger-queue.ts    in-memory FIFO queue (cap 100)
    trigger-store.ts    webhook trigger persistence
    event-bus.ts        typed pub/sub
    nodes/              one executor per node type
    conditions/         sentinel / command / judge strategies
    providers/          provider manifest loader + CLI/HTTP runners
    mcp/                MCP tool schema generation + handlers
    webhook-plugins/    plugin manifest loader
providers/              runner manifests (Claude, Codex, Hermes, …) — drop a JSON file to add one
webhook-plugins/        webhook source manifests (GitHub ships in the box)
workflows/              the workflow JSON store
  library/              read-only repo-shipped presets (Team, …)
runs/                   persisted run records, one folder per workflow
triggers/               webhook trigger configs, one file per trigger
docs/
  superpowers/specs/    design specs
```

## Contributing

Issues and PRs welcome. The codebase is small — a good way in is to read the original design spec at `docs/superpowers/specs/2026-04-28-workflow-dag-design.md` and the engine at `lib/server/workflow-engine.ts`.

## License

Specify a license here (e.g. MIT) once you've decided.
