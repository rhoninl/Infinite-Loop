# /queue page + per-item cancel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/queue` page that lists every queued trigger run and lets the user cancel any single item via an inline two-step confirm.

**Architecture:** Extend the in-memory `TriggerQueue` (already a singleton on `globalThis`) with `list()` and `removeByQueueId()`. Surface the list through the existing `GET /api/triggers/queue` (additive `items` field) and add `DELETE /api/triggers/queue/[queueId]`. A new `trigger_removed` event flows over the existing SSE bus so the page (and any other tab) updates live. The page is a Next.js client component that does an initial fetch and opens its own `EventSource('/api/events')`.

**Tech Stack:** Next.js App Router, React 18 client components, Bun test runner, `@testing-library/react`, semantic CSS classes in `app/globals.css` (no HeroUI, no inline styles).

**Spec:** `specs/queue-list-page.md`

---

## File map

**Modify:**
- `lib/shared/workflow.ts` — add `TriggerRemovedEvent`, extend the `WorkflowEvent` union.
- `lib/server/trigger-queue.ts` — add `list()` and `removeByQueueId()`.
- `lib/server/trigger-queue.test.ts` — tests for the two new methods.
- `lib/client/ws-client.ts` — add `'trigger_removed'` to `VALID_EVENT_TYPES`.
- `app/api/triggers/queue/route.ts` — include `items` in the GET response.
- `app/api/triggers/queue/route.test.ts` — assert `items` shape.
- `app/page.tsx` — wrap `QueueBadge` in `<Link href="/queue">` and add a persistent "Queue" link in the topbar `.actions`.
- `app/globals.css` — add `.queue-page`, `.queue-table`, `.queue-row` styles in the section after the existing QueueBadge block.

**Create:**
- `app/api/triggers/queue/[queueId]/route.ts` — DELETE handler.
- `app/api/triggers/queue/[queueId]/route.test.ts` — unit tests for DELETE.
- `app/queue/page.tsx` — the page component.
- `app/queue/page.test.tsx` — page tests.

---

## Task 1: Add `trigger_removed` to the event type union

**Files:**
- Modify: `lib/shared/workflow.ts:384-422`
- Modify: `lib/client/ws-client.ts:7-19`

This task is type-system-only. There's no behavior to test yet — Task 3 is the first test that asserts the emit. We commit the type changes here so subsequent tasks compile cleanly.

- [ ] **Step 1: Add `TriggerRemovedEvent` interface and include it in the union**

In `lib/shared/workflow.ts`, after the existing `TriggerDroppedEvent` (around line 389) add:

```ts
export interface TriggerRemovedEvent {
  type: 'trigger_removed';
  queueId: string;
  triggerId: string;
  workflowId: string;
  reason: 'user-cancelled';
}
```

Then extend the `WorkflowEvent` union (around line 391) to include `| TriggerRemovedEvent` alongside the other trigger events.

- [ ] **Step 2: Add the discriminator to the client allowlist**

In `lib/client/ws-client.ts`, extend `VALID_EVENT_TYPES` (line 7) to include `'trigger_removed'`:

```ts
const VALID_EVENT_TYPES = new Set<WorkflowEvent['type']>([
  'run_started',
  'node_started',
  'node_finished',
  'stdout_chunk',
  'condition_checked',
  'template_warning',
  'error',
  'run_finished',
  'trigger_enqueued',
  'trigger_started',
  'trigger_dropped',
  'trigger_removed',
]);
```

- [ ] **Step 3: Verify it compiles**

Run: `bun run tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/shared/workflow.ts lib/client/ws-client.ts
git commit -m "feat(queue): add trigger_removed event type"
```

---

## Task 2: `TriggerQueue.list()`

**Files:**
- Modify: `lib/server/trigger-queue.ts:45-47`
- Test: `lib/server/trigger-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/server/trigger-queue.test.ts` inside the existing `describe('TriggerQueue', ...)` block:

```ts
test('list returns items in order as a copy', () => {
  const a = q.enqueue({
    workflow: fakeWorkflow('w1'), resolvedInputs: {},
    triggerId: 't1', receivedAt: 1,
  });
  const b = q.enqueue({
    workflow: fakeWorkflow('w2'), resolvedInputs: {},
    triggerId: 't2', receivedAt: 2,
  });

  const items = q.list();
  expect(items.map((i) => i.queueId)).toEqual([a.queueId, b.queueId]);
  expect(items.map((i) => i.workflow.id)).toEqual(['w1', 'w2']);

  // mutating the returned array must not affect internal state
  items.pop();
  expect(q.size()).toBe(2);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test lib/server/trigger-queue.test.ts -t "list returns items in order as a copy"`
Expected: FAIL — `q.list is not a function`.

- [ ] **Step 3: Implement `list()`**

In `lib/server/trigger-queue.ts`, add after the existing `peek()` method (line 47):

```ts
  list(): QueuedRun[] {
    return [...this.q];
  }
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test lib/server/trigger-queue.test.ts -t "list returns items in order as a copy"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/trigger-queue.ts lib/server/trigger-queue.test.ts
git commit -m "feat(queue): add TriggerQueue.list()"
```

---

## Task 3: `TriggerQueue.removeByQueueId()` + event emission

**Files:**
- Modify: `lib/server/trigger-queue.ts`
- Test: `lib/server/trigger-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/server/trigger-queue.test.ts` inside the existing `describe('TriggerQueue', ...)` block. We'll need access to the event bus; import it at the top of the file:

```ts
import { eventBus } from './event-bus';
import type { WorkflowEvent } from '../shared/workflow';
```

Then add the tests:

```ts
test('removeByQueueId removes the matching item and emits trigger_removed', () => {
  const captured: WorkflowEvent[] = [];
  const unsub = eventBus.subscribe((e) => { captured.push(e); });
  try {
    const a = q.enqueue({
      workflow: fakeWorkflow('w1'), resolvedInputs: {},
      triggerId: 't1', receivedAt: 1,
    });
    const b = q.enqueue({
      workflow: fakeWorkflow('w2'), resolvedInputs: {},
      triggerId: 't2', receivedAt: 2,
    });

    const result = q.removeByQueueId(a.queueId);
    expect(result).toEqual({ removed: true });
    expect(q.list().map((i) => i.queueId)).toEqual([b.queueId]);

    const removed = captured.find((e) => e.type === 'trigger_removed');
    expect(removed).toEqual({
      type: 'trigger_removed',
      queueId: a.queueId,
      triggerId: 't1',
      workflowId: 'w1',
      reason: 'user-cancelled',
    });
  } finally {
    unsub();
  }
});

test('removeByQueueId on unknown id returns { removed: false } and emits nothing', () => {
  const captured: WorkflowEvent[] = [];
  const unsub = eventBus.subscribe((e) => { captured.push(e); });
  try {
    q.enqueue({
      workflow: fakeWorkflow('w'), resolvedInputs: {},
      triggerId: 't', receivedAt: 1,
    });
    const before = captured.length;

    const result = q.removeByQueueId('q-does-not-exist');
    expect(result).toEqual({ removed: false });
    expect(q.size()).toBe(1);
    expect(captured.length).toBe(before);
  } finally {
    unsub();
  }
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `bun test lib/server/trigger-queue.test.ts -t "removeByQueueId"`
Expected: FAIL — `q.removeByQueueId is not a function`.

- [ ] **Step 3: Implement `removeByQueueId()`**

In `lib/server/trigger-queue.ts`, add after the new `list()` method:

```ts
  removeByQueueId(queueId: string): { removed: boolean } {
    const idx = this.q.findIndex((item) => item.queueId === queueId);
    if (idx === -1) return { removed: false };
    const [item] = this.q.splice(idx, 1);
    eventBus.emit({
      type: 'trigger_removed',
      queueId: item.queueId,
      triggerId: item.triggerId,
      workflowId: item.workflow.id,
      reason: 'user-cancelled',
    });
    return { removed: true };
  }
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `bun test lib/server/trigger-queue.test.ts -t "removeByQueueId"`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full TriggerQueue test file**

Run: `bun test lib/server/trigger-queue.test.ts`
Expected: all pre-existing tests still pass alongside the new ones.

- [ ] **Step 6: Commit**

```bash
git add lib/server/trigger-queue.ts lib/server/trigger-queue.test.ts
git commit -m "feat(queue): add TriggerQueue.removeByQueueId() with trigger_removed event"
```

---

## Task 4: Extend `GET /api/triggers/queue` to include `items`

**Files:**
- Modify: `app/api/triggers/queue/route.ts`
- Test: `app/api/triggers/queue/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/api/triggers/queue/route.test.ts` inside the existing `describe(...)`:

```ts
test('returns items array with positions and workflow names', async () => {
  triggerQueue.enqueue({
    workflow: { id: 'w1', name: 'First', version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any,
    resolvedInputs: {},
    triggerId: 'trig-1',
    receivedAt: 100,
  });
  triggerQueue.enqueue({
    workflow: { id: 'w2', name: 'Second', version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any,
    resolvedInputs: {},
    triggerId: 'trig-2',
    receivedAt: 200,
  });

  const res = await GET(new Request('http://test/api/triggers/queue'));
  const json = await res.json();

  expect(json.size).toBe(2);
  expect(Array.isArray(json.items)).toBe(true);
  expect(json.items).toHaveLength(2);
  expect(json.items[0]).toMatchObject({
    triggerId: 'trig-1',
    workflowId: 'w1',
    workflowName: 'First',
    receivedAt: 100,
    position: 1,
  });
  expect(json.items[1]).toMatchObject({
    triggerId: 'trig-2',
    workflowId: 'w2',
    workflowName: 'Second',
    position: 2,
  });
  // Each item also has a queueId
  expect(typeof json.items[0].queueId).toBe('string');
});

test('empty queue returns items: []', async () => {
  const res = await GET(new Request('http://test/api/triggers/queue'));
  const json = await res.json();
  expect(json.items).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test app/api/triggers/queue/route.test.ts`
Expected: FAIL — `items` undefined on response.

- [ ] **Step 3: Implement the change**

Replace the body of `app/api/triggers/queue/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;

  const all = triggerQueue.list();
  const head = all[0];
  const items = all.map((item, idx) => ({
    queueId: item.queueId,
    triggerId: item.triggerId,
    workflowId: item.workflow.id,
    workflowName: item.workflow.name,
    receivedAt: item.receivedAt,
    position: idx + 1,
  }));

  return NextResponse.json({
    size: all.length,
    head: head
      ? { triggerId: head.triggerId, workflowId: head.workflow.id, position: 1 }
      : undefined,
    items,
  });
}
```

- [ ] **Step 4: Run the test file and verify all pass**

Run: `bun test app/api/triggers/queue/route.test.ts`
Expected: PASS (existing `size 0` + `head when non-empty` + the two new tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/triggers/queue/route.ts app/api/triggers/queue/route.test.ts
git commit -m "feat(queue): include items array in GET /api/triggers/queue"
```

---

## Task 5: `DELETE /api/triggers/queue/[queueId]`

**Files:**
- Create: `app/api/triggers/queue/[queueId]/route.ts`
- Create: `app/api/triggers/queue/[queueId]/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/triggers/queue/[queueId]/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DELETE } from './route';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

beforeEach(() => triggerQueue.clear());
afterEach(() => triggerQueue.clear());

function fakeWorkflow(id: string) {
  return { id, name: id, version: 1, nodes: [], edges: [], createdAt: 0, updatedAt: 0 } as any;
}

describe('DELETE /api/triggers/queue/[queueId]', () => {
  test('returns 204 and removes the item when it exists', async () => {
    const { queueId } = triggerQueue.enqueue({
      workflow: fakeWorkflow('w'),
      resolvedInputs: {},
      triggerId: 't',
      receivedAt: 1,
    });
    expect(triggerQueue.size()).toBe(1);

    const req = new Request(`http://test/api/triggers/queue/${queueId}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ queueId }) });

    expect(res.status).toBe(204);
    expect(triggerQueue.size()).toBe(0);
  });

  test('returns 404 with not-in-queue when the id is unknown', async () => {
    const queueId = 'q-nope';
    const req = new Request(`http://test/api/triggers/queue/${queueId}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ queueId }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('not-in-queue');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test app/api/triggers/queue/[queueId]/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the route handler**

Create `app/api/triggers/queue/[queueId]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ queueId: string }> },
): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;

  const { queueId } = await params;
  const { removed } = triggerQueue.removeByQueueId(queueId);
  if (!removed) {
    return NextResponse.json({ error: 'not-in-queue' }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test app/api/triggers/queue/[queueId]/route.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/triggers/queue/[queueId]/route.ts app/api/triggers/queue/[queueId]/route.test.ts
git commit -m "feat(queue): DELETE /api/triggers/queue/[queueId]"
```

---

## Task 6: `/queue` page — initial fetch and table render

**Files:**
- Create: `app/queue/page.tsx`
- Create: `app/queue/page.test.tsx`

This task just renders rows from a fetched response. Confirm UI and SSE come in later tasks. We give the page a stable internal state so later tasks can layer onto it.

- [ ] **Step 1: Write the failing test**

Create `app/queue/page.test.tsx`:

```tsx
import { afterEach, describe, expect, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import QueuePage from './page';

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() { this.closed = true; }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function installFakes(payload: unknown) {
  FakeEventSource.instances = [];
  // @ts-expect-error override
  globalThis.fetch = async (input: any, init?: any) => {
    if (init?.method === 'DELETE') {
      return { ok: true, status: 204, json: async () => ({}) } as any;
    }
    return { ok: true, status: 200, json: async () => payload } as any;
  };
  // @ts-expect-error override
  globalThis.EventSource = FakeEventSource;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
});

describe('QueuePage', () => {
  test('renders an empty state when there are no items', async () => {
    installFakes({ size: 0, items: [] });
    render(<QueuePage />);
    await waitFor(() => {
      expect(screen.getByText(/no queued runs/i)).toBeTruthy();
    });
  });

  test('renders one row per item with workflow name and position', async () => {
    installFakes({
      size: 2,
      items: [
        { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
        { queueId: 'q-2', triggerId: 't2', workflowId: 'w2', workflowName: 'Second', receivedAt: 200, position: 2 },
      ],
    });
    render(<QueuePage />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
    });

    const rows = document.querySelectorAll('.queue-row');
    expect(rows.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test app/queue/page.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the page**

Create `app/queue/page.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';

interface QueueItem {
  queueId: string;
  triggerId: string;
  workflowId: string;
  workflowName: string;
  receivedAt: number;
  position: number;
}

interface QueueResponse {
  size: number;
  items: QueueItem[];
}

function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString();
}

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/triggers/queue');
        if (!res.ok) return;
        const json = (await res.json()) as QueueResponse;
        if (alive) {
          setItems(json.items ?? []);
          setLoaded(true);
        }
      } catch {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <main className="queue-page">
      <header className="queue-page-header">
        <h1>Trigger Queue</h1>
        <span className="queue-count">{items.length} queued</span>
      </header>

      {loaded && items.length === 0 ? (
        <p className="queue-empty">No queued runs.</p>
      ) : (
        <table className="queue-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Workflow</th>
              <th>Trigger</th>
              <th>Queued at</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.queueId} className="queue-row">
                <td>{idx + 1}</td>
                <td>{it.workflowName}</td>
                <td>{it.triggerId}</td>
                <td>{formatTime(it.receivedAt)}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test app/queue/page.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add app/queue/page.tsx app/queue/page.test.tsx
git commit -m "feat(queue): /queue page with initial fetch and row render"
```

---

## Task 7: `/queue` page — inline two-step confirm + delete

**Files:**
- Modify: `app/queue/page.tsx`
- Modify: `app/queue/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `app/queue/page.test.tsx` inside the existing `describe('QueuePage', ...)`. Add this import at the top of the file:

```tsx
import { fireEvent } from '@testing-library/react';
```

Then add:

```tsx
test('shows Confirm/Cancel after clicking Delete; Cancel reverts', async () => {
  installFakes({
    size: 1,
    items: [
      { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
    ],
  });
  render(<QueuePage />);
  await waitFor(() => screen.getByText('First'));

  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(screen.getByRole('button', { name: /confirm\?/i })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
});

test('clicking Confirm calls DELETE and optimistically removes the row', async () => {
  installFakes({
    size: 1,
    items: [
      { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
    ],
  });
  const calls: Array<{ url: string; method?: string }> = [];
  const fakeFetch = async (input: any, init?: any) => {
    calls.push({ url: String(input), method: init?.method });
    if (init?.method === 'DELETE') {
      return { ok: true, status: 204, json: async () => ({}) } as any;
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        size: 1,
        items: [
          { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
        ],
      }),
    } as any;
  };
  // @ts-expect-error override
  globalThis.fetch = fakeFetch;

  render(<QueuePage />);
  await waitFor(() => screen.getByText('First'));

  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm\?/i }));

  await waitFor(() => {
    expect(screen.queryByText('First')).toBeNull();
  });
  expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/triggers/queue/q-1'))).toBe(true);
});

test('clicking Delete on another row reverts the first', async () => {
  installFakes({
    size: 2,
    items: [
      { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
      { queueId: 'q-2', triggerId: 't2', workflowId: 'w2', workflowName: 'Second', receivedAt: 200, position: 2 },
    ],
  });
  render(<QueuePage />);
  await waitFor(() => screen.getByText('First'));

  const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
  fireEvent.click(deleteButtons[0]);
  expect(screen.getAllByRole('button', { name: /confirm\?/i }).length).toBe(1);

  // click Delete on the second row
  const stillDelete = screen.getAllByRole('button', { name: /delete/i });
  fireEvent.click(stillDelete[0]); // the only remaining "Delete" — row 2
  // exactly one row is confirming again
  expect(screen.getAllByRole('button', { name: /confirm\?/i }).length).toBe(1);
  // first row is back to "Delete"
  const finalDeletes = screen.getAllByRole('button', { name: /delete/i });
  expect(finalDeletes.length).toBe(1); // row 1's button reverted; row 2 is now in confirm
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `bun test app/queue/page.test.tsx -t "Confirm"`
Expected: FAIL — no Delete button rendered.

- [ ] **Step 3: Implement the confirm UX**

Replace the body of `app/queue/page.tsx` with:

```tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface QueueItem {
  queueId: string;
  triggerId: string;
  workflowId: string;
  workflowName: string;
  receivedAt: number;
  position: number;
}

interface QueueResponse {
  size: number;
  items: QueueItem[];
}

function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString();
}

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/triggers/queue');
        if (!res.ok) return;
        const json = (await res.json()) as QueueResponse;
        if (alive) {
          setItems(json.items ?? []);
          setLoaded(true);
        }
      } catch {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const startConfirm = useCallback((queueId: string) => {
    setConfirming(queueId);
  }, []);

  const cancelConfirm = useCallback(() => {
    setConfirming(null);
  }, []);

  const doDelete = useCallback(async (queueId: string) => {
    setItems((prev) => prev.filter((it) => it.queueId !== queueId));
    setConfirming(null);
    try {
      await fetch(`/api/triggers/queue/${queueId}`, { method: 'DELETE' });
    } catch {
      // SSE will re-sync on reconnect; not retrying.
    }
  }, []);

  return (
    <main className="queue-page">
      <header className="queue-page-header">
        <h1>Trigger Queue</h1>
        <span className="queue-count">{items.length} queued</span>
      </header>

      {loaded && items.length === 0 ? (
        <p className="queue-empty">No queued runs.</p>
      ) : (
        <table className="queue-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Workflow</th>
              <th>Trigger</th>
              <th>Queued at</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const isConfirming = confirming === it.queueId;
              return (
                <tr
                  key={it.queueId}
                  className="queue-row"
                  data-confirming={isConfirming || undefined}
                >
                  <td>{idx + 1}</td>
                  <td>{it.workflowName}</td>
                  <td>{it.triggerId}</td>
                  <td>{formatTime(it.receivedAt)}</td>
                  <td className="queue-row-actions">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-stop"
                          onClick={() => doDelete(it.queueId)}
                        >
                          Confirm?
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={cancelConfirm}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => startConfirm(it.queueId)}
                      >
                        ✕ Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `bun test app/queue/page.test.tsx`
Expected: PASS (all tests including the earlier ones).

- [ ] **Step 5: Commit**

```bash
git add app/queue/page.tsx app/queue/page.test.tsx
git commit -m "feat(queue): inline two-step confirm + optimistic delete"
```

---

## Task 8: `/queue` page — live SSE updates

**Files:**
- Modify: `app/queue/page.tsx`
- Modify: `app/queue/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `app/queue/page.test.tsx` inside the existing `describe('QueuePage', ...)`:

```tsx
import { act } from '@testing-library/react';
```

```tsx
test('appends a row when trigger_enqueued event arrives', async () => {
  installFakes({
    size: 0,
    items: [],
  });
  render(<QueuePage />);
  await waitFor(() => screen.getByText(/no queued runs/i));

  const es = FakeEventSource.instances[0];
  expect(es).toBeTruthy();
  act(() => {
    es.emit({
      type: 'trigger_enqueued',
      queueId: 'q-new',
      triggerId: 't-new',
      workflowId: 'w-new',
      position: 1,
      receivedAt: 500,
    });
  });

  await waitFor(() => {
    expect(document.querySelectorAll('.queue-row').length).toBe(1);
  });
});

test('removes a row when trigger_started / trigger_dropped / trigger_removed arrives', async () => {
  installFakes({
    size: 1,
    items: [
      { queueId: 'q-1', triggerId: 't1', workflowId: 'w1', workflowName: 'First', receivedAt: 100, position: 1 },
    ],
  });
  render(<QueuePage />);
  await waitFor(() => screen.getByText('First'));

  const es = FakeEventSource.instances[0];
  act(() => {
    es.emit({
      type: 'trigger_started',
      queueId: 'q-1',
      triggerId: 't1',
      workflowId: 'w1',
      runId: 'run-1',
    });
  });

  await waitFor(() => {
    expect(screen.queryByText('First')).toBeNull();
  });
});

test('closes the EventSource on unmount', async () => {
  installFakes({ size: 0, items: [] });
  const { unmount } = render(<QueuePage />);
  await waitFor(() => screen.getByText(/no queued runs/i));

  const es = FakeEventSource.instances[0];
  unmount();
  expect(es.closed).toBe(true);
});
```

(Note: the `trigger_enqueued` event from the server does not carry `workflowName`. The page derives the name lazily — see step 3.)

- [ ] **Step 2: Run the tests and verify they fail**

Run: `bun test app/queue/page.test.tsx -t "trigger_"`
Expected: FAIL — no EventSource created / no event handling.

- [ ] **Step 3: Add SSE subscription**

In `app/queue/page.tsx`, add a second `useEffect` after the initial-fetch effect. Inside the component before the `return`:

```tsx
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      try {
        const data = JSON.parse(e.data);
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
        const t = data.type as string;

        if (t === 'trigger_enqueued') {
          setItems((prev) => {
            if (prev.some((it) => it.queueId === data.queueId)) return prev;
            return [
              ...prev,
              {
                queueId: data.queueId,
                triggerId: data.triggerId,
                workflowId: data.workflowId,
                workflowName: data.workflowId, // refined by next refetch / page reload
                receivedAt: data.receivedAt,
                position: prev.length + 1,
              },
            ];
          });
          return;
        }

        if (t === 'trigger_started' || t === 'trigger_dropped' || t === 'trigger_removed') {
          setItems((prev) => prev.filter((it) => it.queueId !== data.queueId));
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => { es.close(); };
  }, []);
```

- [ ] **Step 4: Run the page tests and verify they pass**

Run: `bun test app/queue/page.test.tsx`
Expected: PASS (all eight tests).

- [ ] **Step 5: Commit**

```bash
git add app/queue/page.tsx app/queue/page.test.tsx
git commit -m "feat(queue): live SSE updates for /queue page"
```

---

## Task 9: CSS for `/queue` page

**Files:**
- Modify: `app/globals.css` (append after the existing QueueBadge block near line 3360)

- [ ] **Step 1: Append the styles**

After the existing QueueBadge block (which ends shortly after line 3342) append:

```css
/* ─── /queue page (queue-page) ────────────────────────────────────
 * Trigger queue listing with per-row delete and inline two-step
 * confirm. Reuses .btn / .btn-stop / .btn-ghost from the topbar. */
.queue-page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-6, 24px);
  color: var(--fg);
}

.queue-page-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4, 16px);
  margin-bottom: var(--space-5, 20px);
}

.queue-page-header h1 {
  margin: 0;
  font-size: var(--font-size-h1, 24px);
}

.queue-count {
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.queue-empty {
  color: var(--fg-muted);
  padding: var(--space-6, 24px) 0;
  text-align: center;
}

.queue-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-body, 14px);
}

.queue-table th,
.queue-table td {
  padding: var(--space-3, 12px) var(--space-4, 16px);
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.queue-table th {
  color: var(--fg-muted);
  font-weight: var(--font-weight-medium, 500);
}

.queue-row[data-confirming='true'] {
  background: var(--bg-danger-soft, rgba(255, 80, 80, 0.06));
}

.queue-row-actions {
  text-align: right;
  white-space: nowrap;
}

.queue-row-actions .btn + .btn {
  margin-left: var(--space-2, 8px);
}
```

(The CSS uses repo design tokens — `--fg`, `--fg-muted`, `--border`, `--bg-danger-soft`, `--space-*`. If a token isn't defined in the file, the fallback after the comma is used. Verify quickly by searching `app/globals.css` for `--bg-danger-soft`; if missing, the fallback `rgba(255, 80, 80, 0.06)` still renders correctly.)

- [ ] **Step 2: Visual sanity check**

Run: `bun run dev` (or however the dev server is started in this repo — check `package.json` `scripts`).
Open `http://localhost:3000/queue`. With an empty queue you should see "No queued runs."; with items you should see a styled table. (Detailed manual smoke is in Task 11.)

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(queue): styles for /queue page"
```

---

## Task 10: Topbar — make `QueueBadge` clickable + persistent Queue link

**Files:**
- Modify: `app/page.tsx:211-221`
- Modify: `app/components/QueueBadge.tsx`

We wrap the badge in a `Link` (so size-> 0 still hides it, but when it shows it routes to `/queue`) and add a separate persistent `Queue` link in the `.actions` row.

- [ ] **Step 1: Update `QueueBadge` to wrap its content in a Link**

Replace the body of `app/components/QueueBadge.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export interface QueueBadgeProps {
  /** Poll interval; default 3000 ms. */
  pollMs?: number;
}

export function QueueBadge({ pollMs = 3000 }: QueueBadgeProps) {
  const [size, setSize] = useState(0);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const res = await fetch('/api/triggers/queue');
        if (!res.ok) return;
        const json = (await res.json()) as { size: number };
        if (alive) setSize(json.size);
      } catch {
        /* ignore */
      }
    }

    void tick();
    const handle = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [pollMs]);

  if (size === 0) return null;

  return (
    <Link href="/queue" className="queue-badge">
      {size} queued
    </Link>
  );
}
```

- [ ] **Step 2: Verify the existing QueueBadge test still passes**

Run: `bun test app/components/QueueBadge.test.tsx`
Expected: PASS — `screen.getByText(/3 queued/i)` still matches inside the Link.

- [ ] **Step 3: Add a persistent Queue link in the topbar**

In `app/page.tsx`, find the block around line 220 where `<QueueBadge />` is rendered. Add an import at the top of the file alongside other imports:

```tsx
import Link from 'next/link';
```

(Skip if already imported — check before adding.)

Then replace the `<QueueBadge />` line with:

```tsx
          <Link href="/queue" className="btn btn-ghost">Queue</Link>
          <QueueBadge />
```

- [ ] **Step 4: Sanity check — typecheck and existing tests**

Run: `bun run tsc --noEmit && bun test app/components/QueueBadge.test.tsx`
Expected: typecheck passes; QueueBadge test passes.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/components/QueueBadge.tsx
git commit -m "feat(queue): topbar Queue link + clickable QueueBadge"
```

---

## Task 11: Full test sweep + manual smoke

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all tests pass, including the new ones from Tasks 2, 3, 4, 5, 6, 7, 8 plus all pre-existing ones.

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual smoke — empty queue**

Start the dev server (`bun run dev` or per `package.json`). Visit `http://localhost:3000/queue`.
Expected: page renders, shows "No queued runs." `Queue` link in topbar is always visible; `QueueBadge` is hidden.

- [ ] **Step 4: Manual smoke — populated queue with cancel**

In a separate terminal, run a long-lived workflow so the engine is busy. Then enqueue three additional runs (via a webhook trigger or the existing test-fire flow — pick whatever's easiest in this repo).

Then on `/queue`:
1. Confirm three rows are visible, positions 1–3.
2. Click `✕ Delete` on row #2 — `Confirm?` and `Cancel` appear.
3. Click `Cancel` — row reverts.
4. Click `✕ Delete` on row #2 again, then `Confirm?` — row disappears, remaining rows renumber to 1, 2.
5. Open `/queue` in a second tab and delete a row in tab A — verify tab B removes the row via SSE within ~1 s.

- [ ] **Step 5: Mark plan complete**

If all checks pass, the feature is shippable. Commit any final manual notes if needed; otherwise no further commits required.

---

## Out of scope

- Bulk Clear all.
- Cancel by workflow.
- Sort / filter / search.
- Cancelling an in-flight engine run.
- Pagination (the underlying queue caps at 100).
