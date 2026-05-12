import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { InflooopClient } from './inflooop-client';

const fetchMock = mock(async (_url: string, _init?: RequestInit) => new Response());
// Replace global fetch for this test process.
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

describe('InflooopClient.startRun', () => {
  it('POSTs to /api/run with workflowId+inputs and parses { runId }', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ runId: 'rid', state: {} }), { status: 202 }),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', { foo: 'bar' });
    expect(out).toEqual({ ok: true, runId: 'rid' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://infloop/api/run');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      workflowId: 'wf',
      inputs: { foo: 'bar' },
    });
  });

  it('returns { ok:false, kind:"busy", runId, workflowId } on 409', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'busy', runId: 'other', workflowId: 'wf-other' }),
        { status: 409 },
      ),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', {});
    expect(out).toEqual({
      ok: false,
      kind: 'busy',
      runId: 'other',
      workflowId: 'wf-other',
    });
  });

  it('returns { ok:false, kind:"invalid-inputs", field, reason } on 400', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'invalid-inputs', field: 'pr_url', reason: 'required' }),
        { status: 400 },
      ),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', {});
    expect(out).toEqual({
      ok: false,
      kind: 'invalid-inputs',
      field: 'pr_url',
      reason: 'required',
    });
  });

  it('forwards Authorization: Bearer when token is set', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ runId: 'r', state: {} }), { status: 202 }),
    );
    const c = new InflooopClient('http://infloop', 'tok');
    await c.startRun('wf', {});
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });
});

describe('InflooopClient.getRun', () => {
  it('returns the run record on 200', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ run: { status: 'running', runId: 'r' } }), { status: 200 }),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.getRun('wf', 'r');
    expect(out).toEqual({ ok: true, run: { status: 'running', runId: 'r' } });
  });

  it('returns { ok:false, kind:"not-found" } on 404', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nf' }), { status: 404 }));
    const c = new InflooopClient('http://infloop');
    const out = await c.getRun('wf', 'r');
    expect(out).toEqual({ ok: false, kind: 'not-found' });
  });
});

describe('InflooopClient.startRun untested variants', () => {
  it('returns unauthorized on 401', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'u' }), { status: 401 }));
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', {});
    expect(out).toEqual({ ok: false, kind: 'unauthorized' });
  });

  it('returns not-found on 404', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nf' }), { status: 404 }));
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', {});
    expect(out).toEqual({ ok: false, kind: 'not-found' });
  });

  it('returns http-error on other 5xx with status + message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), { status: 503 }),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.startRun('wf', {});
    expect(out).toEqual({ ok: false, kind: 'http-error', status: 503, message: 'boom' });
  });
});

describe('InflooopClient.getRun untested variants', () => {
  it('returns unauthorized on 401', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'u' }), { status: 401 }));
    const c = new InflooopClient('http://infloop');
    const out = await c.getRun('wf', 'r');
    expect(out).toEqual({ ok: false, kind: 'unauthorized' });
  });

  it('returns http-error on 500 with status + message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'load failed' }), { status: 500 }),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.getRun('wf', 'r');
    expect(out).toEqual({ ok: false, kind: 'http-error', status: 500, message: 'load failed' });
  });
});

describe('InflooopClient.cancelRun', () => {
  it('returns ok on 2xx', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const c = new InflooopClient('http://infloop');
    const out = await c.cancelRun();
    expect(out).toEqual({ ok: true });
  });

  it('returns unauthorized on 401', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'u' }), { status: 401 }));
    const c = new InflooopClient('http://infloop');
    const out = await c.cancelRun();
    expect(out).toEqual({ ok: false, kind: 'unauthorized' });
  });

  it('returns http-error on 500 with status + populated message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'stop failed' }), { status: 500 }),
    );
    const c = new InflooopClient('http://infloop');
    const out = await c.cancelRun();
    expect(out).toEqual({
      ok: false,
      kind: 'http-error',
      status: 500,
      message: 'stop failed',
    });
  });
});
