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
  TerminalRunStatus,
  Workflow,
  WorkflowEdge,
  WorkflowEvent,
  WorkflowNode,
} from '../shared/workflow';
import { eventBus } from './event-bus';
import { nodeExecutors } from './nodes/index';
import { saveRun } from './run-store';
import { resolve as resolveTemplate } from './templating';

const TEXT_CONFIG_FIELDS: Partial<Record<string, string[]>> = {
  agent: ['prompt', 'cwd'],
  condition: ['against'],
  branch: ['lhs', 'rhs'],
  // Phase 2+: shell.cmd, judge.rubric, etc.
};

interface ExecutionScope {
  parentNode?: WorkflowNode;
  /** Iteration index for the nearest enclosing Loop. */
  loopIteration?: number;
}

/** Sliding-window cap so a chatty Claude run can't grow the live-rehydration
 * buffer unboundedly. Most events are tiny; 2k entries ≈ a few hundred kB. */
const EVENT_HISTORY_CAP = 2000;

/** Higher cap for the persistence buffer. The persisted log is the full run
 * history a user reviews after the fact; we want it as complete as possible
 * without letting an infinite loop with chatty stdout OOM the server. When
 * exceeded, oldest events are dropped first and `truncated` is set on the
 * record so the UI can warn that earlier events are missing. */
const PERSIST_EVENT_CAP = 50_000;

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
  private runEventLog: WorkflowEvent[] = [];
  private runEventLogTruncated = false;
  private currentRunId?: string;

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
    const startedAt = Date.now();
    // Fresh runId per start(). Note: if the engine instance is replaced mid-run
    // (Next.js HMR / process restart), the in-flight run is orphaned and never
    // produces a history record. The live UI loses its run anyway in that
    // case, so we accept the gap rather than write a "running" placeholder
    // (which would accumulate as zombies without a reaper).
    this.currentRunId = crypto.randomUUID();
    this.snapshot = {
      status: 'running',
      workflowId: workflow.id,
      iterationByLoopId: {},
      scope: {},
      startedAt,
    };

    // Reset both buffers at the start of a new run so a refresh doesn't
    // surface events from a previous run.
    this.recentEvents = [];
    this.runEventLog = [];
    this.runEventLogTruncated = false;
    const captureUnsub = eventBus.subscribe((ev) => {
      this.recentEvents.push(ev);
      if (this.recentEvents.length > EVENT_HISTORY_CAP) {
        this.recentEvents.shift();
      }
      this.runEventLog.push(ev);
      if (this.runEventLog.length > PERSIST_EVENT_CAP) {
        this.runEventLog.shift();
        this.runEventLogTruncated = true;
      }
    });

    eventBus.emit({
      type: 'run_started',
      workflowId: workflow.id,
      workflowName: workflow.name,
    });

    let finalStatus: TerminalRunStatus = 'failed';
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

    const finishedAt = Date.now();
    this.snapshot = {
      ...this.snapshot,
      status: finalStatus,
      finishedAt,
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

    // Snapshot every value the persist task needs RIGHT NOW. `persistRun` is
    // fire-and-forget: if a second run starts before this task gets its first
    // tick, the engine's mutable fields (currentRunId, runEventLog, scope)
    // will already belong to the new run. Capturing locals decouples the
    // persisted record from any later state change.
    const eventsForPersist = this.runEventLog.slice();
    const truncatedForPersist = this.runEventLogTruncated;
    const scopeForPersist = this.snapshot.scope;
    const runIdForPersist = this.currentRunId;

    // Persist the run record. Failures are non-fatal: we surface a single
    // `error` event so the UI can show "history not saved" without taking
    // down the engine on a transient disk hiccup.
    if (runIdForPersist) {
      void this.persistRun({
        runId: runIdForPersist,
        workflow,
        status: finalStatus,
        startedAt,
        finishedAt,
        errorMessage,
        events: eventsForPersist,
        truncated: truncatedForPersist,
        scope: scopeForPersist,
      });
    }
  }

  private async persistRun(args: {
    runId: string;
    workflow: Workflow;
    status: TerminalRunStatus;
    startedAt: number;
    finishedAt: number;
    errorMessage: string | undefined;
    events: WorkflowEvent[];
    truncated: boolean;
    scope: Scope;
  }): Promise<void> {
    try {
      await saveRun({
        runId: args.runId,
        workflowId: args.workflow.id,
        workflowName: args.workflow.name,
        status: args.status,
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        durationMs: args.finishedAt - args.startedAt,
        scope: args.scope,
        errorMessage: args.errorMessage,
        events: args.events,
        truncated: args.truncated || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[engine] saveRun failed:', message);
      eventBus.emit({
        type: 'error',
        message: `history not saved: ${message}`,
      });
    }
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
   *
   * When `cfg.infinite` is true the iteration cap is dropped: only `break`,
   * a terminal `end` node, or run cancellation exits the loop.
   */
  private async walkLoop(
    loopNode: WorkflowNode,
    exec: ExecutionScope,
    allNodes: Map<string, { node: WorkflowNode; parent?: WorkflowNode }>,
  ): Promise<{ terminal: boolean; status?: Exclude<RunStatus, 'idle' | 'running'> }> {
    const cfg = loopNode.config as LoopConfig;
    const max = cfg.maxIterations ?? 100;
    const infinite = cfg.infinite === true;
    const children = loopNode.children ?? [];
    if (children.length === 0) return { terminal: false };

    // The body's entry is the first child whose id has no inbound edge from
    // any sibling child — i.e., the source of the body. Convention: callers
    // mark it as the first item in `children`.
    const bodyEntry = children[0];
    const bodyExec: ExecutionScope = { parentNode: loopNode };

    for (let i = 1; infinite || i <= max; i++) {
      if (this.abort?.signal.aborted) return { terminal: true, status: 'cancelled' };

      this.snapshot.iterationByLoopId[loopNode.id] = i;
      bodyExec.loopIteration = i;

      // Reset the loop-signal slot before walking the body.
      (this.snapshot as unknown as { _loopSignal?: EdgeHandle })._loopSignal = undefined;

      // Walk the body. The walkFrom call returns when:
      // - it hits a node that fires `break`/`continue` (signal stored)
      // - it dead-ends with no outgoing edge (treated as `continue`)
      // - it hits an `end` node (terminal — no signal set)
      // - it errors out (terminal failure — no signal set)
      let bodyStatus: Exclude<RunStatus, 'idle' | 'running'>;
      try {
        bodyStatus = await this.walkFrom(bodyEntry, bodyExec);
      } catch (err) {
        // bubble up — outer try/catch in start() handles
        throw err;
      }

      const signal = this.readLoopSignal();
      if (signal === 'break') return { terminal: false };
      if (signal === 'continue') continue;
      // No loop signal: the body terminated the whole run (end node or
      // unrecoverable error). Propagate up so the engine settles. Without
      // this, an infinite loop containing an `end` node would never exit.
      return { terminal: true, status: bodyStatus };
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
// IMPORTANT: only bump this when the engine class itself changes shape.
// The runner is a separate module that HMR re-evaluates independently — it
// does NOT need an engine bump. Bumping the engine while a run is in
// flight strands the running task: route handlers (Stop, GET state) start
// resolving to a fresh idle engine, while the in-flight claude child
// process is still owned by the cached older instance.
const ENGINE_VERSION = 7; // v7: persist run history at settle

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
