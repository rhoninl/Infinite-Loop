'use client';

import { create } from 'zustand';
import type {
  RunStatus,
  Workflow,
  WorkflowEdge,
  WorkflowEvent,
  WorkflowInputDecl,
  WorkflowNode,
  WsStatus,
} from '../shared/workflow';

/** Max snapshots kept in each history stack. Old entries are dropped. */
export const HISTORY_LIMIT = 50;
/** Snapshots arriving within this many ms of the previous push are treated
 * as a continuation of the same interaction (drag/resize/typing) and skipped
 * so one user gesture maps to one undo entry. */
export const HISTORY_COALESCE_MS = 250;

export interface WorkflowStoreState {
  currentWorkflow: Workflow | null;
  isDirty: boolean;
  selectedNodeId: string | null;
  runStatus: RunStatus;
  runEvents: WorkflowEvent[];
  connectionStatus: WsStatus;

  /** Cross-component "pan canvas to this node" signal. `seq` advances on each
   * call so a repeat request for the same node id still fires the canvas
   * effect — without it React would dedupe equal state and the second click
   * would silently no-op. */
  panRequest: { nodeId: string; seq: number } | null;

  /** Past snapshots — the head is the most-recent prior `currentWorkflow`. */
  past: Workflow[];
  /** Future snapshots — populated on undo, cleared on any new mutation. */
  future: Workflow[];

  loadWorkflow: (w: Workflow) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  addNode: (node: WorkflowNode) => void;
  /** Insert `child` into the `children` array of the top-level container
   * with id `parentId`. No-ops if the parent is missing or isn't a container. */
  addChildNode: (parentId: string, child: WorkflowNode) => void;
  updateNode: (id: string, patch: Partial<Omit<WorkflowNode, 'id'>>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  /** Ask the canvas to pan-to-fit the given node. The canvas subscribes to
   * `panRequest` and calls `fitView` whenever the reference changes. */
  requestPanToNode: (id: string) => void;
  /** Replace the current workflow's `globals` map. Pass an empty object
   * to clear all globals. Tracked in undo history. */
  setGlobals: (next: Record<string, string>) => void;
  /** Replace the current workflow's `inputs` array. Pass an empty
   * array to clear all declared inputs. Tracked in undo history. */
  setWorkflowInputs: (next: WorkflowInputDecl[]) => void;
  saveCurrentWorkflow: () => Promise<void>;
  /** Rename the current workflow and immediately persist via PUT. The full
   * workflow body is sent, so any pending edits are flushed alongside the
   * rename — this matches the "save immediately" semantics for inline rename
   * in the top menu. No-op when name is empty/unchanged. */
  renameCurrentWorkflow: (name: string) => Promise<void>;

  /** Restore the previous workflow snapshot. No-op if nothing to undo. */
  undo: () => void;
  /** Re-apply a snapshot popped from the future stack. No-op when empty. */
  redo: () => void;

  appendRunEvent: (ev: WorkflowEvent) => void;
  setRunStatus: (status: RunStatus) => void;
  resetRun: () => void;
  /** Replace the run state in one shot — used when the SSE state_snapshot
   * arrives and we want to rehydrate the log + status after a refresh. */
  hydrateRun: (input: { status: RunStatus; events: WorkflowEvent[] }) => void;
  setConnectionStatus: (s: WsStatus) => void;
}

const bumpUpdated = (w: Workflow): Workflow => ({ ...w, updatedAt: Date.now() });

/** Recursively map every node (top-level and inside `children`). */
function mapNodes(
  nodes: WorkflowNode[],
  fn: (n: WorkflowNode) => WorkflowNode,
): WorkflowNode[] {
  return nodes.map((n) => {
    const next = fn(n);
    if (next.children && next.children.length > 0) {
      return { ...next, children: mapNodes(next.children, fn) };
    }
    return next;
  });
}

/** Returns true if `id` matches any node (top-level or descendant). */
function workflowContainsNode(wf: Workflow, id: string): boolean {
  const stack: WorkflowNode[] = [...wf.nodes];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.id === id) return true;
    if (n.children && n.children.length > 0) stack.push(...n.children);
  }
  return false;
}

/** Recursively filter out a node by id (top-level and inside `children`). */
function filterNodes(nodes: WorkflowNode[], id: string): WorkflowNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) =>
      n.children && n.children.length > 0
        ? { ...n, children: filterNodes(n.children, id) }
        : n,
    );
}

/* ─── on-load geometry normalization ────────────────────────────────────── */
//
// Older workflows were saved before Loops carried a `size` and assumed a
// 460×240 default. The canvas now auto-fits a Loop to its children's bbox so
// xyflow's `extent: 'parent'` doesn't crush them on top of each other — but
// growing a Loop can make it overlap the original sibling layout (e.g. the
// END node sitting just past the old default right edge). We normalize once
// at load time so the in-memory workflow has consistent geometry: the user
// sees no overlap, and the next save persists the corrected positions/size.

const LOOP_DEFAULT_W = 460;
const LOOP_DEFAULT_H = 240;
const NODE_DEFAULT_W = 220;
const NODE_DEFAULT_H = 72;
const LOOP_PAD_LEFT = 24;
const LOOP_PAD_RIGHT = 24;
const LOOP_PAD_TOP = 56;
const LOOP_PAD_BOTTOM = 24;

function loopSizeFromChildren(
  children: WorkflowNode[] | undefined,
): { width: number; height: number } {
  if (!children || children.length === 0) {
    return { width: LOOP_DEFAULT_W, height: LOOP_DEFAULT_H };
  }
  let maxRight = 0;
  let maxBottom = 0;
  for (const c of children) {
    const w = c.size?.width ?? NODE_DEFAULT_W;
    const h = c.size?.height ?? NODE_DEFAULT_H;
    const right = (c.position?.x ?? 0) + w;
    const bottom = (c.position?.y ?? 0) + h;
    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return {
    width: Math.max(LOOP_DEFAULT_W, maxRight + LOOP_PAD_LEFT + LOOP_PAD_RIGHT),
    height: Math.max(LOOP_DEFAULT_H, maxBottom + LOOP_PAD_TOP + LOOP_PAD_BOTTOM),
  };
}

interface Bbox { x: number; y: number; w: number; h: number }

function bboxOf(n: WorkflowNode, defaultW = NODE_DEFAULT_W, defaultH = NODE_DEFAULT_H): Bbox {
  return {
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
    w: n.size?.width ?? defaultW,
    h: n.size?.height ?? defaultH,
  };
}

function rectsOverlap(a: Bbox, b: Bbox): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Pure: returns a workflow whose top-level Loops without a persisted `size`
 * have one computed from their children, and whose top-level non-Loop
 * siblings are pushed horizontally so they no longer sit inside any Loop's
 * (possibly newly-grown) bbox. Other layout details are preserved.
 */
export function normalizeWorkflowGeometry(wf: Workflow): Workflow {
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) return wf;

  // First pass: assign a size to any Loop missing one.
  let touched = false;
  const sized = wf.nodes.map((n) => {
    if (n.type !== 'loop' || n.size) return n;
    touched = true;
    return { ...n, size: loopSizeFromChildren(n.children) } as WorkflowNode;
  });

  // Second pass: push siblings out of every Loop's bbox along the shorter
  // horizontal axis. Vertical pushes can collide with the canvas top/bottom
  // and feel disorienting on load — horizontal-only is the conservative move.
  const loopBoxes = sized
    .filter((n) => n.type === 'loop')
    .map((n) => ({
      id: n.id,
      ...bboxOf(n, LOOP_DEFAULT_W, LOOP_DEFAULT_H),
    }));

  const next = sized.map((n) => {
    if (n.type === 'loop') return n;
    const a = bboxOf(n);
    let { x, y } = { x: a.x, y: a.y };
    let pushed = false;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const lb of loopBoxes) {
        const cur: Bbox = { x, y, w: a.w, h: a.h };
        if (!rectsOverlap(cur, lb)) continue;
        const pushRight = lb.x + lb.w; // candidate's new x sits at the loop's right edge
        const pushLeft = lb.x - a.w;   // candidate's new right-edge sits at the loop's left edge
        const dRight = pushRight - x;
        const dLeft = x - pushLeft;
        x = dLeft <= dRight ? pushLeft : pushRight;
        moved = true;
        pushed = true;
      }
      if (!moved) break;
    }
    if (!pushed) return n;
    touched = true;
    return { ...n, position: { x, y } };
  });

  return touched ? { ...wf, nodes: next } : wf;
}

/**
 * Compute the next history stacks given the workflow we're about to leave
 * behind. Returns a partial state slice; callers spread it into their `set`.
 *
 * Coalescing: if the previous push happened within HISTORY_COALESCE_MS, treat
 * the in-flight gesture (drag, resize, typing) as a continuation and skip the
 * push so one gesture = one undo entry.
 */
function pushPast(
  state: WorkflowStoreState,
  prevWf: Workflow,
): Pick<WorkflowStoreState, 'past' | 'future'> {
  const now = Date.now();
  const coalesced = now - lastHistoryPushAt < HISTORY_COALESCE_MS;
  // Sliding-window: advance the marker on EVERY mutation, including coalesced
  // ones, so a long gesture made of sub-coalesce-window ticks (60fps drag)
  // stays a single history entry instead of fragmenting once the gap from the
  // original push exceeds the window.
  lastHistoryPushAt = now;
  if (coalesced) {
    // Mid-gesture: keep the existing past head as the gesture's anchor, but
    // still wipe the future stack — any further mutation invalidates redo.
    return { past: state.past, future: [] };
  }
  const nextPast = [...state.past, prevWf];
  if (nextPast.length > HISTORY_LIMIT) nextPast.shift();
  return { past: nextPast, future: [] };
}

/**
 * Module-level timestamp of the last accepted history push. Lives outside the
 * store so it isn't subscribed-to by React; it's purely a coalescing marker.
 */
let lastHistoryPushAt = 0;

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  currentWorkflow: null,
  isDirty: false,
  selectedNodeId: null,
  runStatus: 'idle',
  runEvents: [],
  connectionStatus: 'connecting',
  panRequest: null,
  past: [],
  future: [],

  loadWorkflow: (w) => {
    if (!w || !Array.isArray(w.nodes) || !Array.isArray(w.edges)) {
      console.warn('[workflow-store] loadWorkflow rejected malformed input', w);
      return;
    }
    // Loading a different workflow invalidates history — entries describe a
    // different document and shouldn't survive the swap.
    lastHistoryPushAt = 0;
    const normalized = normalizeWorkflowGeometry(w);
    // If normalize materially changed the geometry (e.g. an old workflow with
    // a missing Loop `size` got auto-fitted, or a sibling got pushed out),
    // surface the dirty marker so a save persists the corrected layout. Next
    // load is a no-op then — the bug stops re-occurring per workflow file.
    const wasMutated = normalized !== w;
    set({
      currentWorkflow: normalized,
      isDirty: wasMutated,
      selectedNodeId: null,
      past: [],
      future: [],
    });
  },

  setNodes: (nodes) =>
    set((s) => {
      if (!s.currentWorkflow) return {};
      return {
        currentWorkflow: bumpUpdated({ ...s.currentWorkflow, nodes }),
        isDirty: true,
        ...pushPast(s, s.currentWorkflow),
      };
    }),

  setEdges: (edges) =>
    set((s) => {
      if (!s.currentWorkflow) return {};
      return {
        currentWorkflow: bumpUpdated({ ...s.currentWorkflow, edges }),
        isDirty: true,
        ...pushPast(s, s.currentWorkflow),
      };
    }),

  addNode: (node) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      return {
        currentWorkflow: bumpUpdated({ ...wf, nodes: [...wf.nodes, node] }),
        isDirty: true,
        ...pushPast(s, wf),
      };
    }),

  addChildNode: (parentId, child) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      const nextNodes = wf.nodes.map((n) => {
        if (n.id !== parentId) return n;
        const existing = Array.isArray(n.children) ? n.children : [];
        return { ...n, children: [...existing, child] };
      });
      return {
        currentWorkflow: bumpUpdated({ ...wf, nodes: nextNodes }),
        isDirty: true,
        ...pushPast(s, wf),
      };
    }),

  updateNode: (id, patch) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      return {
        currentWorkflow: bumpUpdated({
          ...wf,
          nodes: mapNodes(wf.nodes, (n) =>
            n.id === id ? ({ ...n, ...patch } as WorkflowNode) : n,
          ),
        }),
        isDirty: true,
        ...pushPast(s, wf),
      };
    }),

  removeNode: (id) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      return {
        currentWorkflow: bumpUpdated({
          ...wf,
          nodes: filterNodes(wf.nodes, id),
          edges: wf.edges.filter((e) => e.source !== id && e.target !== id),
        }),
        isDirty: true,
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        ...pushPast(s, wf),
      };
    }),

  addEdge: (edge) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      return {
        currentWorkflow: bumpUpdated({ ...wf, edges: [...wf.edges, edge] }),
        isDirty: true,
        ...pushPast(s, wf),
      };
    }),

  removeEdge: (id) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      return {
        currentWorkflow: bumpUpdated({
          ...wf,
          edges: wf.edges.filter((e) => e.id !== id),
        }),
        isDirty: true,
        ...pushPast(s, wf),
      };
    }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0 || !s.currentWorkflow) return {};
      const prev = s.past[s.past.length - 1];
      const nextPast = s.past.slice(0, -1);
      // Reset coalesce marker so the next mutation lands as a fresh entry,
      // not a continuation of whatever happened before the undo.
      lastHistoryPushAt = 0;
      return {
        currentWorkflow: prev,
        past: nextPast,
        future: [...s.future, s.currentWorkflow],
        isDirty: true,
        // Drop selection if it points at a node that no longer exists in
        // the restored snapshot.
        selectedNodeId:
          s.selectedNodeId &&
          !workflowContainsNode(prev, s.selectedNodeId)
            ? null
            : s.selectedNodeId,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0 || !s.currentWorkflow) return {};
      const next = s.future[s.future.length - 1];
      const nextFuture = s.future.slice(0, -1);
      lastHistoryPushAt = 0;
      return {
        currentWorkflow: next,
        past: [...s.past, s.currentWorkflow],
        future: nextFuture,
        isDirty: true,
        selectedNodeId:
          s.selectedNodeId &&
          !workflowContainsNode(next, s.selectedNodeId)
            ? null
            : s.selectedNodeId,
      };
    }),

  selectNode: (id) => set({ selectedNodeId: id }),

  requestPanToNode: (id) =>
    set((s) => ({
      panRequest: { nodeId: id, seq: (s.panRequest?.seq ?? 0) + 1 },
    })),

  setGlobals: (next) =>
    set((s) => {
      if (!s.currentWorkflow) return {};
      return {
        currentWorkflow: bumpUpdated({ ...s.currentWorkflow, globals: next }),
        isDirty: true,
        ...pushPast(s, s.currentWorkflow),
      };
    }),

  setWorkflowInputs: (next) =>
    set((s) => {
      if (!s.currentWorkflow) return {};
      return {
        currentWorkflow: bumpUpdated({ ...s.currentWorkflow, inputs: next }),
        isDirty: true,
        ...pushPast(s, s.currentWorkflow),
      };
    }),

  saveCurrentWorkflow: async () => {
    const wf = get().currentWorkflow;
    if (!wf) return;
    const res = await fetch(`/api/workflows/${encodeURIComponent(wf.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(wf),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    set({ isDirty: false });
  },

  renameCurrentWorkflow: async (name) => {
    const wf = get().currentWorkflow;
    if (!wf) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === wf.name) return;
    const next: Workflow = { ...wf, name: trimmed, updatedAt: Date.now() };
    // Optimistic update + dirty marker. If the PUT fails the dirty flag
    // stays on so the user sees "•" and can retry via Save.
    set((s) => ({
      currentWorkflow: next,
      isDirty: true,
      ...pushPast(s, wf),
    }));
    const res = await fetch(`/api/workflows/${encodeURIComponent(next.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`rename failed: ${res.status}`);
    set({ isDirty: false });
  },

  appendRunEvent: (ev) =>
    set((s) => {
      // `run_started` marks a fresh run boundary — drop the previous run's
      // events so the panel only shows the latest run. Without this the log
      // accumulates across runs and "the new run starts" gets lost in the
      // tail of the old one.
      const baseEvents = ev.type === 'run_started' ? [] : s.runEvents;
      const next: Partial<WorkflowStoreState> = {
        runEvents: [...baseEvents, ev],
      };
      if (ev.type === 'run_started') next.runStatus = 'running';
      if (ev.type === 'run_finished') next.runStatus = ev.status;
      return next as WorkflowStoreState;
    }),

  setRunStatus: (runStatus) => set({ runStatus }),

  resetRun: () => set({ runEvents: [], runStatus: 'idle' }),

  hydrateRun: ({ status, events }) =>
    set({ runStatus: status, runEvents: [...events] }),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));
