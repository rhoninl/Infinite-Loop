import type { NodeExecutor } from '../../shared/workflow';

export const conditionExecutor: NodeExecutor = {
  async execute() {
    throw new Error('condition node: not yet implemented (Phase B unit 4)');
  },
};
