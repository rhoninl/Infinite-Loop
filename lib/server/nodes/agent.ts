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

    if (
      !isNonEmptyString(cfg?.providerId) ||
      !isNonEmptyString(cfg?.prompt) ||
      !isNonEmptyString(cfg?.cwd)
    ) {
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

    const result = await runProvider(provider, {
      prompt: cfg.prompt,
      cwd: cfg.cwd,
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
