import type { NodeExecutor, NodeType } from '../../shared/workflow';
import { startExecutor } from './start';
import { endExecutor } from './end';
import { agentExecutor } from './agent';
import { conditionExecutor } from './condition';
import { loopExecutor } from './loop';
import { branchExecutor } from './branch';

export const nodeExecutors: Record<NodeType, NodeExecutor> = {
  start: startExecutor,
  end: endExecutor,
  agent: agentExecutor,
  condition: conditionExecutor,
  loop: loopExecutor,
  branch: branchExecutor,
};
