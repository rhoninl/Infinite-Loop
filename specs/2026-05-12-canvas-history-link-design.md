# Canvas ↔ Run-History Link

**Status:** Approved — ready for implementation plan
**Date:** 2026-05-12

## Problem

The canvas graph and the recorded-run history detail view are visually adjacent but functionally disconnected. When inspecting a run, a user has to read the full event log to find what a specific node did, then mentally map node ids back to the graph. There is no way to ask "show me this node's logs" from the canvas, or "where is this card on the graph" from the log.

## Goal

A bidirectional link between the canvas and the recorded-run history detail:

1. **Canvas → history.** When a run is open in the history panel and the user clicks a canvas node, the detail view filters the grouped log to just that node's card.
2. **History → canvas.** When the user clicks a node-card header in the history detail, the canvas selects and pans to the matching node. The header continues to toggle fold/expand in the same click.

## Out of scope

- The live `RunView` panel. Filter and locate apply only to the recorded-run detail view in `RunHistory`.
- The run-list (pre-detail) view in `RunHistory`. Locate has nothing to target there.
- The "no run open" case. Canvas clicks update selection as usual but do not auto-open a run.
- Multi-node selection. A single `selectedNodeId` filter at a time.

## Affected files

- `lib/client/workflow-store-client.ts` — store: add a pan-request signal.
- `app/components/RunHistory.tsx` — subscribe to selection; filter cards; render a "filtered" chip.
- `app/components/RunLog.tsx` — accept an optional `onCardActivate` callback; wire header click; upgrade no-body header to a button when handler is supplied.
- `app/components/canvas/Canvas.tsx` — subscribe to pan-request; call `fitView` on the target node.
- `app/components/RunHistory.test.tsx` — filter behavior tests.
- `app/components/RunLog.test.tsx` — new file: header-click callback tests.
- `app/components/canvas/Canvas.test.tsx` — pan-request → `fitView` invocation test.

## Approach

### Store: pan-request signal

The canvas component sits inside `ReactFlowProvider` and is the only place that can call `useReactFlow().fitView`. To trigger pan from outside (from `RunHistory`), use the store as the integration point.

Add to `WorkflowStore`:

```ts
panRequest: { nodeId: string; seq: number } | null;
requestPanToNode(id: string): void;
```

`requestPanToNode` sets `panRequest` to `{ nodeId: id, seq: prev.seq + 1 }`. The monotonic `seq` lets the canvas's `useEffect` re-fire when the same node id is requested twice — without it, React would skip the duplicate state and the second click would do nothing.

The `selectedNodeId` field and `selectNode(id)` action already exist; no changes there.

### Canvas → history filter

In `RunHistory.tsx`, the detail branch (`if (selectedRunId)`):

- Subscribe to `selectedNodeId` from the store.
- Compute `nodeHasEventsInRun = !!record && record.events.some(e => eventNodeId(e) === selectedNodeId)`.
- When `selectedNodeId && nodeHasEventsInRun`:
  - Render a chip above the log: `Filtered: <nodeId>  [×]`. The × calls `selectNode(null)`.
  - Pass a `filterNodeId` prop into `GroupedEventLog`.
- When the filter is inactive (no selection, or selection has no events here), the chip is hidden and the full log renders as today.

`GroupedEventLog` (in `RunLog.tsx`) gets a new optional prop `filterNodeId?: string`. When set:

- Render `header` events: skipped (filter view should be focused on the card).
- Render `cards.filter(c => c.nodeId === filterNodeId)`.
- Render `footer` events: skipped.

When `filterNodeId` is undefined, behavior is unchanged.

### History → canvas locate + pan

`NodeCardView` (in `RunLog.tsx`) accepts an optional `onActivate?: (nodeId: string) => void` prop, threaded down from `GroupedEventLog`'s new `onCardActivate?: (nodeId: string) => void`.

- When `onActivate` is supplied:
  - The header button's `onClick` calls `onActivate(card.nodeId)` and still toggles fold (existing `setOpen`).
  - The no-body branch (currently a plain `<header>`) is rendered as a `<button>` so the locate gesture is available even on empty cards. When there is no body and no `onActivate`, fall back to the existing `<header>`.
- When `onActivate` is not supplied (e.g., live `RunView`), behavior is unchanged.

In `RunHistory.tsx` detail branch, pass:

```ts
onCardActivate={(nodeId) => {
  selectNode(nodeId);
  requestPanToNode(nodeId);
}}
```

In `Canvas.tsx`, inside the inner component that uses `useReactFlow`:

```ts
const panRequest = useWorkflowStore((s) => s.panRequest);
const { fitView } = useReactFlow();
useEffect(() => {
  if (!panRequest) return;
  fitView({
    nodes: [{ id: panRequest.nodeId }],
    padding: 0.3,
    maxZoom: 1.2,
    duration: 250,
  });
}, [panRequest, fitView]);
```

The effect's dependency on the full `panRequest` object (whose `seq` changes per call) guarantees re-pan on repeat clicks. No need to clear `panRequest` after firing — keeping the last value is harmless because the effect only runs when the reference changes.

## Data flow

```
Canvas node click
  → store.selectNode(id)            (existing)
  → RunHistory observes selectedNodeId
  → if run open AND node has events: filter GroupedEventLog to that card
  → chip "Filtered: <id> [×]" shown above log

History node-card header click
  → onCardActivate(nodeId)
    → store.selectNode(nodeId)
    → store.requestPanToNode(nodeId)  (seq++)
  → Canvas effect on panRequest fires
  → fitView({ nodes: [{ id }] })
  → header also toggles fold (existing setOpen)
```

## Edge cases

- **Repeat pan to same node.** Handled by `panRequest.seq` counter.
- **Subworkflow-folded events.** `applySubworkflowCollapse` re-attributes nested events to the owning subworkflow node (a real local node), so filter and pan work for that owner. The internals stay hidden, consistent with the current collapsed view.
- **Selection has no events in the open run.** Filter is skipped silently; the user still sees the full log. (Common when switching between historical runs that didn't touch the currently selected node.)
- **Workflow switch or `currentWorkflow` clear.** Existing store logic nulls `selectedNodeId` when the node is no longer in the workflow tree. `panRequest` is not cleared but is harmless until the next request.
- **Card has no body (only `node_started`/`node_finished`).** Header is upgraded to a `<button>` when `onActivate` is supplied so locate still works. Fold toggle is a no-op because there is no body to show, but the visual remains consistent.
- **Clicking empty canvas area.** Existing canvas deselect logic clears `selectedNodeId`, which clears the filter automatically. No additional wiring needed.

## Testing

- `app/components/RunHistory.test.tsx`
  - Filter activates: open a run, set `selectedNodeId` to a node that has events → only that card renders, chip is visible.
  - Chip clears filter: clicking `×` calls `selectNode(null)` and the full log returns.
  - Selection with no events in this run: full log renders, no chip.
  - Switching runs preserves expected filter behavior (no stale filter from a previous run).
- `app/components/RunLog.test.tsx` (new)
  - Header click fires `onCardActivate(nodeId)` and toggles fold.
  - Empty-body card with `onCardActivate` renders a `<button>` (locate works).
  - Empty-body card without `onCardActivate` renders the plain `<header>` (existing behavior).
- `app/components/canvas/Canvas.test.tsx`
  - Increment `panRequest.seq` for a given node id → `fitView` invoked with `{ nodes: [{ id }], ... }`. Mock `useReactFlow` to capture the call.
  - Second call with the same node id re-fires `fitView` (seq advancement test).

Standard project gates apply: `bun test`, lint, type-check.

## Risks

- **Fold/locate combined gesture.** A single click does two things (locate + toggle fold). Acceptable per user choice; only concern is users who want to expand without locating. Mitigation: the locate effect is idempotent and the chip provides a clear escape (`×`).
- **`fitView` on a hidden node.** If the target node is inside a collapsed subgroup that the canvas hides, `fitView` may not move. The current canvas does not hide nodes, so this is a future concern only.
- **Test brittleness around React Flow.** Mocking `useReactFlow` keeps unit tests independent of viewport math; the existing `Canvas.test.tsx` patterns should generalize.
