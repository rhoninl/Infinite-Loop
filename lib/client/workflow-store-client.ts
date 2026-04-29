'use client';

import { create } from 'zustand';
import type {
  RunStatus,
  Workflow,
  WorkflowEdge,
  WorkflowEvent,
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
  saveCurrentWorkflow: () => Promise<void>;

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
    set({
      currentWorkflow: w,
      isDirty: false,
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

  appendRunEvent: (ev) =>
    set((s) => {
      const next: Partial<WorkflowStoreState> = {
        runEvents: [...s.runEvents, ev],
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
