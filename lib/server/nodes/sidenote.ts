import type { NodeExecutor } from '../../shared/workflow';

/**
 * Sidenote — a sticky-note annotation pinned to the canvas. It carries no
 * edges, so the engine never reaches it during a normal run. The executor
 * exists purely so the `executors[node.type]` lookup stays exhaustive; if
 * something does route to it, we no-op and emit `next`.
 */
export const sidenoteExecutor: NodeExecutor = {
  async execute() {
    return { outputs: {}, branch: 'next' };
  },
};
