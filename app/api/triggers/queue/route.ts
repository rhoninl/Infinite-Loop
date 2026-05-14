import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;

  const all = triggerQueue.list();
  const head = all[0];
  const items = all.map((item, idx) => ({
    queueId: item.queueId,
    triggerId: item.triggerId,
    workflowId: item.workflow.id,
    workflowName: item.workflow.name,
    inputs: item.resolvedInputs,
    receivedAt: item.receivedAt,
    position: idx + 1,
  }));

  return NextResponse.json({
    size: all.length,
    head: head
      ? { triggerId: head.triggerId, workflowId: head.workflow.id, position: 1 }
      : undefined,
    items,
  });
}
