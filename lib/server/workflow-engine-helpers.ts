import type {
  EdgeHandle,
  ParallelConfig,
  Scope,
  WorkflowEdge,
  WorkflowNode,
} from '../shared/workflow';

export function successHandleFor(mode: ParallelConfig['mode']): EdgeHandle {
  if (mode === 'race') return 'first_done';
  if (mode === 'quorum') return 'quorum_met';
  return 'all_done';
}

export function snapshotScope(scope: Scope): Scope {
  const copy: Scope = {};
  for (const [key, value] of Object.entries(scope)) copy[key] = value;
  return copy;
}

export function identifyBranchRoots(
  children: WorkflowNode[],
  edges: WorkflowEdge[],
  childIds: Set<string>,
): WorkflowNode[] {
  const targetsOfInternalEdges = new Set<string>();
  for (const edge of edges) {
    if (childIds.has(edge.source) && childIds.has(edge.target)) {
      targetsOfInternalEdges.add(edge.target);
    }
  }
  return children.filter((child) => !targetsOfInternalEdges.has(child.id));
}

export function collectBranchOutputs(
  branchScope: Scope,
  parentSnapshot: Scope,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(branchScope)) {
    if (parentSnapshot[key] !== value) {
      out[key] = value;
    }
  }
  return out;
}

export function lookupDotted(scope: Scope, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split('.');
  let cursor: unknown = scope;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return undefined;
  }
  return cursor;
}
