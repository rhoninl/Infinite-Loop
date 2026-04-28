import type {
  BranchConfig,
  NodeExecutor,
  NodeExecutorContext,
  NodeExecutorResult,
} from '../../shared/workflow';

/**
 * Branch / If-Else node. Structured predicate (no expression DSL):
 * `<lhs> <op> <rhs>` where op ∈ '==' | '!=' | 'contains' | 'matches'.
 * Both `lhs` and `rhs` are template-resolved by the engine before we run.
 *
 * Branches: `true`, `false`, `error` (regex parse failure / unknown op).
 */
function isBranchConfig(v: unknown): v is BranchConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as { lhs?: unknown; op?: unknown; rhs?: unknown };
  return (
    typeof c.lhs === 'string' &&
    typeof c.rhs === 'string' &&
    (c.op === '==' || c.op === '!=' || c.op === 'contains' || c.op === 'matches')
  );
}

function evaluate(cfg: BranchConfig): {
  ok: true;
  result: boolean;
} | {
  ok: false;
  error: string;
} {
  const { lhs, op, rhs } = cfg;
  switch (op) {
    case '==':
      return { ok: true, result: lhs === rhs };
    case '!=':
      return { ok: true, result: lhs !== rhs };
    case 'contains':
      return { ok: true, result: lhs.includes(rhs) };
    case 'matches':
      try {
        const re = new RegExp(rhs);
        return { ok: true, result: re.test(lhs) };
      } catch (err) {
        return { ok: false, error: `invalid regex: ${(err as Error).message}` };
      }
  }
}

export const branchExecutor: NodeExecutor = {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const cfg = ctx.config;
    if (!isBranchConfig(cfg)) {
      return {
        outputs: { error: 'invalid branch config' },
        branch: 'error',
      };
    }
    const verdict = evaluate(cfg);
    if (!verdict.ok) {
      return {
        outputs: { error: verdict.error, lhs: cfg.lhs, rhs: cfg.rhs, op: cfg.op },
        branch: 'error',
      };
    }
    return {
      outputs: {
        result: verdict.result,
        lhs: cfg.lhs,
        rhs: cfg.rhs,
        op: cfg.op,
      },
      branch: verdict.result ? 'true' : 'false',
    };
  },
};
