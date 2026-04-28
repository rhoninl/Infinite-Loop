import type { NodeExecutor } from '../../shared/workflow';

export const endExecutor: NodeExecutor = {
  async execute() {
    throw new Error('end node: not yet implemented (Phase B unit 5)');
  },
};
