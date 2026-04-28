import type { NodeExecutor } from '../../shared/workflow';

export const claudeExecutor: NodeExecutor = {
  async execute() {
    throw new Error('claude node: not yet implemented (Phase B unit 3)');
  },
};
