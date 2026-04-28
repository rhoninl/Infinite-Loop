import type { ConditionStrategy } from '../../shared/types';

export const sentinelStrategy: ConditionStrategy = {
  async evaluate() {
    throw new Error('sentinel condition: not yet implemented (Phase B unit 2)');
  },
};
