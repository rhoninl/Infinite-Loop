export type ConditionType = 'sentinel' | 'command' | 'judge';

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

export type ConditionSpec =
  | { type: 'sentinel'; config: SentinelConfig }
  | { type: 'command'; config: CommandConfig }
  | { type: 'judge'; config: JudgeConfig };

export interface RunConfig {
  prompt: string;
  cwd: string;
  condition: ConditionSpec;
  maxIterations: number;
  iterationTimeoutMs: number;
}

export type RunStatus =
  | 'idle'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'exhausted'
  | 'cancelled';

export type RunOutcome = Exclude<RunStatus, 'idle' | 'running'>;

export interface IterationRecord {
  n: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  conditionMet?: boolean;
  conditionDetail?: string;
}

export interface RunState {
  status: RunStatus;
  cfg?: RunConfig;
  iterations: IterationRecord[];
  startedAt?: number;
  finishedAt?: number;
  outcome?: RunOutcome;
  errorMessage?: string;
}

export interface RunnerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RunnerOptions {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  onStdoutChunk?: (line: string) => void;
}

export interface ConditionStrategy {
  evaluate(
    iter: IterationRecord,
    cfg: unknown,
    cwd: string,
  ): Promise<{ met: boolean; detail: string }>;
}

export interface RunStartedEvent {
  type: 'run_started';
  cfg: RunConfig;
}

export interface IterationStartedEvent {
  type: 'iteration_started';
  n: number;
}

export interface StdoutChunkEvent {
  type: 'stdout_chunk';
  n: number;
  line: string;
}

export interface IterationFinishedEvent {
  type: 'iteration_finished';
  n: number;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

export interface ConditionCheckedEvent {
  type: 'condition_checked';
  n: number;
  met: boolean;
  detail: string;
}

export interface RunFinishedEvent {
  type: 'run_finished';
  outcome: RunOutcome;
  iterations: IterationRecord[];
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  stderr?: string;
}

export type RunEvent =
  | RunStartedEvent
  | IterationStartedEvent
  | StdoutChunkEvent
  | IterationFinishedEvent
  | ConditionCheckedEvent
  | RunFinishedEvent
  | ErrorEvent;

export type WsStatus = 'connecting' | 'open' | 'closed';
