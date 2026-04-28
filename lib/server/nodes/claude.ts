import type {
  ClaudeConfig,
  NodeExecutor,
  NodeExecutorContext,
  NodeExecutorResult,
} from '../../shared/workflow';
import { runClaude } from '../claude-runner';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export const claudeExecutor: NodeExecutor = {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const cfg = ctx.config as ClaudeConfig;

    if (!isNonEmptyString(cfg?.prompt) || !isNonEmptyString(cfg?.cwd)) {
      return {
        outputs: { errorMessage: 'invalid claude config' },
        branch: 'error',
      };
    }

    const result = await runClaude({
      prompt: cfg.prompt,
      cwd: cfg.cwd,
      timeoutMs: cfg.timeoutMs,
      signal: ctx.signal,
      onStdoutChunk: ctx.emitStdoutChunk,
    });

    const outputs = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    };

    const success = result.exitCode === 0 && !result.timedOut;
    return { outputs, branch: success ? 'next' : 'error' };
  },
};
