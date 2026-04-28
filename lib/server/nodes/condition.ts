import type {
  ConditionConfig,
  ConditionKind,
  NodeExecutor,
  NodeExecutorContext,
  NodeExecutorResult,
} from '../../shared/workflow';
import type { ConditionStrategy, IterationRecord } from '../../shared/types';
import { sentinelStrategy } from '../conditions/sentinel';
import { commandStrategy } from '../conditions/command';
import { judgeStrategy } from '../conditions/judge';

const STRATEGIES: Record<ConditionKind, ConditionStrategy> = {
  sentinel: sentinelStrategy,
  command: commandStrategy,
  judge: judgeStrategy,
};

function buildIteration(against: string): IterationRecord {
  return {
    n: 0,
    exitCode: 0,
    stdout: against,
    stderr: '',
    durationMs: 0,
    timedOut: false,
  };
}

function errorResult(message: string): NodeExecutorResult {
  return {
    outputs: { met: false, detail: `check error: ${message}` },
    branch: 'error',
  };
}

export const conditionExecutor: NodeExecutor = {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const cfg = ctx.config as ConditionConfig | undefined;

    if (!cfg || typeof cfg !== 'object') {
      return errorResult('missing condition config');
    }

    const strategy = STRATEGIES[cfg.kind as ConditionKind];
    if (!strategy) {
      return errorResult(`unknown condition kind: ${String(cfg.kind)}`);
    }

    const iter = buildIteration(cfg.against ?? '');
    const subCfg = cfg[cfg.kind];

    try {
      const { met, detail } = await strategy.evaluate(
        iter,
        subCfg,
        ctx.defaultCwd,
      );
      return {
        outputs: { met, detail },
        branch: met ? 'met' : 'not_met',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(msg);
    }
  },
};
