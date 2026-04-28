import type { ConditionStrategy, ConditionType } from '../../shared/types';
import { sentinelStrategy } from './sentinel';
import { commandStrategy } from './command';
import { judgeStrategy } from './judge';

export const strategies: Record<ConditionType, ConditionStrategy> = {
  sentinel: sentinelStrategy,
  command: commandStrategy,
  judge: judgeStrategy,
};
