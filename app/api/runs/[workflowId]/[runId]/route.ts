import { NextResponse } from 'next/server';
import { getRun } from '@/lib/server/run-store';
import { isNotFoundError } from '@/app/api/workflows/validate';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workflowId: string; runId: string }> },
) {
  const { workflowId, runId } = await ctx.params;
  try {
    const run = await getRun(workflowId, runId);
    return NextResponse.json({ run }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'load failed';
    if (isNotFoundError(err)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
