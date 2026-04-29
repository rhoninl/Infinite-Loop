import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowSummary,
} from '../shared/workflow';

/**
 * v5→v6 migration: rewrite `type: "claude"` nodes to `type: "agent"` with
 * `providerId: "claude"`. Pure function; called on every load so old files on
 * disk keep working. Disk is only rewritten on the next `saveWorkflow`.
 */
function migrateNode(n: unknown): WorkflowNode {
  if (!n || typeof n !== 'object') return n as WorkflowNode;
  const node = { ...(n as Record<string, unknown>) };
  if (node.type === 'claude') {
    const oldCfg = (node.config as Record<string, unknown> | undefined) ?? {};
    node.type = 'agent';
    node.config = { providerId: 'claude', ...oldCfg };
  }
  if (Array.isArray(node.children)) {
    node.children = node.children.map(migrateNode);
  }
  return node as unknown as WorkflowNode;
}

function migrateWorkflow(wf: Workflow): Workflow {
  if (!Array.isArray(wf.nodes)) return wf;
  return { ...wf, nodes: wf.nodes.map(migrateNode) };
}

function storageDir(): string {
  return (
    process.env.INFLOOP_WORKFLOWS_DIR ||
    path.join(process.cwd(), 'workflows')
  );
}

function fileFor(id: string): string {
  return path.join(storageDir(), `${id}.json`);
}

function collectNodeIds(nodes: WorkflowNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: WorkflowNode[]) => {
    for (const n of list) {
      ids.add(n.id);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

function validateWorkflow(wf: Workflow): void {
  if (typeof wf.id !== 'string' || wf.id.length === 0) {
    throw new Error('invalid workflow: id must be a non-empty string');
  }
  if (typeof wf.name !== 'string' || wf.name.length === 0) {
    throw new Error('invalid workflow: name must be a non-empty string');
  }
  if (!Array.isArray(wf.nodes)) {
    throw new Error('invalid workflow: nodes must be an array');
  }
  if (!Array.isArray(wf.edges)) {
    throw new Error('invalid workflow: edges must be an array');
  }

  const hasStart = wf.nodes.some((n) => n.type === 'start');
  if (!hasStart) {
    throw new Error(
      'invalid workflow: must contain at least one top-level node of type "start"',
    );
  }

  const nodeIds = collectNodeIds(wf.nodes);
  for (const edge of wf.edges as WorkflowEdge[]) {
    if (!nodeIds.has(edge.source)) {
      throw new Error(
        `invalid workflow: edge ${edge.id} source "${edge.source}" does not reference any known node id`,
      );
    }
    if (!nodeIds.has(edge.target)) {
      throw new Error(
        `invalid workflow: edge ${edge.id} target "${edge.target}" does not reference any known node id`,
      );
    }
  }
}

async function readWorkflowFile(id: string): Promise<Workflow> {
  const file = fileFor(id);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`workflow not found: ${id}`);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `workflow file for "${id}" is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`workflow file for "${id}" is not a JSON object`);
  }
  const wf = parsed as Workflow;
  if (wf.id !== id) {
    throw new Error(
      `workflow file for "${id}" has mismatched id (got "${wf.id}")`,
    );
  }
  return migrateWorkflow(wf);
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const dir = storageDir();
  await fs.mkdir(dir, { recursive: true });

  const entries = await fs.readdir(dir);
  const jsonFiles = entries.filter(
    (e) => e.endsWith('.json') && !e.endsWith('.json.tmp'),
  );

  const summaries = await Promise.all(
    jsonFiles.map(async (entry): Promise<WorkflowSummary | null> => {
      try {
        const raw = await fs.readFile(path.join(dir, entry), 'utf8');
        const parsed = JSON.parse(raw) as Workflow;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          typeof parsed.id !== 'string' ||
          typeof parsed.name !== 'string' ||
          typeof parsed.version !== 'number' ||
          typeof parsed.updatedAt !== 'number'
        ) {
          return null;
        }
        return {
          id: parsed.id,
          name: parsed.name,
          version: parsed.version,
          updatedAt: parsed.updatedAt,
        };
      } catch {
        return null;
      }
    }),
  );

  return summaries
    .filter((s): s is WorkflowSummary => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return readWorkflowFile(id);
}

export async function saveWorkflow(workflow: Workflow): Promise<Workflow> {
  validateWorkflow(workflow);

  const dir = storageDir();
  await fs.mkdir(dir, { recursive: true });

  let existing: Workflow | null = null;
  try {
    existing = await readWorkflowFile(workflow.id);
  } catch (err) {
    if (!/^workflow not found:/.test((err as Error).message)) {
      throw err;
    }
  }

  const now = Date.now();
  const saved: Workflow = {
    ...workflow,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? workflow.createdAt ?? now,
    updatedAt: now,
  };

  const target = fileFor(saved.id);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(saved, null, 2), 'utf8');
  await fs.rename(tmp, target);

  return saved;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const file = fileFor(id);
  try {
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`workflow not found: ${id}`);
    }
    throw err;
  }
}
