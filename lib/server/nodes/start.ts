import type { NodeExecutor } from '../../shared/workflow';

/**
 * Start node — entry point of every workflow. Has no inputs, no config of
 * substance, and no side effects. The engine still calls execute() so that
 * node_started/node_finished events are emitted symmetrically.
 */
export const startExecutor: NodeExecutor = {
  async execute() {
    return { outputs: {}, branch: 'next' };
  },
};
