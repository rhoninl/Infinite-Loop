/*
 * WorkflowEngine — singleton that walks a workflow graph.
 *
 * Phase 1 model:
 *  - Single active run.
 *  - BFS-style sequential walk along control edges (no Parallel yet).
 *  - Loop is built-in: when the engine encounters a `loop` node it walks the
 *    container's children until a `break` edge fires; `continue` re-enters.
 *  - Cancellation: AbortController; engine kills the active executor and
 *    settles run as `cancelled`. Catch routing comes in Phase 2.
 *
 * Templating is delegated to lib/server/templating.ts; the engine resolves
 * each text-typed config field of every node before invoking the executor.
 */

import type {
  EdgeHandle,
  LoopConfig,
  NodeExecutor,
  NodeExecutorContext,
  RunSnapshot,
  RunStatus,
  Scope,
  Workflow,
  WorkflowEdge,
  WorkflowEvent,
  WorkflowNode,
} from '../shared/workflow';
import { eventBus } from './event-bus';
import { nodeExecutors } from './nodes/index';
import { resolve as resolveTemplate } from './templating';

const TEXT_CONFIG_FIELDS: Partial<Record<string, string[]>> = {
  claude: ['prompt', 'cwd'],
  condition: ['against'],
  branch: ['lhs', 'rhs'],
  // Phase 2+: shell.cmd, judge.rubric, etc.
};

interface ExecutionScope {
  parentNode?: WorkflowNode;
  /** Iteration index for the nearest enclosing Loop. */
  loopIteration?: number;
}

/** Sliding-window cap so a chatty Claude run can't grow the buffer
 * unboundedly. Most events are tiny; 2k entries ≈ a few hundred kB. */
const EVENT_HISTORY_CAP = 2000;

export class WorkflowEngine {
  private snapshot: RunSnapshot = {
    status: 'idle',
    iterationByLoopId: {},
    scope: {},
  };
  private workflow?: Workflow;
  private abort?: AbortController;
  private edgesBySource = new Map<string, WorkflowEdge[]>();
  private recentEvents: WorkflowEvent[] = [];

  private executors: Record<string, NodeExecutor>;

  constructor(executors: Record<string, NodeExecutor> = nodeExecutors) {
    this.executors = executors;
  }

  getState(): RunSnapshot {
    return { ...this.snapshot, events: this.recentEvents };
  }

  async start(workflow: Workflow): Promise<void> {
    if (this.snapshot.status === 'running') {
      throw new Error('a run is already active');
    }

    this.workflow = workflow;
    this.abort = new AbortController();
    this.indexEdges(workflow.edges);
    this.snapshot = {
      status: 'running',
      workflowId: workflow.id,
      iterationByLoopId: {},
      scope: {},
      startedAt: Date.now(),
    };

    // Reset history at the start of a new run so a refresh doesn't surface
    // events from a previous run.
    this.recentEvents = [];
    const captureUnsub = eventBus.subscribe((ev) => {
      this.recentEvents.push(ev);
      if (this.recentEvents.length > EVENT_HISTORY_CAP) {
        this.recentEvents.shift();
      }
    });

    eventBus.emit({
      type: 'run_started',
      workflowId: workflow.id,
      workflowName: workflow.name,
    });

    let finalStatus: Exclude<RunStatus, 'idle' | 'running'> = 'failed';
    let errorMessage: string | undefined;

    try {
      const start = workflow.nodes.find((n) => n.type === 'start');
      if (!start) throw new Error("workflow has no 'start' node");

      const result = await this.walkFrom(start, {});
      finalStatus = result;
    } catch (err) {
      if (this.abort.signal.aborted) {
        finalStatus = 'cancelled';
        errorMessage = 'cancelled by user';
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
        eventBus.emit({ type: 'error', message: errorMessage });
        finalStatus = 'failed';
      }
    }

    this.snapshot = {
      ...this.snapshot,
      status: finalStatus,
      finishedAt: Date.now(),
      errorMessage,
    };
    eventBus.emit({
      type: 'run_finished',
      status: finalStatus,
      scope: this.snapshot.scope,
    });

    // Stop capturing now that the run is over; the buffer keeps the recorded
    // events around for refresh hydration until the next run starts.
    captureUnsub();
  }

  stop(): void {
    if (this.snapshot.status !== 'running') return;
    this.abort?.abort();
  }

  reset(): void {
    this.snapshot = { status: 'idle', iterationByLoopId: {}, scope: {} };
    this.workflow = undefined;
    this.abort = undefined;
    this.edgesBySource.clear();
  }

  /* ─── internals ─────────────────────────────────────────────────────────── */

  private indexEdges(edges: WorkflowEdge[]) {
    this.edgesBySource.clear();
    for (const e of edges) {
      const list = this.edgesBySource.get(e.source) ?? [];
      list.push(e);
      this.edgesBySource.set(e.source, list);
    }
  }

  private nodesById(): Map<string, { node: WorkflowNode; parent?: WorkflowNode }> {
    const map = new Map<string, { node: WorkflowNode; parent?: WorkflowNode }>();
    const visit = (n: WorkflowNode, parent?: WorkflowNode) => {
      map.set(n.id, { node: n, parent });
      for (const c of n.children ?? []) visit(c, n);
    };
    for (const n of this.workflow!.nodes) visit(n);
    return map;
  }

  /**
   * Walk forward from `node` until reaching an `end` node, exhausting all
   * outgoing edges of the active branch, or hitting a settle condition.
   * Returns the run's terminal status.
   */
  private async walkFrom(
    node: WorkflowNode,
    exec: ExecutionScope,
  ): Promise<Exclude<RunStatus, 'idle' | 'running'>> {
    let current: WorkflowNode | undefined = node;
    const allNodes = this.nodesById();

    while (current) {
      if (this.abort?.signal.aborted) return 'cancelled';

      this.snapshot.currentNodeId = current.id;

      if (current.type === 'loop') {
        const loopOutcome = await this.walkLoop(current, exec, allNodes);
        if (loopOutcome.terminal) return loopOutcome.status!;
        // After the loop body breaks, follow the loop node's `next` edge.
        current = this.followBranch(current.id, 'next', allNodes);
        continue;
      }

      const branch = await this.executeNode(current, exec);

      if (current.type === 'end') {
        const cfg = current.config as { outcome?: 'succeeded' | 'failed' };
        return cfg.outcome ?? 'succeeded';
      }

      // Inside a loop body, met/break exits the loop, not_met/continue re-enters.
      // For other branches, try to follow an explicit edge; dangling means continue
      // (so the body can fall off the end into a new iteration).
      if (exec.parentNode?.type === 'loop') {
        if (branch === 'met' || branch === 'break') {
          this.setLoopSignal('break');
          return 'succeeded';
        }
        if (branch === 'not_met' || branch === 'continue') {
          this.setLoopSignal('continue');
          return 'succeeded';
        }
        if (branch === 'error') {
          const errNext = this.followBranch(current.id, branch, allNodes);
          if (errNext) {
            current = errNext;
            continue;
          }
          return 'failed';
        }
        const next = this.followBranch(current.id, branch, allNodes);
        if (!next) {
          this.setLoopSignal('continue');
          return 'succeeded';
        }
        current = next;
        continue;
      }

      // Top-level walk.
      const next = this.followBranch(current.id, branch, allNodes);
      if (!next) {
        if (branch === 'error') return 'failed';
        return 'succeeded';
      }
      current = next;
    }

    return 'succeeded';
  }

  /**
   * Walk a Loop container's body. Each iteration starts at the first child
   * reachable from the Loop's `next` edge into the body (i.e. the body's own
   * top-level entry). The body runs until a node fires `break` or `continue`,
   * or until maxIterations is hit, or the run is cancelled.
   */
  private async walkLoop(
    loopNode: WorkflowNode,
    exec: ExecutionScope,
    allNodes: Map<string, { node: WorkflowNode; parent?: WorkflowNode }>,
  ): Promise<{ terminal: boolean; status?: Exclude<RunStatus, 'idle' | 'running'> }> {
    const cfg = loopNode.config as LoopConfig;
    const max = cfg.maxIterations ?? 100;
    const children = loopNode.children ?? [];
    if (children.length === 0) return { terminal: false };

    // The body's entry is the first child whose id has no inbound edge from
    // any sibling child — i.e., the source of the body. Convention: callers
    // mark it as the first item in `children`.
    const bodyEntry = children[0];
    const bodyExec: ExecutionScope = { parentNode: loopNode };

    for (let i = 1; i <= max; i++) {
      if (this.abort?.signal.aborted) return { terminal: true, status: 'cancelled' };

      this.snapshot.iterationByLoopId[loopNode.id] = i;
      bodyExec.loopIteration = i;

      // Reset the loop-signal slot before walking the body.
      (this.snapshot as unknown as { _loopSignal?: EdgeHandle })._loopSignal = undefined;

      // Walk the body. The walkFrom call returns when:
      // - it hits a node that fires `break`/`continue` (signal stored)
      // - it dead-ends with no outgoing edge (treated as `continue`)
      // - it hits an `end` node (terminal)
      // - it errors out
      try {
        await this.walkFrom(bodyEntry, bodyExec);
      } catch (err) {
        // bubble up — outer try/catch in start() handles
        throw err;
      }

      const signal = this.readLoopSignal();
      if (signal === 'break') return { terminal: false };
      if (signal === 'continue' || signal === undefined) continue;
    }
    // Hit the cap — fall through (no break fired). Treat as "loop exhausted":
    // we still continue past the loop node; outputs reflect maxIterations.
    return { terminal: false };
  }

  private setLoopSignal(signal: 'break' | 'continue'): void {
    (this.snapshot as unknown as { _loopSignal?: EdgeHandle })._loopSignal = signal;
  }

  private readLoopSignal(): EdgeHandle | undefined {
    return (this.snapshot as unknown as { _loopSignal?: EdgeHandle })._loopSignal;
  }

  private followBranch(
    sourceId: string,
    branch: EdgeHandle,
    allNodes: Map<string, { node: WorkflowNode; parent?: WorkflowNode }>,
  ): WorkflowNode | undefined {
    const edges = this.edgesBySource.get(sourceId) ?? [];
    const edge = edges.find((e) => e.sourceHandle === branch);
    if (!edge) return undefined;
    return allNodes.get(edge.target)?.node;
  }

  private async executeNode(
    node: WorkflowNode,
    exec: ExecutionScope,
  ): Promise<EdgeHandle> {
    const executor = this.executors[node.type];
    if (!executor) throw new Error(`unknown node type: ${node.type}`);

    const resolvedConfig = this.resolveConfigTemplates(node);

    eventBus.emit({
      type: 'node_started',
      nodeId: node.id,
      nodeType: node.type,
      resolvedConfig,
      loopIteration: exec.loopIteration,
    });

    const cwd =
      typeof (resolvedConfig as { cwd?: unknown }).cwd === 'string'
        ? ((resolvedConfig as { cwd: string }).cwd as string)
        : process.cwd();

    const startedAt = Date.now();
    const ctx: NodeExecutorContext = {
      config: resolvedConfig,
      scope: this.snapshot.scope,
      defaultCwd: cwd,
      signal: this.abort!.signal,
      loopIteration: exec.loopIteration,
      emitStdoutChunk: (line: string) => {
        eventBus.emit({
          type: 'stdout_chunk',
          nodeId: node.id,
          line,
          loopIteration: exec.loopIteration,
        });
      },
    };

    let result;
    try {
      result = await executor.execute(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      eventBus.emit({ type: 'error', nodeId: node.id, message });
      // The executor threw — treat as `error` branch.
      result = { outputs: { errorMessage: message }, branch: 'error' as EdgeHandle };
    }

    this.snapshot.scope[node.id] = result.outputs;
    eventBus.emit({
      type: 'node_finished',
      nodeId: node.id,
      nodeType: node.type,
      branch: result.branch,
      outputs: result.outputs,
      durationMs: Date.now() - startedAt,
    });

    if (node.type === 'condition') {
      const out = result.outputs as { met?: boolean; detail?: string };
      eventBus.emit({
        type: 'condition_checked',
        nodeId: node.id,
        met: Boolean(out.met),
        detail: typeof out.detail === 'string' ? out.detail : '',
      });
    }

    return result.branch;
  }

  private resolveConfigTemplates(node: WorkflowNode): Record<string, unknown> {
    const fields = TEXT_CONFIG_FIELDS[node.type] ?? [];
    const cfg = node.config as Record<string, unknown>;
    const resolved: Record<string, unknown> = { ...cfg };
    for (const field of fields) {
      const raw = cfg[field];
      if (typeof raw === 'string') {
        const { text, warnings } = resolveTemplate(raw, this.snapshot.scope);
        resolved[field] = text;
        for (const w of warnings) {
          eventBus.emit({
            type: 'template_warning',
            nodeId: node.id,
            field,
            missingKey: w.missingKey,
          });
        }
      }
    }
    return resolved;
  }
}

// Pin the singleton across Next.js dev module reloads (see event-bus.ts).
//
// IMPORTANT: bump ENGINE_VERSION whenever behavior of WorkflowEngine changes
// in a way that requires recreating the live instance. Without this, Next.js
// HMR will pick up the new file but the cached instance under
// `globalThis.__infloopWorkflowEngine` was constructed with the old class
// definition and behaves the old way for the rest of the dev server's life.
const ENGINE_VERSION = 3; // v3: recentEvents buffer for refresh hydration

declare global {
  // eslint-disable-next-line no-var
  var __infloopWorkflowEngine:
    | { instance: WorkflowEngine; version: number }
    | undefined;
}

const cached = globalThis.__infloopWorkflowEngine;
const engineInstance =
  cached && cached.version === ENGINE_VERSION
    ? cached.instance
    : new WorkflowEngine();

if (
  !globalThis.__infloopWorkflowEngine ||
  globalThis.__infloopWorkflowEngine.version !== ENGINE_VERSION
) {
  globalThis.__infloopWorkflowEngine = {
    instance: engineInstance,
    version: ENGINE_VERSION,
  };
}

export const workflowEngine: WorkflowEngine = engineInstance;
