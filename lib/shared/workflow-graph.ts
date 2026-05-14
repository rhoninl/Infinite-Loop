import type { NodeType, Workflow, WorkflowNode } from './workflow';

export function walkWorkflowNodes(
  nodes: readonly WorkflowNode[] | undefined,
  fn: (node: WorkflowNode, parent?: WorkflowNode) => void,
  parent?: WorkflowNode,
): void {
  if (!nodes) return;
  for (const node of nodes) {
    fn(node, parent);
    walkWorkflowNodes(node.children, fn, node);
  }
}

export function mapWorkflowNodes(
  nodes: readonly WorkflowNode[],
  fn: (node: WorkflowNode) => WorkflowNode,
): WorkflowNode[] {
  return nodes.map((node) => {
    const next = fn(node);
    if (next.children && next.children.length > 0) {
      return { ...next, children: mapWorkflowNodes(next.children, fn) };
    }
    return next;
  });
}

export function findWorkflowNode(
  nodes: readonly WorkflowNode[] | undefined,
  id: string,
): WorkflowNode | null {
  let found: WorkflowNode | null = null;
  walkWorkflowNodes(nodes, (node) => {
    if (!found && node.id === id) found = node;
  });
  return found;
}

export function collectWorkflowNodeIds(
  nodes: readonly WorkflowNode[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  walkWorkflowNodes(nodes, (node) => ids.add(node.id));
  return ids;
}

export function collectWorkflowNodeIdList(
  nodes: readonly WorkflowNode[] | undefined,
): string[] {
  const out: string[] = [];
  walkWorkflowNodes(nodes, (node) => out.push(node.id));
  return out;
}

export function workflowContainsNode(workflow: Workflow, id: string): boolean {
  return collectWorkflowNodeIds(workflow.nodes).has(id);
}

export function collectNodeSubtreeIds(node: WorkflowNode): Set<string> {
  const ids = new Set<string>();
  walkWorkflowNodes([node], (current) => ids.add(current.id));
  return ids;
}

export function collectNodeSubtreeIdsById(
  nodes: readonly WorkflowNode[],
  id: string,
): Set<string> {
  const node = findWorkflowNode(nodes, id);
  return node ? collectNodeSubtreeIds(node) : new Set([id]);
}

export function filterWorkflowNodeSubtree(
  nodes: readonly WorkflowNode[],
  id: string,
): WorkflowNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.children && node.children.length > 0
        ? { ...node, children: filterWorkflowNodeSubtree(node.children, id) }
        : node,
    );
}

export function nextWorkflowNodeId(
  type: NodeType,
  existing: readonly WorkflowNode[],
): string {
  const prefix = `${type}-`;
  let max = 0;
  walkWorkflowNodes(existing, (node) => {
    if (!node.id.startsWith(prefix)) return;
    const tail = node.id.slice(prefix.length);
    const n = Number(tail);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return `${type}-${max + 1}`;
}
