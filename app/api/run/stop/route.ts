import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { workflowEngine } from '@/lib/server/workflow-engine';

export async function POST(req: Request) {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  workflowEngine.stop();
  return NextResponse.json({ state: workflowEngine.getState() }, { status: 200 });
}
