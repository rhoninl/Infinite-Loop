/*
 * Workflow contract — IMMUTABLE for Phase B workers.
 * All node executors, the engine, the canvas, and the API talk through these types.
 */

export type NodeType = 'start' | 'end' | 'claude' | 'condition' | 'loop';

/** Edge handles. Workers MUST emit one of these from a node executor. */
export type EdgeHandle =
  | 'next'
  | 'met'
  | 'not_met'
  | 'error'
  | 'continue'
  | 'break';

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

export interface ClaudeConfig {
  prompt: string;
  cwd: string;
  timeoutMs: number;
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
}

export type NodeConfigByType = {
  start: StartConfig;
  end: EndConfig;
  claude: ClaudeConfig;
  condition: ConditionConfig;
  loop: LoopConfig;
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
  | ConditionCheckedEvent
  | TemplateWarningEvent
  | ErrorEvent
  | RunFinishedEvent;

export type WsStatus = 'connecting' | 'open' | 'closed';

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
