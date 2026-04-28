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

export interface WorkflowStoreState {
  currentWorkflow: Workflow | null;
  isDirty: boolean;
  selectedNodeId: string | null;
  runStatus: RunStatus;
  runEvents: WorkflowEvent[];
  connectionStatus: WsStatus;

  loadWorkflow: (w: Workflow) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, patch: Partial<Omit<WorkflowNode, 'id'>>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  saveCurrentWorkflow: () => Promise<void>;

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

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  currentWorkflow: null,
  isDirty: false,
  selectedNodeId: null,
  runStatus: 'idle',
  runEvents: [],
  connectionStatus: 'connecting',

  loadWorkflow: (w) => {
    if (!w || !Array.isArray(w.nodes) || !Array.isArray(w.edges)) {
      console.warn('[workflow-store] loadWorkflow rejected malformed input', w);
      return;
    }
    set({ currentWorkflow: w, isDirty: false, selectedNodeId: null });
  },

  setNodes: (nodes) =>
    set((s) =>
      s.currentWorkflow
        ? { currentWorkflow: bumpUpdated({ ...s.currentWorkflow, nodes }), isDirty: true }
        : {},
    ),

  setEdges: (edges) =>
    set((s) =>
      s.currentWorkflow
        ? { currentWorkflow: bumpUpdated({ ...s.currentWorkflow, edges }), isDirty: true }
        : {},
    ),

  addNode: (node) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      return {
        currentWorkflow: bumpUpdated({ ...wf, nodes: [...wf.nodes, node] }),
        isDirty: true,
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
      };
    }),

  addEdge: (edge) =>
    set((s) => {
      const wf = s.currentWorkflow;
      if (!wf) return {};
      return {
        currentWorkflow: bumpUpdated({ ...wf, edges: [...wf.edges, edge] }),
        isDirty: true,
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
