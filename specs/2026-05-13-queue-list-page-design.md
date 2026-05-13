# /queue page + per-item cancel — design

**Date:** 2026-05-13
**Status:** approved (design phase)
**Owner:** main session

## Problem

The trigger queue (`TriggerQueue` in `lib/server/trigger-queue.ts`) holds runs that are waiting for the engine. Today the only visibility is `QueueBadge` (a count in the topbar) and `GET /api/triggers/queue` (which returns just `size` and `head`). Users have no way to see what is queued or to cancel a queued item.

## Goal

Add a dedicated `/queue` page that lists every queued item and lets the user cancel any single item, with a confirmation step.

## Non-goals

- Cancelling an in-flight engine run.
- Bulk actions (Clear all, cancel by workflow).
- Reordering queued items.
- Filtering or searching.

## High-level approach

Pure REST. Extend `TriggerQueue` with `list()` and `removeByQueueId()`, extend the existing `GET /api/triggers/queue` to include the full items array, and add `DELETE /api/triggers/queue/[queueId]`. The page uses an initial fetch plus a local `EventSource('/api/events')` listener (separate from `useEngineWebSocket`, which is tied to the workflow store) to stay live.

## Backend

### TriggerQueue (`lib/server/trigger-queue.ts`)

Add two methods:

```ts
list(): QueuedRun[]                                   // shallow copy of this.q
removeByQueueId(queueId: string): { removed: boolean } // splices in place; emits 'trigger_removed' on success
```

New event type on the event bus (also added to `WorkflowEvent` union and `VALID_EVENT_TYPES` in `lib/client/ws-client.ts`):

```ts
{
  type: 'trigger_removed';
  queueId: string;
  triggerId: string;
  workflowId: string;
  reason: 'user-cancelled';
}
```

`removeByQueueId` does not touch `drain()` — it only filters the in-memory array. If a delete races with `drain()` and the item has already been `shift()`ed, `removeByQueueId` returns `{ removed: false }` and the API responds 404 (the engine is starting it; that's correct semantically — the queue can't undo it).

### Route: `GET /api/triggers/queue` (`app/api/triggers/queue/route.ts`)

Extend the JSON shape. `size` and `head` stay for back-compat with `QueueBadge`:

```ts
{
  size: number;
  head?: { triggerId: string; workflowId: string; position: 1 };
  items: QueueItemDto[];
}

interface QueueItemDto {
  queueId: string;
  triggerId: string;
  workflowId: string;
  workflowName: string;   // from item.workflow.name on the queued snapshot
  receivedAt: number;
  position: number;       // 1-based, head = 1
}
```

### Route: `DELETE /api/triggers/queue/[queueId]` (new file `app/api/triggers/queue/[queueId]/route.ts`)

- `requireAuth`.
- Calls `triggerQueue.removeByQueueId(queueId)`.
- 204 on `removed: true`.
- 404 `{ error: 'not-in-queue' }` on `removed: false` (item never existed or already drained).

## Frontend

### New page: `app/queue/page.tsx` (client component)

- Initial: `fetch('/api/triggers/queue')` → set `items`.
- Live: open a local `EventSource('/api/events')`, listen for:
  - `trigger_enqueued` → append (or refetch — append is cheaper).
  - `trigger_started` / `trigger_dropped` / `trigger_removed` → remove matching `queueId` from local state.
- Render a table with columns: `#`, `Workflow`, `Trigger`, `Queued at`, action cell.
- Empty state: `"No queued runs."`.
- Page closes its EventSource on unmount.

### Per-row confirm UX (inline, not modal)

Each row has an `✕ Delete` button. Clicking it:

1. Swaps the row's action area to `Confirm?` (primary, danger styling) + `Cancel`.
2. `Confirm?` → DELETE; on 204, optimistically remove the row. On 404, show a one-shot inline notice "Already started — couldn't cancel" and let the SSE `trigger_started` event remove the row naturally.
3. `Cancel` or 4-second timeout reverts.
4. Only one row can be in confirming state at a time; clicking `✕` on another row reverts the first.

CSS lives in `globals.css` with semantic class names (`.queue-page`, `.queue-table`, `.queue-row`, `.queue-row[data-confirming="true"]`). Reuse `.btn`; add `.btn-danger` if not already present.

### Topbar integration (`app/page.tsx`)

- Wrap `QueueBadge` in `<Link href="/queue">` so the badge becomes the primary entry point when non-empty.
- Add an always-visible `<Link href="/queue" className="btn">Queue</Link>` next to the badge slot so an empty queue is still reachable.

## Auth

Both routes use `requireAuth`, matching existing behavior. Any authed user can delete any queued item.

## Edge cases

| Case | Behavior |
|---|---|
| DELETE for unknown `queueId` | 404 `not-in-queue`. |
| DELETE after item already drained | 404 `not-in-queue`. UI shows brief notice; SSE removes the row. |
| Concurrent delete from two tabs | First wins (204); second gets 404, treated as already-gone. |
| Workflow renamed after enqueue | List shows the name captured at enqueue time. |
| Queue exceeds page size | No pagination v1; max queue is 100 (existing limit). |
| Page open during full drain | Rows disappear one by one via `trigger_started` events. |

## Test plan

**Unit — `lib/server/trigger-queue.test.ts`:**
- `list()` returns items in order and is a copy.
- `removeByQueueId` removes and emits `trigger_removed`.
- `removeByQueueId` on unknown id returns `{ removed: false }` and emits nothing.
- Remove head before drain starts: drain skips the removed item.

**Route — `app/api/triggers/queue/route.test.ts` (extend) + `app/api/triggers/queue/[queueId]/route.test.ts` (new):**
- GET returns `items` with correct positions; `size`/`head` still present.
- DELETE 204 on existing id; 404 on unknown id; auth gate enforced.

**Component — `app/queue/page.test.tsx` (new):**
- Renders rows from initial fetch.
- Two-step confirm flow; cancel reverts; only one confirming row at a time.
- Optimistic removal on 204; revert on non-204.
- Updates on synthetic SSE events.

**Manual smoke:**
- Start a long-running workflow.
- Webhook-trigger 3 more enqueues.
- Open `/queue`; delete row #2; confirm row #2 disappears and remaining rows renumber.
- Open in two tabs; delete from one; verify the other tab removes the row via SSE.

## Risks

- **Stale workflow snapshot in list.** Mitigation: documented in DTO comment; this matches what will actually run.
- **EventSource churn.** Two `EventSource`s per page (existing `useEngineWebSocket` + the `/queue` listener) is fine — `/api/events` is fanout-friendly. If this becomes a problem, fold the queue listener into `useEngineWebSocket`'s store.
- **Race between drain and delete.** Bounded: drain holds the item in a local after `shift()`, so deletes against that exact `queueId` correctly return 404 and the user sees it via `trigger_started`.

## Out of scope follow-ups

- Bulk Clear all.
- Cancel by workflow.
- Sort/filter by workflow or trigger.
- Cancelling the currently-running engine job.
