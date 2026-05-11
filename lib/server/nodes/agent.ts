import type {
  AgentConfig,
  NodeExecutor,
  NodeExecutorContext,
  NodeExecutorResult,
} from '../../shared/workflow';
import { getProvider } from '../providers/loader';
import { runProvider } from '../providers/runner';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export const agentExecutor: NodeExecutor = {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const cfg = ctx.config as AgentConfig;

    if (!isNonEmptyString(cfg?.providerId) || !isNonEmptyString(cfg?.prompt)) {
      return {
        outputs: { errorMessage: 'invalid agent config' },
        branch: 'error',
      };
    }

    const provider = await getProvider(cfg.providerId);
    if (!provider) {
      return {
        outputs: {
          errorMessage: `unknown provider: ${cfg.providerId}`,
        },
        branch: 'error',
      };
    }

    // cwd is only meaningful for CLI providers — they spawn a process there.
    // HTTP providers (Hermes etc.) just POST to a remote API, so we don't
    // require it; fall back to the engine's defaultCwd to satisfy the
    // RunnerOptions contract.
    if (provider.transport === 'cli' && !isNonEmptyString(cfg.cwd)) {
      return {
        outputs: { errorMessage: 'invalid agent config' },
        branch: 'error',
      };
    }

    const result = await runProvider(provider, {
      prompt: cfg.prompt,
      cwd: isNonEmptyString(cfg.cwd) ? cfg.cwd : ctx.defaultCwd,
      timeoutMs: cfg.timeoutMs,
      signal: ctx.signal,
      onStdoutChunk: ctx.emitStdoutChunk,
      profile: cfg.profile,
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
