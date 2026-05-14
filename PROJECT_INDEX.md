# Project Index

## Identity

- **Name:** Infinite Loop (`infinite-loop`)
- **Purpose:** Local visual canvas for composing, running, replaying, and triggering AI-agent workflows.
- **Runtime:** Bun with a custom Next.js 15 server.
- **Frontend:** React 19, App Router, Zustand, `@xyflow/react`.
- **Primary transports:** HTTP APIs plus Server-Sent Events from `/api/events`.
- **Execution surface:** Local CLI providers, HTTP providers, inline scripts, command conditions, MCP, and webhooks.

## Start Here

- [README.md](README.md) - product overview, quickstart, examples, and security notes.
- [docs/architecture.md](docs/architecture.md) - high-level system diagram and project layout.
- [docs/workflow-format.md](docs/workflow-format.md) - workflow JSON schema and node reference.
- [docs/providers.md](docs/providers.md) - provider manifest format and runner behavior.
- [docs/webhooks.md](docs/webhooks.md) - webhook trigger setup and plugin model.
- [docs/mcp.md](docs/mcp.md) - MCP endpoint and exposed workflow tools.
- [docs/security.md](docs/security.md) - local code-execution risks and deployment guidance.

## Commands

```bash
bun install
bun run dev
bun run test
bun run typecheck
bun run build
bun run start
```

## Top-Level Layout

| Path | Role |
| --- | --- |
| [server.ts](server.ts) | Custom Bun/Next server with port fallback and LAN URL logging. |
| [app/](app) | Next App Router UI, route handlers, global CSS, and pages. |
| [lib/client/](lib/client) | Browser-side store, auto-save, event stream client, and API clients. |
| [lib/shared/](lib/shared) | Shared workflow, trigger, and template reference types/utilities. |
| [lib/server/](lib/server) | Workflow engine, stores, node executors, providers, MCP, webhook logic, and queues. |
| [providers/](providers) | Provider manifests for Claude, Codex, and local Hermes connections. |
| [webhook-plugins/](webhook-plugins) | Webhook source manifests such as GitHub and Frogo. |
| [workflows/](workflows) | Saved workflow JSON files plus library presets. |
| [runs/](runs) | Persisted run records grouped by workflow. |
| [docs/](docs) | User-facing documentation. |
| [specs/](specs) | Design specs and implementation plans. |
| [tests/](tests) | Shared test setup, fixtures, and browser/e2e scripts. |

## Main Runtime Flow

1. The user edits or selects a workflow in [app/page.tsx](app/page.tsx).
2. Workflow state lives in [lib/client/workflow-store-client.ts](lib/client/workflow-store-client.ts).
3. Saving/loading goes through `/api/workflows` handlers in [app/api/workflows/](app/api/workflows).
4. Running goes through [app/api/run/route.ts](app/api/run/route.ts).
5. The singleton engine in [lib/server/workflow-engine.ts](lib/server/workflow-engine.ts) walks the graph.
6. Node-specific behavior is delegated to [lib/server/nodes/](lib/server/nodes).
7. Agent nodes call provider runners in [lib/server/providers/](lib/server/providers).
8. Events publish through [lib/server/event-bus.ts](lib/server/event-bus.ts), stream through [app/api/events/route.ts](app/api/events/route.ts), and render in [app/components/RunView.tsx](app/components/RunView.tsx).
9. Completed runs persist through [lib/server/run-store.ts](lib/server/run-store.ts).

## Frontend Map

| Path | Role |
| --- | --- |
| [app/page.tsx](app/page.tsx) | Main console shell: top bar, editor/dispatch view switch, run controls, resizable right panel. |
| [app/queue/page.tsx](app/queue/page.tsx) | Queue management page for pending trigger/MCP workflow runs. |
| [app/components/canvas/Canvas.tsx](app/components/canvas/Canvas.tsx) | Xyflow canvas wrapper and graph editing surface. |
| [app/components/canvas/nodes/](app/components/canvas/nodes) | Visual node components for Start, Agent, Loop, Branch, Parallel, Judge, Script, and related node types. |
| [app/components/Palette.tsx](app/components/Palette.tsx) | Draggable palette of workflow node types. |
| [app/components/ConfigPanel.tsx](app/components/ConfigPanel.tsx) | Per-node configuration forms and workflow-level editing controls. |
| [app/components/TemplateField.tsx](app/components/TemplateField.tsx) | Template-aware text input with field picker support. |
| [app/components/DispatchView.tsx](app/components/DispatchView.tsx) | Webhook trigger management view. |
| [app/components/TriggerForm.tsx](app/components/TriggerForm.tsx) | Trigger creation/editing form. |
| [app/components/TestFireModal.tsx](app/components/TestFireModal.tsx) | Manual trigger test UI. |
| [app/components/HermesConnectionsModal.tsx](app/components/HermesConnectionsModal.tsx) | Local Hermes provider connection management. |
| [app/components/RunHistory.tsx](app/components/RunHistory.tsx) | Historical run browser. |
| [app/components/RunLog.tsx](app/components/RunLog.tsx) | Event log rendering. |
| [app/components/WorkflowMenu.tsx](app/components/WorkflowMenu.tsx) | Workflow list, create, duplicate, save, and delete menu. |
| [app/globals.css](app/globals.css) | Global styling and component class rules. |

## API Surface

| Route | Files | Purpose |
| --- | --- | --- |
| `/api/events` | [app/api/events/route.ts](app/api/events/route.ts) | SSE stream of engine events. |
| `/api/run`, `/api/run/stop` | [app/api/run/](app/api/run) | Start and stop workflow execution. |
| `/api/runs` | [app/api/runs/](app/api/runs) | List and read persisted run records. |
| `/api/workflows` | [app/api/workflows/](app/api/workflows) | Workflow CRUD and validation. |
| `/api/providers` | [app/api/providers/](app/api/providers) | Provider discovery, profiles, agents, and Hermes local connections. |
| `/api/triggers` | [app/api/triggers/](app/api/triggers) | Trigger CRUD, trigger queue inspection, cancellation, and test firing. |
| `/api/webhook/[triggerId]` | [app/api/webhook/[triggerId]/route.ts](app/api/webhook/[triggerId]/route.ts) | Public webhook ingress by trigger id. |
| `/api/webhook-plugins` | [app/api/webhook-plugins/route.ts](app/api/webhook-plugins/route.ts) | Webhook plugin discovery. |
| `/api/mcp` | [app/api/mcp/route.ts](app/api/mcp/route.ts) | Streamable HTTP MCP endpoint. |
| `/api/fs/list` | [app/api/fs/list/route.ts](app/api/fs/list/route.ts) | Filesystem listing for UI pickers. |

## Server Map

| Path | Role |
| --- | --- |
| [lib/server/workflow-engine.ts](lib/server/workflow-engine.ts) | Core graph walker, execution scope, loop/parallel/subworkflow semantics, event emission. |
| [lib/server/nodes/](lib/server/nodes) | Node executors for Agent, Branch, Condition, Judge, Loop, Parallel, Script, Start/End, Subworkflow, and Sidenote. |
| [lib/server/conditions/](lib/server/conditions) | Condition strategies: command, judge, and sentinel. |
| [lib/server/providers/loader.ts](lib/server/providers/loader.ts) | Provider manifest loading and validation. |
| [lib/server/providers/runner.ts](lib/server/providers/runner.ts) | CLI provider execution and stream parsing. |
| [lib/server/providers/http-runner.ts](lib/server/providers/http-runner.ts) | HTTP provider execution. |
| [lib/server/providers/hermes-local-store.ts](lib/server/providers/hermes-local-store.ts) | Local Hermes connection persistence. |
| [lib/server/providers/parsers/](lib/server/providers/parsers) | Output parsers for plain text and Claude stream JSON. |
| [lib/server/workflow-store.ts](lib/server/workflow-store.ts) | Filesystem-backed workflow persistence. |
| [lib/server/run-store.ts](lib/server/run-store.ts) | Persisted run storage under `runs/`. |
| [lib/server/trigger-store.ts](lib/server/trigger-store.ts) | Filesystem-backed trigger persistence. |
| [lib/server/trigger-index.ts](lib/server/trigger-index.ts) | Lazy in-memory trigger lookup index. |
| [lib/server/trigger-queue.ts](lib/server/trigger-queue.ts) | FIFO queue for externally triggered runs. |
| [lib/server/queue-history.ts](lib/server/queue-history.ts) | Queue history persistence. |
| [lib/server/mcp/](lib/server/mcp) | MCP workflow tool generation, enqueue tool, output filtering, and utility tools. |
| [lib/server/webhook-plugins/](lib/server/webhook-plugins) | Webhook plugin manifest validation and singleton plugin index. |
| [lib/server/webhook-scope.ts](lib/server/webhook-scope.ts) | Webhook request scope construction. |
| [lib/server/webhook-signature.ts](lib/server/webhook-signature.ts) | Webhook signature verification. |
| [lib/server/predicate.ts](lib/server/predicate.ts) | Predicate evaluation for branches and triggers. |
| [lib/server/templating.ts](lib/server/templating.ts) | Runtime template resolution. |
| [lib/server/auth.ts](lib/server/auth.ts) | API token enforcement. |

## Shared Contracts

| Path | Role |
| --- | --- |
| [lib/shared/workflow.ts](lib/shared/workflow.ts) | Workflow graph, node config, run, provider, and event contracts. |
| [lib/shared/trigger.ts](lib/shared/trigger.ts) | Trigger and webhook plugin contract types. |
| [lib/shared/template-refs.ts](lib/shared/template-refs.ts) | Template reference discovery for UI affordances. |
| [lib/shared/resolve-run-inputs.ts](lib/shared/resolve-run-inputs.ts) | Workflow input default/override resolution. |
| [lib/shared/types.ts](lib/shared/types.ts) | Shared generic types. |

## Data Directories

| Path | Contents |
| --- | --- |
| [workflows/](workflows) | Editable workflow JSON files. |
| [workflows/library/](workflows/library) | Repo-shipped workflow presets. |
| [runs/](runs) | Completed run logs and metadata. |
| `triggers/` | Trigger JSON files, if present locally. |
| [providers/](providers) | Provider manifests; `*.local.json` may contain local machine-specific config. |
| [webhook-plugins/](webhook-plugins) | Webhook plugin manifests. |

## Testing Map

- Unit and component tests live next to implementation as `*.test.ts` and `*.test.tsx`.
- Shared setup is in [tests/setup.ts](tests/setup.ts) and [tests/jest-dom.d.ts](tests/jest-dom.d.ts).
- Fake provider CLIs are in [tests/fixtures/](tests/fixtures).
- Browser/e2e scripts are in [tests/_e2e/](tests/_e2e).
- Full suite: `bun run test`.
- Static type check: `bun run typecheck`.

## Important Specs

- [specs/workflow-dag-design.md](specs/workflow-dag-design.md) - original graph/workflow design.
- [specs/dispatch-v2.md](specs/dispatch-v2.md) - dispatch, trigger, queue, and webhook evolution.
- [specs/multi-agent-orchestration.md](specs/multi-agent-orchestration.md) - parallel, subworkflow, and judge design.
- [specs/trigger-api-mcp.md](specs/trigger-api-mcp.md) - MCP trigger API design.
- [specs/frogo-webhook-plugin.md](specs/frogo-webhook-plugin.md) - Frogo webhook plugin design.

## Agent Notes

- Treat workflows, provider manifests, webhook plugins, inline scripts, and command conditions as executable code.
- Default server bind is `0.0.0.0`; set `HOST=127.0.0.1` for loopback-only development.
- Keep changes scoped: frontend behavior usually spans `app/page.tsx`, `app/components/`, and `lib/client/workflow-store-client.ts`; execution behavior usually spans `lib/shared/workflow.ts`, `lib/server/workflow-engine.ts`, and `lib/server/nodes/`.
- Add or update focused tests next to the file being changed.
- Prefer existing store/actions, event types, node executor patterns, and provider manifest validation before introducing new abstractions.
