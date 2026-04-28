import type {
  IterationRecord,
  RunConfig,
  RunOutcome,
  RunState,
} from '../shared/types';
import { eventBus } from './event-bus';
import { runClaude } from './claude-runner';
import { strategies } from './conditions/index';

export class LoopManager {
  private state: RunState = { status: 'idle', iterations: [] };
  private abort?: AbortController;

  getState(): RunState {
    return this.state;
  }

  async start(cfg: RunConfig): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error('a run is already active');
    }

    this.abort = new AbortController();
    const startedAt = Date.now();
    this.state = {
      status: 'running',
      cfg,
      iterations: [],
      startedAt,
    };
    eventBus.emit({ type: 'run_started', cfg });

    let outcome: RunOutcome = 'exhausted';
    let errorMessage: string | undefined;

    try {
      for (let n = 1; n <= cfg.maxIterations; n++) {
        if (this.abort.signal.aborted) {
          outcome = 'cancelled';
          break;
        }

        eventBus.emit({ type: 'iteration_started', n });

        const result = await runClaude({
          prompt: cfg.prompt,
          cwd: cfg.cwd,
          timeoutMs: cfg.iterationTimeoutMs,
          signal: this.abort.signal,
          onStdoutChunk: (line) =>
            eventBus.emit({ type: 'stdout_chunk', n, line }),
        });

        const iter: IterationRecord = {
          n,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
        };
        this.state.iterations.push(iter);
        eventBus.emit({
          type: 'iteration_finished',
          n,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
        });

        if (this.abort.signal.aborted) {
          outcome = 'cancelled';
          break;
        }

        if (result.timedOut) {
          errorMessage = `iteration ${n} timed out after ${cfg.iterationTimeoutMs}ms`;
          eventBus.emit({
            type: 'error',
            message: errorMessage,
            stderr: result.stderr,
          });
          outcome = 'failed';
          break;
        }

        if (result.exitCode !== 0) {
          errorMessage = `claude exited with code ${result.exitCode} on iteration ${n}`;
          eventBus.emit({
            type: 'error',
            message: errorMessage,
            stderr: result.stderr,
          });
          outcome = 'failed';
          break;
        }

        const strategy = strategies[cfg.condition.type];
        const check = await strategy.evaluate(iter, cfg.condition.config, cfg.cwd);
        iter.conditionMet = check.met;
        iter.conditionDetail = check.detail;
        eventBus.emit({
          type: 'condition_checked',
          n,
          met: check.met,
          detail: check.detail,
        });

        if (check.met) {
          outcome = 'succeeded';
          break;
        }
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      eventBus.emit({ type: 'error', message: errorMessage });
      outcome = 'failed';
    }

    this.state = {
      ...this.state,
      status: outcome,
      outcome,
      finishedAt: Date.now(),
      errorMessage,
    };
    eventBus.emit({
      type: 'run_finished',
      outcome,
      iterations: this.state.iterations,
    });
  }

  stop(): void {
    if (this.state.status !== 'running') return;
    this.abort?.abort();
  }

  reset(): void {
    this.state = { status: 'idle', iterations: [] };
    this.abort = undefined;
  }
}

export const loopManager = new LoopManager();
