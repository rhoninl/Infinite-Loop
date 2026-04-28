import { describe, expect, it } from 'vitest';
import type { NodeExecutorContext } from '../../shared/workflow';
import { startExecutor } from './start';
import { endExecutor } from './end';
import { loopExecutor } from './loop';

function makeCtx(): NodeExecutorContext {
  return {
    config: {},
    scope: {},
    defaultCwd: '/tmp',
    signal: new AbortController().signal,
  };
}

describe('control-flow node executors', () => {
  it('startExecutor returns empty outputs and the next branch', async () => {
    const result = await startExecutor.execute(makeCtx());
    expect(result).toEqual({ outputs: {}, branch: 'next' });
  });

  it('endExecutor returns empty outputs and the next branch', async () => {
    const result = await endExecutor.execute(makeCtx());
    expect(result).toEqual({ outputs: {}, branch: 'next' });
  });

  it('loopExecutor throws to signal the engine should walk children directly', async () => {
    await expect(loopExecutor.execute(makeCtx())).rejects.toThrow(
      /loop.*execute/i,
    );
  });
});
