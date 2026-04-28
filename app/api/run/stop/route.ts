import { NextResponse } from 'next/server';
import { workflowEngine } from '@/lib/server/workflow-engine';

export async function POST() {
  workflowEngine.stop();
  return NextResponse.json({ state: workflowEngine.getState() }, { status: 200 });
}
