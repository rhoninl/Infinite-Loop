'use client';

import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge as XyEdge,
  type EdgeChange,
  type Node as XyNode,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, type DragEvent } from 'react';
import { useWorkflowStore } from '../../../lib/client/workflow-store-client';
import type {
  AgentConfig,
  BranchConfig,
  ConditionConfig,
  EdgeHandle,
  EndConfig,
  LoopConfig,
  NodeConfigByType,
  NodeType,
  StartConfig,
  Workflow,
  WorkflowEdge,
  WorkflowEvent,
  WorkflowNode,
} from '../../../lib/shared/workflow';
import AgentNode from './nodes/AgentNode';
import BranchNode from './nodes/BranchNode';
import ConditionNode from './nodes/ConditionNode';
import EndNode from './nodes/EndNode';
import LoopNode from './nodes/LoopNode';
import StartNode from './nodes/StartNode';

/* ─── pure helpers (exported for tests) ─────────────────────────────────── */

export type NodeRunState = 'idle' | 'live' | 'succeeded' | 'failed';

export interface DropPayload {
  type: NodeType;
  label?: string;
  /** Required when `type === 'agent'`; selects the provider for the new node. */
  providerId?: string;
}

const DROP_MIME = 'application/x-infloop-node';

/** Random hex id chunk (no nanoid dep). */
function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Default config factories per node type. */
const DEFAULT_CONFIG: { [K in NodeType]: () => NodeConfigByType[K] } = {
  start: (): StartConfig => ({}),
  end: (): EndConfig => ({}),
  agent: (): AgentConfig => ({
    providerId: 'claude',
    prompt: '',
    cwd: '',
    timeoutMs: 60000,
  }),
  condition: (): ConditionConfig => ({
    kind: 'sentinel',
    sentinel: { pattern: '', isRegex: false },
  }),
  loop: (): LoopConfig => ({ maxIterations: 5, mode: 'while-not-met' }),
  branch: (): BranchConfig => ({ lhs: '', op: '==', rhs: '' }),
};

/** Default config object for a fresh node of a given type. */
export function defaultConfigFor<T extends NodeType>(type: T): NodeConfigByType[T] {
  return DEFAULT_CONFIG[type]();
}

/** Compute the next available numeric suffix id for a given node type. */
export function nextNodeId(type: NodeType, existing: WorkflowNode[]): string {
  const prefix = `${type}-`;
  let max = 0;
  for (const n of existing) {
    if (!n.id.startsWith(prefix)) continue;
    const tail = n.id.slice(prefix.length);
    const n2 = Number(tail);
    if (Number.isFinite(n2) && n2 > max) max = n2;
  }
  return `${type}-${max + 1}`;
}

/** Build a fresh node from a drop payload + position + existing nodes. */
export function buildDroppedNode(
  payload: DropPayload,
  position: { x: number; y: number },
  existing: WorkflowNode[],
): WorkflowNode {
  const id = nextNodeId(payload.type, existing);
  const config = defaultConfigFor(payload.type) as Record<string, unknown>;
  if (payload.type === 'agent' && payload.providerId) {
    (config as unknown as AgentConfig).providerId = payload.providerId;
  }
  return {
    id,
    type: payload.type,
    position,
    config: config as WorkflowNode['config'],
    label: payload.label,
  };
}

/** Loose connection input — xyflow may emit partial values during drag. */
export interface EdgeInput {
  source: string | null | undefined;
  target: string | null | undefined;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Build a WorkflowEdge from an xyflow connection. */
export function buildEdge(conn: EdgeInput): WorkflowEdge | null {
  if (!conn.source || !conn.target) return null;
  return {
    id: `e_${rid()}`,
    source: conn.source,
    sourceHandle: (conn.sourceHandle as EdgeHandle) || 'next',
    target: conn.target,
    ...(conn.targetHandle ? { targetHandle: conn.targetHandle } : {}),
  };
}

/** Walk events in order; last status per node wins. node_started → live; node_finished → succeeded/failed. */
export function buildLiveStateMap(
  events: readonly WorkflowEvent[],
): Record<string, NodeRunState> {
  const out: Record<string, NodeRunState> = {};
  for (const ev of events) {
    if (ev.type === 'node_started') {
      out[ev.nodeId] = 'live';
    } else if (ev.type === 'node_finished') {
      out[ev.nodeId] = ev.branch === 'error' ? 'failed' : 'succeeded';
    }
  }
  return out;
}

/** Default visual size for a Loop container if children are present. */
const LOOP_DEFAULT_W = 460;
const LOOP_DEFAULT_H = 240;

/** Build an xyflow node from a workflow node, optionally as a child. */
function buildXyNode(
  n: WorkflowNode,
  liveMap: Record<string, NodeRunState>,
  selectedNodeId: string | null,
  parentId?: string,
): XyNode {
  const base: XyNode = {
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 0, y: 0 },
    selected: n.id === selectedNodeId,
    data: {
      label: n.label ?? n.id,
      config: n.config ?? {},
      _state: liveMap[n.id] ?? 'idle',
    },
  };
  if (parentId) {
    base.parentId = parentId;
    base.extent = 'parent';
  }
  // Persisted size (Loop containers, mostly). Falls back to a default for Loop
  // so a freshly-created Loop has somewhere to put children.
  if (n.size) {
    base.style = { width: n.size.width, height: n.size.height };
  } else if (n.type === 'loop') {
    base.style = { width: LOOP_DEFAULT_W, height: LOOP_DEFAULT_H };
  }
  return base;
}

/** Map a Workflow + live state into xyflow nodes/edges. Recurses into
 * container `children` (Loop) and emits each child as a flat xyflow node
 * with `parentId` set so xyflow renders it inside the container. */
export function workflowToXyflow(
  workflow: Workflow | null,
  liveMap: Record<string, NodeRunState>,
  selectedNodeId: string | null,
): { nodes: XyNode[]; edges: XyEdge[] } {
  if (!workflow) return { nodes: [], edges: [] };
  const wfNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const wfEdges = Array.isArray(workflow.edges) ? workflow.edges : [];

  const nodes: XyNode[] = [];
  for (const n of wfNodes) {
    nodes.push(buildXyNode(n, liveMap, selectedNodeId));
    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        nodes.push(buildXyNode(child, liveMap, selectedNodeId, n.id));
      }
    }
  }

  const edges: XyEdge[] = wfEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));
  return { nodes, edges };
}

/* ─── component ──────────────────────────────────────────────────────────── */

const NODE_TYPES = {
  start: StartNode,
  end: EndNode,
  agent: AgentNode,
  condition: ConditionNode,
  loop: LoopNode,
  branch: BranchNode,
} as const;

function CanvasInner() {
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const runEvents = useWorkflowStore((s) => s.runEvents);
  const updateNode = useWorkflowStore((s) => s.updateNode);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const removeEdge = useWorkflowStore((s) => s.removeEdge);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const addNode = useWorkflowStore((s) => s.addNode);
  const selectNode = useWorkflowStore((s) => s.selectNode);

  const { screenToFlowPosition } = useReactFlow();

  // Memoize the nodeTypes map so xyflow doesn't warn / re-create internals.
  const nodeTypes = useMemo(() => NODE_TYPES, []);

  const liveMap = useMemo(() => buildLiveStateMap(runEvents), [runEvents]);

  const { nodes, edges } = useMemo(
    () => workflowToXyflow(currentWorkflow, liveMap, selectedNodeId),
    [currentWorkflow, liveMap, selectedNodeId],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          // Persist EVERY position change, including intermediate ones during
          // a drag — xyflow renders nodes from the controlled `nodes` prop, so
          // dropping mid-drag updates makes the card visually freeze and snap
          // to the release point.
          updateNode(ch.id, { position: ch.position });
        } else if (ch.type === 'dimensions' && ch.resizing && ch.dimensions) {
          // Only persist when the user is actively resizing (NodeResizer
          // sets `resizing: true`). xyflow also emits dimensions changes on
          // first measure of every node — those have `resizing` undefined
          // and we ignore them so we don't pollute the store with values
          // that aren't really the user's intent.
          updateNode(ch.id, {
            size: { width: ch.dimensions.width, height: ch.dimensions.height },
          });
        } else if (ch.type === 'select') {
          selectNode(ch.selected ? ch.id : null);
        } else if (ch.type === 'remove') {
          removeNode(ch.id);
        }
      }
    },
    [updateNode, selectNode, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'remove') {
          removeEdge(ch.id);
        }
      }
    },
    [removeEdge],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const edge = buildEdge(conn);
      if (edge) addEdge(edge);
    },
    [addEdge],
  );

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Browsers default to "drop forbidden" unless dragenter AND dragover both
    // call preventDefault().
    if (e.dataTransfer.types.includes(DROP_MIME)) {
      e.preventDefault();
    }
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DROP_MIME)) return;
    e.preventDefault();
    // Must match the palette's `effectAllowed = 'copy'`. If we say 'move' here
    // and the source said 'copy', the browser shows the no-drop cursor and
    // refuses the drop entirely.
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentWorkflow) {
        console.warn('[canvas] drop ignored: no current workflow');
        return;
      }
      const raw = e.dataTransfer.getData(DROP_MIME);
      if (!raw) {
        console.warn(
          '[canvas] drop ignored: no payload at MIME',
          DROP_MIME,
          'available types:',
          Array.from(e.dataTransfer.types),
        );
        return;
      }
      let payload: DropPayload;
      try {
        payload = JSON.parse(raw) as DropPayload;
      } catch (err) {
        console.warn('[canvas] drop payload not JSON:', err);
        return;
      }
      if (!payload?.type) {
        console.warn('[canvas] drop payload missing type', payload);
        return;
      }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node = buildDroppedNode(payload, position, currentWorkflow.nodes);
      addNode(node);
    },
    [addNode, currentWorkflow, screenToFlowPosition],
  );

  return (
    <div
      aria-label="canvas"
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
