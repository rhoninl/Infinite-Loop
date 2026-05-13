import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { listTriggers, saveTrigger } from '@/lib/server/trigger-store';
import { randomBytes } from 'node:crypto';
import type { WebhookTrigger } from '@/lib/shared/trigger';

function generateId(): string {
  return randomBytes(16).toString('base64url');
}

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const url = new URL(req.url);
  const workflowId = url.searchParams.get('workflowId') ?? undefined;
  const all = await listTriggers();
  const filtered = workflowId ? all.filter((t) => t.workflowId === workflowId) : all;
  return NextResponse.json({ triggers: filtered });
}

export async function POST(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const payload = body as Partial<WebhookTrigger>;
  // Server owns id and timestamps; callers MUST NOT supply them.
  const id = generateId();
  const draft: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> = {
    id,
    name: typeof payload.name === 'string' ? payload.name : '',
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : true,
    workflowId: typeof payload.workflowId === 'string' ? payload.workflowId : '',
    pluginId: typeof payload.pluginId === 'string' ? payload.pluginId : '',
    eventType: typeof payload.eventType === 'string' ? payload.eventType : undefined,
    match: Array.isArray(payload.match) ? payload.match : [],
    inputs: payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)
      ? (payload.inputs as Record<string, string>)
      : {},
  };
  try {
    const saved = await saveTrigger(draft);
    return NextResponse.json({ trigger: saved }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid-trigger', reason: (err as Error).message },
      { status: 400 },
    );
  }
}
