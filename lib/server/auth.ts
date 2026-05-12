import { NextResponse } from 'next/server';

/**
 * Returns `null` if the request is authorized (or if no token is
 * configured), or a `401` NextResponse to return immediately if not.
 *
 * When `INFLOOP_API_TOKEN` is unset, the server is in open mode and
 * every call is allowed — matches today's behaviour.
 *
 * When set, the request must carry `Authorization: Bearer <token>`
 * matching the env var exactly (constant-time compare).
 */
export function requireAuth(req: Request): NextResponse | null {
  const token = process.env.INFLOOP_API_TOKEN;
  if (!token) return null;

  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!constantTimeEq(m[1].trimEnd(), token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
