# InfLoop · Multi-Agent Orchestration Design

**Date:** 2026-05-06
**Status:** Draft for review
**Builds on:** `2026-04-28-workflow-dag-design.md` (Phase 1 DAG + 6 node types).
**Roadmap mapping:** delivers Phase 2 `Judge` (promoted to first-class node) and Phase 3 `Parallel` + `Subworkflow`, plus a `Team` preset workflow.

## Goal

Lift InfLoop from "loop one Claude" to "coordinate several." Three composable primitives plus one preset:

1. **`parallel`** — container that runs N child branches concurrently, with configurable join semantics and failure policy.
2. **`subworkflow`** — call another workflow as a single node, with explicit declared inputs/outputs.
3. **`judge`** — first-class node that takes N candidate texts, asks a Claude judge to pick the best, exposes structured `winner_index`, `scores`, `reasoning`.
4. **`workflows/library/team.json`** — a real workflow file that uses Parallel + Judge to fan out N Claudes and let a judge pick a winner. Zero new code; just dogfoods the primitives.

## Non-goals (defer)

- Cross-run caching / memoization of subworkflow calls.
- Sub-process isolation per branch (each branch still runs in the same Bun process).
- Live editing of a running parallel branch.
- Shared scope writes between parallel siblings (siblings cannot read each other; they only join at the parent).
- Replacing the existing `condition.kind === 'judge'` strategy. Both coexist; the new `judge` node is additive.

## Locked design choices (from brainstorming)

| # | Choice | Decision |
|---|---|---|
| 1 | Parallel node shape | Container with children (mirrors `Loop`). Each top-of-branch child is one branch. |
| 2 | Parallel completion mode | **Configurable**: `wait-all` (default) \| `race` \| `quorum:N`. |
| 3 | Parallel failure mode | **Configurable**: `fail-fast` (default — cancel siblings, route `error`) \| `best-effort` (let siblings finish). |
| 4 | Subworkflow scope | Isolated. Parent declares `inputs` (templated) and `outputs` (names exposed back). |
| 5 | Judge node v1 interface | Rich: `criteria` + `candidates[]` → `winner_index`, `winner`, `scores[]`, `reasoning`. |
| 6 | Team preset | Real workflow file in `workflows/library/team.json`. |

## New types contract (lib/shared/workflow.ts)

```ts
export type NodeType =
  | 'start' | 'end' | 'agent' | 'condition' | 'loop' | 'branch'
  | 'parallel'      // NEW
  | 'subworkflow'   // NEW
  | 'judge';        // NEW

// Existing EdgeHandle extended:
export type EdgeHandle =
  | 'next' | 'met' | 'not_met' | 'true' | 'false' | 'error'
  | 'continue' | 'break'
  | 'all_done'      // NEW — parallel wait-all success
  | 'first_done'    // NEW — parallel race winner
  | 'quorum_met';   // NEW — parallel quorum reached

export interface ParallelConfig {
  /** wait-all: route 'all_done' when every branch finishes (success only).
   *  race: route 'first_done' when ANY branch finishes (success only); cancel siblings.
   *  quorum: route 'quorum_met' when N branches finish successfully; cancel rest. */
  mode: 'wait-all' | 'race' | 'quorum';
  /** Required when mode === 'quorum'. Must be 1 ≤ quorumN ≤ children.length. */
  quorumN?: number;
  /** fail-fast: any branch error → cancel siblings, route 'error'.
   *  best-effort: collect errors per branch; route success handle if mode's success
   *  criterion is met by completed (non-errored) branches; otherwise 'error'. */
  onError: 'fail-fast' | 'best-effort';
}

export interface SubworkflowConfig {
  /** Workflow id (filename stem under workflows/). */
  workflowId: string;
  /** Input bindings: each value is a templated string evaluated against parent scope.
   *  Inside the child workflow, these surface under scope['__inputs'][name]. */
  inputs: Record<string, string>;
  /** Names to copy out of the child's terminal scope back into parent scope under
   *  this subworkflow node's id. Lookup is `<lastNodeId>.<field>` or a declared
   *  `__outputs` slot the child writes via templating (see "Output binding"). */
  outputs: Record<string, string>;
}

// Renamed to avoid collision with the existing condition-strategy `JudgeConfig`.
export interface JudgeNodeConfig {
  /** Templated rubric / criteria text shown to the judge. */
  criteria: string;
  /** Templated candidate texts (e.g. `[\"{{claude-1.stdout}}\", \"{{claude-2.stdout}}\"]`).
   *  Stored as an array of templated strings; resolved per-call. */
  candidates: string[];
  /** Optional override of the judge's system prompt. */
  judgePrompt?: string;
  /** Optional model override. Defaults to the agent provider's default judge model. */
  model?: string;
  /** Optional provider id (defaults to 'claude'). Reuses agent provider plumbing. */
  providerId?: string;
}

export type NodeConfigByType = {
  // ...existing entries...
  parallel: ParallelConfig;
  subworkflow: SubworkflowConfig;
  judge: JudgeNodeConfig;
};
```

`WorkflowNode.children` is reused for `parallel` (same shape as `loop`).

## Engine semantics

### Parallel

The engine treats `parallel` like `loop`: when the BFS walker hits a `type === 'parallel'` node, it does NOT call `execute()`. Instead it calls `walkParallel(parallelNode, exec, allNodes)`.

**Branch identification.** Inside a Parallel container, a "branch root" is a child node with no inbound edge from a sibling child. Each branch root + its connected sub-DAG within the container is one branch. (Same edge-belongs-to-container resolution as Loop, by source/target id.)

**Concurrent execution.** For each branch root, the engine starts a `walkBranch(branchRoot, branchScope, signal)` task. All tasks run as concurrent `Promise`s in the same JS event loop. Each branch:
- Reads from a copy of the parent's scope at parallel-entry time (snapshot, frozen for the branch).
- Writes its own outputs only into its own *branch-local* scope object.
- On branch completion, the engine merges that branch-local scope under `<parallel-id>.children.<branch-root-id>` in the parent scope.

**Cancellation.** Each branch gets an `AbortController` chained off the run's signal. The engine fires sibling cancellation by aborting their controllers; nodes already check `ctx.signal` for the existing Stop button.

**Mode → branch handle**

| mode | success branch handle | trigger |
|---|---|---|
| `wait-all` | `all_done` | every branch finished without error |
| `race` | `first_done` | first branch to finish (success); siblings cancelled |
| `quorum` | `quorum_met` | first `quorumN` successful branches; siblings cancelled |

**Failure policy**

| onError | behavior on branch error |
|---|---|
| `fail-fast` | cancel siblings immediately; emit `error` event with offending branch id; route the parallel node's `error` handle |
| `best-effort` | record per-branch error in scope under `<parallel-id>.children.<branch-id>.error`; if mode's success criterion is still met by surviving branches, route the success handle; otherwise route `error` |

**Outputs written to parent scope under the parallel node's id:**

```ts
{
  mode: 'wait-all' | 'race' | 'quorum',
  completed: number,
  failed: number,
  // wait-all/best-effort: every child; race: just the winner; quorum: the N winners.
  children: Record<branchRootId, { status: 'succeeded' | 'failed' | 'cancelled', outputs: Record<string, unknown>, error?: string }>,
  winner?: branchRootId,         // race mode
  winners?: branchRootId[],      // quorum mode (in completion order)
}
```

**Templating reach.** A node *after* the parallel can read any branch's terminal output as `{{<parallel-id>.children.<branch-id>.outputs.stdout}}`. Templating must therefore support **dotted nested keys** beyond the current single-dot `<nodeId>.<field>`. (See "Templating extension" below.)

### Subworkflow

Engine walker hits a `type === 'subworkflow'` node and calls `walkSubworkflow(node, exec)`.

1. Resolve `inputs` map against parent scope (templated).
2. Load child workflow via `workflowStore.load(config.workflowId)`. Reject (route `error`) if:
   - workflow id not found
   - cycle: child's id (or any transitive subworkflow it calls) equals any ancestor on the call stack
3. Build a fresh child scope: `{ __inputs: { ...resolvedInputs } }`. Child Claude/Branch/etc. nodes can template `{{__inputs.foo}}`.
4. Run the child workflow with the engine's existing walker, on the SAME event bus, but events are tagged with a `subworkflowStack: string[]` of node ids so the UI can scope highlights. (Frontend change: render only top-level events by default; expand-on-click for nested.)
5. After the child run settles:
   - On success: for each `(parentName, childPath)` in `config.outputs`, look up `childPath` in the child's terminal scope and copy to parent scope under `<subworkflow-id>.<parentName>`. Also expose `<subworkflow-id>.status = 'succeeded'`.
   - On failure: route `error`; expose `<subworkflow-id>.status = 'failed'` and `<subworkflow-id>.errorMessage`.

**Output binding details.** `outputs` map values use a dotted child-scope path like `claude-final.stdout` or `judge-1.winner`. No templating delimiters needed; this is a path, not a template.

**Concurrency limit.** Subworkflows are stack-allocated (synchronous in the engine's perspective — the parent walker awaits the child run). A subworkflow inside a parallel branch is fine; two subworkflows in two parallel branches run concurrently.

**Engine concurrency invariant.** Today `engine.start(wf)` rejects if a run is already active. We keep that at the public API. Internally, parallel branches and subworkflows do NOT call `engine.start`; they reuse the same run context, snapshot, event stream, and signal.

### Judge

A first-class node executor at `lib/server/nodes/judge.ts`. Reuses the existing agent provider system (the same one that runs Claude/Codex via `providers/*.json`).

**Algorithm:**
1. Resolve `criteria` and each entry of `candidates[]` against scope.
2. Build a structured prompt:
   ```
   You are a strict judge. Given the criteria and N candidates, return ONLY a JSON object on a single line:
     {"winner_index": <int>, "scores": [<int>...], "reasoning": "<short>"}
   - winner_index is 0-based.
   - scores is one integer per candidate, 1..10, higher = better.
   Criteria: <criteria>
   Candidates:
   [0] <cand 0>
   [1] <cand 1>
   ...
   ```
3. Spawn the configured agent provider (default `claude`) with this prompt and `--output-format stream-json` (same plumbing as `agentExecutor`). Stream stdout to the event bus prefixed with the node id (so the UI shows the judge thinking).
4. Parse the final JSON line. Validate: `winner_index` is in range, `scores.length === candidates.length`, all scores are 1..10. On parse/validation failure, retry once with a stricter system prompt; on second failure, route `error`.
5. Outputs: `{ winner_index, winner: <resolved candidates[winner_index]>, scores, reasoning }`. Branch: `next`.

**Edge cases.**
- `candidates.length < 2` → route `error` (judge needs at least two to pick from).
- Any candidate templates to the empty string → still passes through; judge sees `[i] ` and decides.

### Templating extension (dotted nested keys)

Today's resolver supports `{{nodeId.field}}` over a flat scope `Record<string, Record<string, unknown>>`. We need `{{parallel-1.children.branch-2.outputs.stdout}}`.

**Change:** the resolver walks the dotted path through nested objects. Top-level key still must be a node id (so `{{__inputs.foo}}` requires `__inputs` to exist as a scope key, which it does for subworkflow children). For the engine's external API the scope type stays `Scope = Record<string, Record<string, unknown>>`; nested objects are normal JS objects underneath.

**Compatibility:** all existing single-dot templates resolve unchanged.

## Workflow file format additions

Existing `Workflow` shape unchanged. New nodes use the same `WorkflowNode` shape with `type` ∈ `{parallel, subworkflow, judge}`. Parallel uses `children` like Loop. Edges inside a Parallel container live in the parent workflow's `edges` array, same as Loop's children.

**Validation** (`lib/server/workflow-store.ts` already validates Workflow JSON before save). Add:
- `parallel.mode === 'quorum'` ⇒ `quorumN` ∈ [1, children.length]
- `subworkflow.workflowId` non-empty string
- `judge.candidates` length ≥ 2
- No cycle in subworkflow references (DFS at save time over the whole `workflows/` set; if a save would create a cycle, reject).

## UI changes

### Palette (`app/components/Palette.tsx`)
Add three entries: `Parallel`, `Subworkflow`, `Judge`. Reuse the existing icon-+-label pattern. Group label "Multi-agent" or under existing "Control" / "Agents" — match current grouping idiom.

### Canvas (`app/components/canvas/`)
- New custom node types: `ParallelNode` (container, mirrors `LoopNode` resize+children rendering), `SubworkflowNode` (single block showing target workflow name + I/O badges), `JudgeNode` (single block showing candidate count badge).
- Register in the xyflow `nodeTypes` map.
- Container click semantics for Parallel: same as Loop (click container to select; click inner node to edit inner config).

### ConfigPanel (`app/components/ConfigPanel.tsx`)
- `parallel` form: mode (radio), quorumN (number, shown only when mode=quorum), onError (radio).
- `subworkflow` form: workflowId (dropdown populated from `/api/workflows`), inputs (key→template grid, add/remove rows), outputs (parentName→childPath grid).
- `judge` form: criteria (textarea, templating-aware), candidates (dynamic list of templating-aware textareas with add/remove), optional judgePrompt + model + providerId.

### RunView (`app/components/RunView.tsx`)
- New event filter chip "Subworkflow" — collapses nested events under their parent subworkflow node by default; click to expand.
- Parallel: render branches as concurrently-progressing rows under the parallel node's row.

## Library: `workflows/library/team.json`

A workflow with this shape:
```
Start
  → Parallel (mode=wait-all, onError=fail-fast)
       ├─ claude-implementer  ({{__inputs.task}})
       ├─ claude-alternative  ({{__inputs.task}}, "different approach")
       └─ claude-conservative ({{__inputs.task}}, "minimal change")
  → Judge (criteria=__inputs.criteria, candidates=[stdout x3])
  → End (succeeded)
```

It declares `inputs: { task: string, criteria: string }` (via convention: the workflow's first nodes template `{{__inputs.task}}` etc.) and `outputs: { winner: 'judge-1.winner', reasoning: 'judge-1.reasoning' }` (informational — exposed when used as a subworkflow).

Ship it as part of the repo, NOT user data. New directory `workflows/library/` is scanned alongside `workflows/`. The user can duplicate-into-user-space via the existing top-bar menu.

## Persistence / run history

`RunRecord.scope` already captures the full terminal scope; nested parallel/subworkflow outputs flow through naturally. No schema change. Increase the event-buffer cap from 2000 → 5000 since parallel runs emit more concurrent events. (Sized to keep memory bounded; tunable later.)

## Backward compatibility

- Existing workflows: zero change. Only new node types are introduced; old types and configs are untouched.
- Existing `condition.kind === 'judge'` keeps working (separate code path; same provider plumbing).
- Engine version constant in `workflow-engine.ts` bumps (`ENGINE_VERSION`) so the cross-HMR singleton rebuilds.

## Testing strategy

### Unit tests (vitest)
- `lib/server/nodes/parallel.test.ts`: branch identification, wait-all happy path, race cancellation, quorum success/failure, fail-fast cancellation propagation, best-effort survivor counting.
- `lib/server/nodes/subworkflow.test.ts`: input binding, output extraction, error routing, cycle detection.
- `lib/server/nodes/judge.test.ts`: structured-output parse, retry-on-bad-json, candidate-count validation, range validation.
- `lib/server/templating.test.ts` (extend): dotted nested key resolution; missing-segment warning.
- `lib/server/workflow-engine.test.ts` (extend): parallel + subworkflow integration; subworkflow event tagging.
- `lib/server/workflow-store.test.ts` (extend): validation of new node configs; cycle rejection.

### Integration
- `tests/fixtures/fake-claude.sh` extended with a deterministic-judge mode (env var `FAKE_CLAUDE_JUDGE_WINNER` controls returned JSON). Use this for parallel+judge integration tests without real Claude.

### E2E (chrome-devtools-mcp) — REQUIRED before merge
1. `bun run dev`
2. Open the canvas in Chrome via mcp.
3. Load `team` workflow from the library menu.
4. Set `__inputs.task = "write hello world in python"` and `__inputs.criteria = "shortest correct"`.
5. Click Run; verify SSE events stream from all three claude-* nodes concurrently, the judge fires after all three, the right panel shows `winner` + `reasoning`, run pill flips to `succeeded`, no console errors.
6. Edit Parallel mode → `race`, save, run again; verify only one branch's stdout streams to completion and the other two abort.
7. Take a screenshot at each phase for the result-check report.

## Decomposition into batch units (preview, finalized in /batch Phase 1)

1. **Types contract** — `lib/shared/workflow.ts` extensions + `Scope` nesting note + `NodeType` union.
2. **Templating** — dotted nested key resolver + tests.
3. **Engine: parallel walker** — `walkParallel`, branch identification, concurrent execution, signal chaining.
4. **Engine: parallel modes** — wait-all/race/quorum + fail-fast/best-effort logic.
5. **Engine: subworkflow walker** — load, isolated scope, output binding, cycle detection.
6. **Node executor: judge** — structured-prompt agent call, JSON parse, retry, validation.
7. **Node module wiring** — register `parallel`/`subworkflow`/`judge` in `lib/server/nodes/index.ts`.
8. **Workflow store validation** — new node validators + cycle check at save time.
9. **Library directory** — scan `workflows/library/` alongside `workflows/`; merge in list endpoint with a `source: 'library' | 'user'` flag.
10. **`workflows/library/team.json`** — the preset.
11. **Palette + node registration** — three new palette entries with icons.
12. **Canvas custom nodes** — `ParallelNode` (container), `SubworkflowNode`, `JudgeNode`.
13. **ConfigPanel forms** — three new forms.
14. **RunView events** — subworkflow-collapse chip + parallel branch rows.
15. **Docs** — README "Nodes" table updates + "Roadmap" tick.

(Final cut may merge tiny units or split big ones — locked in /batch Phase 1.)

## Risks

- **Concurrent stdout interleaving in the right panel.** Each chunk is already tagged with `nodeId`; UI needs to render per-node columns or interleave with prefix. Mitigation: keep the existing per-node grouping; add a "live branch" highlight per parallel branch root.
- **Subworkflow event flood.** A child workflow with chatty Claude can blow the event buffer. Mitigation: sliding-window cap already exists; bump to 5000; add `truncated: true` flag (already in `RunRecord`) when capped.
- **Judge JSON parse fragility.** Mitigation: one retry with stricter prompt; clear `error` route on second failure with `stderr` containing the bad output.
- **Cycle detection cost.** O(N) over saved workflows at save time; saves are infrequent. Acceptable.
- **Race-mode resource leaks.** Aborted branches must release child Claude processes. Mitigation: existing `claudeRunner` already handles `SIGTERM`→`SIGKILL` on signal; verify in parallel test.

## Open questions (to lock in /batch Phase 1)

None — all design choices were locked by user before spec write.

