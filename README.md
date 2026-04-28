# InfLoop

Local web app that drives the Claude Code CLI in a loop until a user-defined exit condition is met.

## Quickstart

```bash
bun install
bun run dev          # http://localhost:3000
bun run test         # unit tests (vitest, NOT bun's built-in runner)
```

The custom server (`server.ts`) hosts both Next.js and a WebSocket endpoint at `/ws` for live iteration streaming.

## Status

This is the Phase A foundation: scaffold, shared types, event bus, LoopManager (full state machine), custom server, and stub modules for the runner, condition strategies, API routes, frontend components, and WebSocket client. Phase B fills in the stubs in parallel; until those PRs land, starting a run will surface a "not yet implemented" error.

See [`docs/superpowers/specs/2026-04-28-infloop-design.md`](docs/superpowers/specs/2026-04-28-infloop-design.md) for the design.
