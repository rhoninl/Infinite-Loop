import { NextResponse } from 'next/server';
import { workflowEngine } from '@/lib/server/workflow-engine';
import { getWorkflow } from '@/lib/server/workflow-store';
import {
  resolveRunInputs,
  WorkflowInputError,
} from '@/lib/shared/resolve-run-inputs';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const obj = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const workflowId = obj.workflowId;
  if (typeof workflowId !== 'string' || workflowId.length === 0) {
    return NextResponse.json(
      { error: 'workflowId is required' },
      { status: 400 },
    );
  }

  const suppliedInputs =
    obj.inputs && typeof obj.inputs === 'object' && !Array.isArray(obj.inputs)
      ? (obj.inputs as Record<string, unknown>)
      : {};

  let workflow;
  try {
    workflow = await getWorkflow(workflowId);
  } catch {
    return NextResponse.json(
      { error: `workflow not found: ${workflowId}` },
      { status: 404 },
    );
  }

  let resolvedInputs;
  try {
    resolvedInputs = resolveRunInputs(workflow.inputs ?? [], suppliedInputs);
  } catch (err) {
    if (err instanceof WorkflowInputError) {
      return NextResponse.json(
        {
          error: 'invalid-inputs',
          field: err.field,
          reason: err.reason,
          ...(err.expected ? { expected: err.expected } : {}),
          ...(err.got ? { got: err.got } : {}),
        },
        { status: 400 },
      );
    }
    throw err;
  }

  const currentState = workflowEngine.getState();
  if (currentState.status === 'running') {
    return NextResponse.json(
      {
        error: 'a run is already active',
        runId: currentState.runId,
        workflowId: currentState.workflowId,
      },
      { status: 409 },
    );
  }

  workflowEngine.start(workflow, { resolvedInputs }).catch((err) => {
    console.error('[api/run] engine.start failed:', err);
  });

  const stateAfter = workflowEngine.getState();
  return NextResponse.json(
    {
      runId: stateAfter.runId,
      state: stateAfter,
    },
    { status: 202 },
  );
}

export async function GET() {
  return NextResponse.json({ state: workflowEngine.getState() }, { status: 200 });
}
