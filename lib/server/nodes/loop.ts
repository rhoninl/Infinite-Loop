import type { NodeExecutor } from '../../shared/workflow';

/**
 * The Loop container's body-walking semantics live in the engine
 * (lib/server/workflow-engine.ts walkLoop). This executor is a marker so the
 * registry has all five node types — the engine recognises `type === 'loop'`
 * and never invokes execute() on it.
 */
export const loopExecutor: NodeExecutor = {
  async execute() {
    throw new Error(
      'loop node: engine should not call execute() on a loop container; this is a marker (Phase B unit 5)',
    );
  },
};
