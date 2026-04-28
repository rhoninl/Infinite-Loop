import { NextResponse } from 'next/server';
import { workflowEngine } from '@/lib/server/workflow-engine';
import { getWorkflow } from '@/lib/server/workflow-store';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const workflowId =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).workflowId
      : undefined;
  if (typeof workflowId !== 'string' || workflowId.length === 0) {
    return NextResponse.json(
      { error: 'workflowId is required' },
      { status: 400 },
    );
  }

  let workflow;
  try {
    workflow = await getWorkflow(workflowId);
  } catch {
    return NextResponse.json(
      { error: `workflow not found: ${workflowId}` },
      { status: 404 },
    );
  }

  if (workflowEngine.getState().status === 'running') {
    return NextResponse.json(
      { error: 'a run is already active' },
      { status: 409 },
    );
  }

  // Fire-and-forget; the engine emits progress over the WS bus.
  workflowEngine.start(workflow).catch((err) => {
    console.error('[api/run] engine.start failed:', err);
  });

  return NextResponse.json(
    { state: workflowEngine.getState() },
    { status: 202 },
  );
}

export async function GET() {
  return NextResponse.json({ state: workflowEngine.getState() }, { status: 200 });
}
