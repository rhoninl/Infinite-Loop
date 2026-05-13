# InfLoop Design

**Date:** 2026-04-28
**Status:** Draft for review

## Purpose

A local web app that drives the Claude Code CLI in a loop until a user-defined exit condition is met, with first-class handling for common failure modes. The user starts a task from a browser UI, watches iterations stream live, and can stop the run at any time.

## Scope (MVP)

- Single Node process serves both the Next.js app and the loop runtime.
- One active run at a time. No persistence — closing the server clears history.
- The loop invokes `claude --print` as a fresh, stateless child process each iteration (no session resume, no replay summary).
- Three selectable exit-condition strategies, chosen per task in the UI.
- Five error cases handled: process error, timeout, max iterations, unparseable condition output, manual stop.

Out of scope for MVP: persistence, multiple concurrent runs, rate-limit/cost handling, sandboxed working directories, authentication.

## Architecture

A single Node process started via `node server.ts`. The process serves the Next.js application and additionally hosts a WebSocket server on the same HTTP server. A singleton `LoopManager` module lives in server memory and is the single source of truth for the active run.

```
 Browser ──HTTP──▶ Next.js routes  ─┐
        ──WS────▶ ws server ───────┴─▶ LoopManager (singleton)
                                          │
                                          ▼
                                     spawn("claude", ...) ← child process
```

- **Frontend (React, App Router):** task form, live iterations panel, status badge, stop button, in-session history strip.
- **API routes:** `POST /api/run` (start), `POST /api/run/stop` (cancel), `GET /api/run` (status snapshot).
- **WebSocket `/ws`:** server-push events for the live UI.
- **LoopManager:** orchestrates the loop, owns the child process, enforces caps, emits events. Holds an `AbortController` for cancellation.
- **No DB, no disk persistence.**

Stack: Next.js (App Router) + TypeScript on both sides; `ws` for WebSockets; native `child_process.spawn` for Claude.

## Components

### Frontend (`app/`, `lib/client/`)

- `app/page.tsx` — single page. Sections:
  - **Task form:** prompt textarea, working dir (absolute path), condition type selector + per-type config, max iterations, per-iteration timeout.
  - **Run panel:** status badge (`idle | running | succeeded | failed | exhausted | cancelled`), iteration list with collapsible stdout, Stop button.
  - **History strip:** in-memory list of finished runs in this session.
- `lib/client/ws-client.ts` — thin WebSocket client with reconnect-on-drop and a `useRunEvents()` React hook exposing typed events.

### Backend (`server.ts`, `lib/server/`)

- `server.ts` — custom Next.js server. Creates the HTTP server, attaches a `ws` server at path `/ws`, delegates other requests to Next.js.
- `lib/server/loop-manager.ts` — singleton with `start(opts)`, `stop()`, `getState()`, `subscribe(ws)`. Enforces "at most one active run".
- `lib/server/claude-runner.ts` — spawns `claude --print <prompt>` in the configured `cwd`, streams stdout/stderr line-by-line, returns `{exitCode, stdout, stderr, durationMs, timedOut}`. No session resume.
- `lib/server/conditions/` — strategy modules, one per condition type:
  - `sentinel.ts` — scan iteration stdout for a user-supplied string or regex.
  - `command.ts` — run a user-supplied shell command in `cwd`; exit 0 means condition met.
  - `judge.ts` — separate `claude --print` call with a judge prompt + the iteration's stdout; parse `MET` or `NOT_MET`.
- `lib/server/event-bus.ts` — typed pub/sub used by LoopManager to fan out to WebSocket subscribers.
- `lib/shared/types.ts` — TypeScript types for run config, events, and state, imported by both client and server.

## Data flow (one run)

1. User submits the form → `POST /api/run` with `{prompt, cwd, conditionType, conditionConfig, maxIterations, iterationTimeoutMs}`. The route rejects with 409 if a run is already active.
2. LoopManager transitions `idle → running`, emits `run_started`, and enters the loop:
   1. Emit `iteration_started{n}`.
   2. Spawn Claude with a per-iteration timeout. Emit `stdout_chunk` events as lines arrive.
   3. On exit, emit `iteration_finished{n, exitCode, durationMs, timedOut}`.
   4. If the iteration ended in a process error or timeout, emit `error` and end the run as `failed`.
   5. Otherwise run the selected condition strategy → emit `condition_checked{met, detail}`. Unparseable output is treated as `met=false`.
   6. If `met=true`, end run as `succeeded`. Else if `n >= maxIterations`, end as `exhausted`. Else loop.
3. `run_finished{outcome, iterations}` is the terminal event. LoopManager returns to `idle`.
4. **Stop** (`POST /api/run/stop`): LoopManager triggers its `AbortController`, which kills the child via `SIGTERM` then `SIGKILL` after a 2s grace, and emits `run_finished{outcome: "cancelled"}`.

**State machine:** `idle → running → (succeeded | failed | exhausted | cancelled) → idle`.

## Condition strategies

| Type | Config | "Met" definition |
|---|---|---|
| `sentinel` | `{pattern: string, isRegex: boolean}` | pattern present in final stdout |
| `command` | `{cmd: string}` | command exits 0 when run in `cwd` after the iteration |
| `judge` | `{rubric: string, model?: string}` | secondary `claude --print` returns `MET` |

For all three, an internal error in evaluating the condition (e.g., judge call failed, command crashed before producing an exit code) is logged and treated as `met=false` rather than failing the run, so the loop can self-correct on the next iteration. Process-level failures of the **primary** Claude iteration still terminate the run (they indicate the worker itself is broken, not the goal).

## Error handling (MVP cases)

| Case | Detection | Behavior |
|---|---|---|
| **A. CLI process error** | child exits non-zero, or `spawn` itself fails | end run as `failed`, surface stderr in the event |
| **B. Timeout / hang** | per-iteration `setTimeout` fires before child exits | `SIGTERM` → `SIGKILL` after 2s, end run as `failed` with `timedOut: true` |
| **D. Max iterations** | `n >= maxIterations` after a non-met check | end run as `exhausted` |
| **F. Unparseable condition output** | sentinel/judge cannot determine met-ness | treat as `met=false`, continue loop (capped by D) |
| **G. Manual stop** | user clicks Stop | abort + kill child, end run as `cancelled` |

Deferred: rate-limit / API errors, condition-check infrastructure errors as a separate outcome, cost cap.

## Testing strategy

- **Unit:** condition strategies (sentinel regex, command exit codes, judge parsing); LoopManager state-machine transitions.
- **Integration:** replace the `claude` binary with `tests/fixtures/fake-claude.sh` that emits scripted stdout, exits with chosen codes, and can hang on demand. Drive LoopManager end-to-end through: success on iteration N, exhaustion, timeout-kill, manual stop.
- **Manual smoke (Result Check):** real `claude` CLI against a tiny task ("write `hello.txt` with contents 'hi'") with `command` condition `test -f hello.txt`. Verify UI streams iterations and finishes `succeeded`.
- No browser-level E2E tests for MVP.

## Decisions log (from brainstorming)

- Q1 — exit condition: **D**, user picks per task (sentinel / command / judge).
- Q2 — frontend: **A**, local web app.
- Q3 — error cases: **A, B, D, F, G** for MVP.
- Q4 — Claude invocation: **C**, fresh stateless session each iteration, no replay.
- Q5 — concurrency / persistence: **A**, single task, in-memory only.
- Q6 — working directory: **A**, user-supplied absolute path.
- Q7 — stack: Next.js + TypeScript.
- Architecture: Option 1, custom Next.js server with WebSocket; LoopManager singleton in-process.
