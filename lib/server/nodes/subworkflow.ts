import type { NodeExecutor } from '../../shared/workflow';

/**
 * Subworkflow node — engine handles via a dedicated walker (added by unit U1)
 * because executing a subworkflow requires re-entering the engine with an
 * isolated scope. This throw is a safety net.
 */
export const subworkflowExecutor: NodeExecutor = {
  async execute() {
    throw new Error(
      'subworkflow is a re-entrant container; engine should not invoke execute() on it',
    );
  },
};
