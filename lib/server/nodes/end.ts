import type { NodeExecutor } from '../../shared/workflow';

/**
 * End node — terminal marker. The engine handles run-settling (final status,
 * scope snapshot, run_finished event) when it reaches an end node. This
 * executor is just a no-op so the engine emits node_started/node_finished
 * events symmetrically for End.
 */
export const endExecutor: NodeExecutor = {
  async execute() {
    return { outputs: {}, branch: 'next' };
  },
};
