/*
 * Workflow contract — IMMUTABLE for Phase B workers.
 * All node executors, the engine, the canvas, and the API talk through these types.
 */

export type NodeType =
  | 'start'
  | 'end'
  | 'agent'
  | 'condition'
  | 'loop'
  | 'branch'
  | 'parallel'
  | 'subworkflow'
  | 'judge';

/** Edge handles. Workers MUST emit one of these from a node executor. */
export type EdgeHandle =
  | 'next'
  | 'met'
  | 'not_met'
  | 'true'
  | 'false'
  | 'error'
  | 'continue'
  | 'break'
  | 'all_done'
  | 'first_done'
  | 'quorum_met';

export type ConditionKind = 'sentinel' | 'command' | 'judge';

export interface SentinelConfig {
  pattern: string;
  isRegex: boolean;
}

export interface CommandConfig {
  cmd: string;
}

export interface JudgeConfig {
  rubric: string;
  model?: string;
}

export interface StartConfig {}

export interface EndConfig {
  outcome?: 'succeeded' | 'failed';
}

export interface AgentConfig {
  /** Provider id resolved against `providers/*.json`, e.g. "claude" or "codex". */
  providerId: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  /** Optional model/profile name. Only meaningful for HTTP-transport providers
   * (e.g. Hermes/OpenRouter). CLI providers ignore this field. When unset and
   * the provider needs one, the manifest's `defaultProfile` is used. */
  profile?: string;
}

export interface ConditionConfig {
  kind: ConditionKind;
  /**
   * Templating-resolved string the strategy evaluates. If unset, the engine
   * defaults to `{{<incoming-source>.stdout}}`.
   */
  against?: string;
  sentinel?: SentinelConfig;
  command?: CommandConfig;
  judge?: JudgeConfig;
}

export interface LoopConfig {
  maxIterations: number;
  /** 'while-not-met' is the default common case; 'unbounded' relies on break. */
  mode: 'while-not-met' | 'unbounded';
  /**
   * When true, the engine ignores `maxIterations` and iterates without a cap.
   * The body is expected to exit via `break`, an `end` node, or run cancel.
   */
  infinite?: boolean;
}

export type BranchOp = '==' | '!=' | 'contains' | 'matches';

export interface BranchConfig {
  /** Templating-resolved left-hand side (e.g. `{{shell-1.exitCode}}`). */
  lhs: string;
  op: BranchOp;
  /** Templating-resolved right-hand side. For `matches`, this is a regex source. */
  rhs: string;
}

export type ParallelMode = 'wait-all' | 'race' | 'quorum';
export type ParallelOnError = 'fail-fast' | 'best-effort';

export interface ParallelConfig {
  /** wait-all → 'all_done' on success. race → 'first_done' on first success
   * (siblings cancel). quorum → 'quorum_met' once `quorumN` branches finish
   * successfully (rest cancel). All modes route 'error' on failure. */
  mode: ParallelMode;
  /** Required when mode === 'quorum'. Must satisfy 1 ≤ quorumN ≤ children.length. */
  quorumN?: number;
  /** fail-fast: any branch error cancels siblings and routes 'error'.
   * best-effort: collect per-branch errors; route success handle if mode's
   * success criterion is still met by surviving branches; otherwise 'error'. */
  onError: ParallelOnError;
}

export interface SubworkflowConfig {
  /** Workflow id (filename stem) of the child workflow to run. */
  workflowId: string;
  /** Input bindings: each value is a templated string evaluated against parent
   * scope. Inside the child run, these surface under scope.__inputs.<name>. */
  inputs: Record<string, string>;
  /** Output bindings: parentName → dotted child-scope path (e.g.
   * "judge-1.winner"). Each value is copied from the child's terminal scope
   * back into parent scope under this subworkflow node's id. */
  outputs: Record<string, string>;
}

export interface JudgeNodeConfig {
  /** Templated rubric / criteria text shown to the judge. */
  criteria: string;
  /** Templated candidate texts. Resolved per-call. */
  candidates: string[];
  /** Optional override of the judge's system prompt. */
  judgePrompt?: string;
  /** Optional model override; defaults to the provider's default model. */
  model?: string;
  /** Optional provider id (defaults to 'claude'). */
  providerId?: string;
}

export type NodeConfigByType = {
  start: StartConfig;
  end: EndConfig;
  agent: AgentConfig;
  condition: ConditionConfig;
  loop: LoopConfig;
  branch: BranchConfig;
  parallel: ParallelConfig;
  subworkflow: SubworkflowConfig;
  judge: JudgeNodeConfig;
};

export interface WorkflowNode<T extends NodeType = NodeType> {
  id: string;
  type: T;
  position: { x: number; y: number };
  config: NodeConfigByType[T];
  /**
   * Container nodes (currently only `loop`) hold their child nodes here. Edges
   * inside a container reference these child ids and live in the parent
   * workflow's `edges` array (the engine resolves which container an edge
   * belongs to by source/target id).
   */
  children?: WorkflowNode[];
  /** Optional human-readable label override for the canvas. */
  label?: string;
  /** Optional persisted canvas size (currently used by Loop containers so
   * the user can resize them; xyflow's NodeResizer writes here). */
  size?: { width: number; height: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: EdgeHandle;
  target: string;
  /** Usually 'in'; container nodes may have multiple inputs. */
  targetHandle?: string;
}

export interface Workflow {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: number;
  /** Where the file lives. 'library' = repo-shipped read-only preset; 'user'
   * = user-editable workflow under the storage dir. Optional for back-compat
   * with older clients that ignore the field. */
  source?: 'user' | 'library';
}

/* ─── runtime state ───────────────────────────────────────────────────────── */

export type RunStatus =
  | 'idle'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** Variable scope for a single run. Keyed by node id; node executors write here. */
export type Scope = Record<string, Record<string, unknown>>;

export interface RunSnapshot {
  status: RunStatus;
  workflowId?: string;
  currentNodeId?: string;
  iterationByLoopId: Record<string, number>;
  scope: Scope;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  /**
   * Recent events emitted during the current/last run, capped to a sliding
   * window. Returned by getState() so a refreshing client can rehydrate the
   * event log and the canvas's live-node highlight.
   */
  events?: WorkflowEvent[];
}

/* ─── events on the WS bus ────────────────────────────────────────────────── */

export interface RunStartedEvent {
  type: 'run_started';
  workflowId: string;
  workflowName: string;
}

export interface NodeStartedEvent {
  type: 'node_started';
  nodeId: string;
  nodeType: NodeType;
  /** The fully template-resolved config the executor is about to receive. */
  resolvedConfig: Record<string, unknown>;
  /** Loop iteration index, if this node is inside a Loop container. */
  loopIteration?: number;
}

export interface NodeFinishedEvent {
  type: 'node_finished';
  nodeId: string;
  nodeType: NodeType;
  branch: EdgeHandle;
  /** What the executor wrote into the scope under its node id. */
  outputs: Record<string, unknown>;
  durationMs: number;
}

export interface StdoutChunkEvent {
  type: 'stdout_chunk';
  nodeId: string;
  line: string;
  /** Optional loop iteration the chunk belongs to. */
  loopIteration?: number;
}

export interface ConditionCheckedEvent {
  type: 'condition_checked';
  nodeId: string;
  met: boolean;
  detail: string;
}

export interface TemplateWarningEvent {
  type: 'template_warning';
  nodeId: string;
  field: string;
  missingKey: string;
}

export interface ErrorEvent {
  type: 'error';
  nodeId?: string;
  message: string;
  stderr?: string;
}

export interface RunFinishedEvent {
  type: 'run_finished';
  status: Exclude<RunStatus, 'idle' | 'running'>;
  scope: Scope;
}

export type WorkflowEvent =
  | RunStartedEvent
  | NodeStartedEvent
  | NodeFinishedEvent
  | StdoutChunkEvent
  | ConditionCheckedEvent
  | TemplateWarningEvent
  | ErrorEvent
  | RunFinishedEvent;

export type WsStatus = 'connecting' | 'open' | 'closed';

/* ─── run history (persisted) ────────────────────────────────────────────── */

/** A finished run's terminal state. Excludes the live transitional values. */
export type TerminalRunStatus = Exclude<RunStatus, 'idle' | 'running'>;

/** Full record of one completed run, written once at settle. */
export interface RunRecord {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: TerminalRunStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  scope: Scope;
  errorMessage?: string;
  events: WorkflowEvent[];
  /** True when the event log was truncated mid-run because it exceeded the
   * persistence cap (e.g. an infinite loop with chatty stdout). The events
   * array still ends at the cap; older events are dropped first. */
  truncated?: boolean;
}

/** Lightweight projection used by list endpoints / UI menus. */
export interface RunSummary {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: TerminalRunStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  errorMessage?: string;
  eventCount: number;
  truncated?: boolean;
}

/* ─── node executor contract ──────────────────────────────────────────────── */

export interface NodeExecutorContext {
  /** Already-template-resolved config for this node. */
  config: unknown;
  /** Read-only flat scope of all prior nodes' outputs. */
  scope: Scope;
  /** Caller cwd for filesystem-touching nodes; nodes may override via config. */
  defaultCwd: string;
  /** Aborted when the user clicks Stop. */
  signal: AbortSignal;
  /** Loop iteration index if this node is inside a Loop container. */
  loopIteration?: number;
  /** Stream a stdout line back to the bus (Claude/Shell nodes). */
  emitStdoutChunk?: (line: string) => void;
}

export interface NodeExecutorResult {
  /** Variables this node wrote — merged into scope under the node's id. */
  outputs: Record<string, unknown>;
  /** Which outgoing edge handle to follow next. */
  branch: EdgeHandle;
}

export interface NodeExecutor {
  execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult>;
}

/* ─── templating result type (Phase B U1) ─────────────────────────────────── */

export interface TemplateResolveResult {
  text: string;
  warnings: Array<{ field: string; missingKey: string }>;
}
