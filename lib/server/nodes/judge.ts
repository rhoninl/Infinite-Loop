import type { NodeExecutor } from '../../shared/workflow';

/**
 * Judge node — first-class "pick best of N" structured-output evaluator.
 * Foundation stub: throws "not implemented" so wiring is testable but the
 * node refuses to run until unit U2 lands the real implementation.
 */
export const judgeExecutor: NodeExecutor = {
  async execute() {
    throw new Error('judge executor not implemented yet (foundation stub)');
  },
};
