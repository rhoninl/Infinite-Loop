import type { NodeExecutor } from '../../shared/workflow';

/**
 * Loop container — body-walking semantics live in the engine. The engine
 * recognises `type === 'loop'` and walks children directly without calling
 * execute(). This throw is a safety net: if the engine ever forgets and
 * dispatches a loop node through the normal executor path, we fail loudly
 * instead of silently no-op'ing past the container.
 */
export const loopExecutor: NodeExecutor = {
  async execute() {
    throw new Error(
      'loop is a container; engine should not invoke execute() on it',
    );
  },
};
