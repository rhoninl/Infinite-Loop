import type { ConditionStrategy } from '../../shared/types';

export const commandStrategy: ConditionStrategy = {
  async evaluate() {
    throw new Error('command condition: not yet implemented (Phase B unit 3)');
  },
};
