import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { triggerQueue } from '@/lib/server/trigger-queue-singleton';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ queueId: string }> },
): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;

  const { queueId } = await params;
  const { removed } = triggerQueue.removeByQueueId(queueId);
  if (!removed) {
    return NextResponse.json({ error: 'not-in-queue' }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
