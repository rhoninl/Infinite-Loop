/*
 * Compat shim. The new contract lives in `lib/shared/workflow.ts`. This file
 * re-exports the few legacy types still consumed by reused modules
 * (provider runner, conditions/*) so they don't have to be rewritten.
 */

export type {
  SentinelConfig,
  CommandConfig,
  JudgeConfig,
} from './workflow';

export type ConditionType = 'sentinel' | 'command' | 'judge';

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

export interface RunnerOptions {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  onStdoutChunk?: (line: string) => void;
  /** Optional model/profile name. CLI providers ignore this; HTTP providers
   * use it as the `model` field in the request body (falling back to the
   * manifest's `defaultProfile`). */
  profile?: string;
}

export interface RunnerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ConditionStrategy {
  evaluate(
    iter: IterationRecord,
    cfg: unknown,
    cwd: string,
  ): Promise<{ met: boolean; detail: string }>;
}
