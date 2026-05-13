import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import {
  getTrigger,
  TriggerNotFoundError,
} from '@/lib/server/trigger-store';
import { POST as webhookPOST } from '@/app/api/webhook/[triggerId]/route';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const { id } = await params;
  try {
    await getTrigger(id);
  } catch (err) {
    if (err instanceof TriggerNotFoundError) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    throw err;
  }

  let body: { payload?: unknown; headers?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const payloadJson = JSON.stringify(body.payload ?? {});
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(body.headers ?? {}),
  };

  const synthetic = new Request(`http://test/api/webhook/${id}`, {
    method: 'POST',
    headers,
    body: payloadJson,
  });
  const result = await webhookPOST(synthetic, {
    params: Promise.resolve({ triggerId: id }),
  });
  // Read the response so we can return it in a structured envelope.
  let responseBody: unknown = null;
  const text = await result.text();
  if (text.length > 0) {
    try { responseBody = JSON.parse(text); }
    catch { responseBody = text; }
  }
  return NextResponse.json({
    status: result.status,
    body: responseBody,
  });
}
