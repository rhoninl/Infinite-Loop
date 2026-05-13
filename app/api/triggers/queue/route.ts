import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;

  const size = triggerQueue.size();
  const head = triggerQueue.peek();
  return NextResponse.json({
    size,
    head: head
      ? { triggerId: head.triggerId, workflowId: head.workflow.id, position: 1 }
      : undefined,
  });
}
