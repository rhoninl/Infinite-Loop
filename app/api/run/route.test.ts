import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunConfig, RunState } from '@/lib/shared/types';

const startMock = vi.fn<(cfg: RunConfig) => Promise<void>>();
const stopMock = vi.fn<() => void>();
const getStateMock = vi.fn<() => RunState>();

vi.mock('@/lib/server/loop-manager', () => ({
  loopManager: {
    start: (cfg: RunConfig) => startMock(cfg),
    stop: () => stopMock(),
    getState: () => getStateMock(),
  },
}));

const { POST: RunPost, GET: RunGet } = await import('./route');
const { POST: StopPost } = await import('./stop/route');

const validCfg: RunConfig = {
  prompt: 'do the thing',
  cwd: '/tmp/x',
  condition: { type: 'sentinel', config: { pattern: 'DONE', isRegex: false } },
  maxIterations: 5,
  iterationTimeoutMs: 30_000,
};

const idleState: RunState = { status: 'idle', iterations: [] };
const runningState: RunState = { status: 'running', iterations: [], startedAt: 1 };

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/run', () => {
  beforeEach(() => {
    startMock.mockReset();
    stopMock.mockReset();
    getStateMock.mockReset();
    startMock.mockResolvedValue(undefined);
  });

  it('starts a run with valid body when idle and returns 202', async () => {
    getStateMock.mockReturnValue(idleState);
    const res = await RunPost(jsonRequest(validCfg));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.state).toEqual(idleState);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(validCfg);
  });

  it('returns 400 when prompt is missing', async () => {
    getStateMock.mockReturnValue(idleState);
    const { prompt: _omit, ...rest } = validCfg;
    const res = await RunPost(jsonRequest(rest));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/prompt/);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 409 when a run is already active', async () => {
    getStateMock.mockReturnValue(runningState);
    const res = await RunPost(jsonRequest(validCfg));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already active/);
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/run', () => {
  beforeEach(() => {
    getStateMock.mockReset();
  });

  it('returns 200 with current state', async () => {
    getStateMock.mockReturnValue(runningState);
    const res = await RunGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toEqual(runningState);
  });
});

describe('POST /api/run/stop', () => {
  beforeEach(() => {
    stopMock.mockReset();
    getStateMock.mockReset();
  });

  it('calls stop and returns 200 with state', async () => {
    getStateMock.mockReturnValue({
      status: 'cancelled',
      iterations: [],
      outcome: 'cancelled',
    });
    const res = await StopPost();
    expect(res.status).toBe(200);
    expect(stopMock).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.state.status).toBe('cancelled');
  });
});
