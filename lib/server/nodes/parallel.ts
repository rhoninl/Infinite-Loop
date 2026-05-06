import type { NodeExecutor } from '../../shared/workflow';

/**
 * Parallel container — like `loop`, the engine recognises `type === 'parallel'`
 * and walks branches directly without calling execute(). This throw is a safety
 * net: if the engine ever forgets and dispatches a parallel node through the
 * normal executor path, we fail loudly instead of silently no-op'ing past it.
 *
 * Foundation stub. Real branch-walking lives in workflow-engine.ts (added by
 * unit U1). This file exists so node registry and type lookups resolve.
 */
export const parallelExecutor: NodeExecutor = {
  async execute() {
    throw new Error(
      'parallel is a container; engine should not invoke execute() on it',
    );
  },
};
