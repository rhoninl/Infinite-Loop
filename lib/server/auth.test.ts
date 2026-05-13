import { afterEach, describe, expect, it } from 'bun:test';
import { requireAuth } from './auth';

const orig = process.env.INFLOOP_API_TOKEN;

afterEach(() => {
  if (orig === undefined) delete process.env.INFLOOP_API_TOKEN;
  else process.env.INFLOOP_API_TOKEN = orig;
});

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/run', { method: 'POST', headers });
}

describe('requireAuth', () => {
  it('returns null when no token is configured (open mode)', () => {
    delete process.env.INFLOOP_API_TOKEN;
    expect(requireAuth(req())).toBeNull();
  });

  it('returns 401 when token is configured and header is missing', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    const res = requireAuth(req());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('returns 401 on wrong token', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    const res = requireAuth(req({ authorization: 'Bearer wrong' }));
    expect(res!.status).toBe(401);
  });

  it('returns null on correct bearer token', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    expect(requireAuth(req({ authorization: 'Bearer secret' }))).toBeNull();
  });

  it('accepts case-insensitive scheme', () => {
    process.env.INFLOOP_API_TOKEN = 'secret';
    expect(requireAuth(req({ authorization: 'bearer secret' }))).toBeNull();
  });
});
