import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/server/run-store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workflowId = url.searchParams.get('workflowId') ?? undefined;

  try {
    const runs = await listRuns(workflowId || undefined);
    return NextResponse.json({ runs }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'list failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
