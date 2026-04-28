import type { ConditionStrategy } from '../../shared/types';

export const judgeStrategy: ConditionStrategy = {
  async evaluate() {
    throw new Error('judge condition: not yet implemented (Phase B unit 4)');
  },
};
