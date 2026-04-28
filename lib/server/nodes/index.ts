import type { NodeExecutor, NodeType } from '../../shared/workflow';
import { startExecutor } from './start';
import { endExecutor } from './end';
import { claudeExecutor } from './claude';
import { conditionExecutor } from './condition';
import { loopExecutor } from './loop';

export const nodeExecutors: Record<NodeType, NodeExecutor> = {
  start: startExecutor,
  end: endExecutor,
  claude: claudeExecutor,
  condition: conditionExecutor,
  loop: loopExecutor,
};
