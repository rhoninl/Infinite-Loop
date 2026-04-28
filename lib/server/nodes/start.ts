import type { NodeExecutor } from '../../shared/workflow';

export const startExecutor: NodeExecutor = {
  async execute() {
    throw new Error('start node: not yet implemented (Phase B unit 5)');
  },
};
