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
  ClaudeConfig,
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
import ClaudeNode from './nodes/ClaudeNode';
import ConditionNode from './nodes/ConditionNode';
import EndNode from './nodes/EndNode';
import LoopNode from './nodes/LoopNode';
import StartNode from './nodes/StartNode';

/* ─── pure helpers (exported for tests) ─────────────────────────────────── */

export type NodeRunState = 'idle' | 'live' | 'succeeded' | 'failed';

export interface DropPayload {
  type: NodeType;
  label?: string;
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
  claude: (): ClaudeConfig => ({ prompt: '', cwd: '', timeoutMs: 60000 }),
  condition: (): ConditionConfig => ({
    kind: 'sentinel',
    sentinel: { pattern: '', isRegex: false },
  }),
  loop: (): LoopConfig => ({ maxIterations: 5, mode: 'while-not-met' }),
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
  return {
    id,
    type: payload.type,
    position,
    config: defaultConfigFor(payload.type),
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

/** Map a Workflow + live state into xyflow nodes/edges. */
export function workflowToXyflow(
  workflow: Workflow | null,
  liveMap: Record<string, NodeRunState>,
  selectedNodeId: string | null,
): { nodes: XyNode[]; edges: XyEdge[] } {
  if (!workflow) return { nodes: [], edges: [] };
  const nodes: XyNode[] = workflow.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    selected: n.id === selectedNodeId,
    data: {
      label: n.label ?? n.id,
      config: n.config,
      _state: liveMap[n.id] ?? 'idle',
    },
  }));
  const edges: XyEdge[] = workflow.edges.map((e) => ({
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
  claude: ClaudeNode,
  condition: ConditionNode,
  loop: LoopNode,
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
        if (ch.type === 'position' && ch.position && !ch.dragging) {
          updateNode(ch.id, { position: ch.position });
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

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!currentWorkflow) return;
      const raw = e.dataTransfer.getData(DROP_MIME);
      if (!raw) return;
      let payload: DropPayload;
      try {
        payload = JSON.parse(raw) as DropPayload;
      } catch {
        return;
      }
      if (!payload?.type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node = buildDroppedNode(payload, position, currentWorkflow.nodes);
      addNode(node);
    },
    [addNode, currentWorkflow, screenToFlowPosition],
  );

  return (
    <div
      aria-label="canvas"
      style={{ width: '100%', height: '100%' }}
      onDrop={onDrop}
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
