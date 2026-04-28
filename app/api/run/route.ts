import { NextResponse } from 'next/server';
import { loopManager } from '@/lib/server/loop-manager';
import type { ConditionType, RunConfig } from '@/lib/shared/types';

const VALID_CONDITION_TYPES: ConditionType[] = ['sentinel', 'command', 'judge'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateRunConfig(body: unknown): { ok: true; cfg: RunConfig } | { ok: false; error: string } {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }

  const { prompt, cwd, condition, maxIterations, iterationTimeoutMs } = body;

  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { ok: false, error: 'prompt must be a non-empty string' };
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { ok: false, error: 'cwd must be a non-empty string' };
  }
  if (!isPlainObject(condition)) {
    return { ok: false, error: 'condition must be an object' };
  }
  const condType = condition.type;
  if (typeof condType !== 'string' || !VALID_CONDITION_TYPES.includes(condType as ConditionType)) {
    return { ok: false, error: 'condition.type must be one of sentinel|command|judge' };
  }
  if (!isPlainObject(condition.config)) {
    return { ok: false, error: 'condition.config must be an object' };
  }
  if (
    typeof maxIterations !== 'number' ||
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > 1000
  ) {
    return { ok: false, error: 'maxIterations must be an integer in [1, 1000]' };
  }
  if (
    typeof iterationTimeoutMs !== 'number' ||
    !Number.isInteger(iterationTimeoutMs) ||
    iterationTimeoutMs < 1000
  ) {
    return { ok: false, error: 'iterationTimeoutMs must be an integer >= 1000' };
  }

  const cfg: RunConfig = {
    prompt,
    cwd,
    condition: {
      type: condType,
      config: condition.config,
    } as unknown as RunConfig['condition'],
    maxIterations,
    iterationTimeoutMs,
  };
  return { ok: true, cfg };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const validation = validateRunConfig(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (loopManager.getState().status === 'running') {
    return NextResponse.json({ error: 'a run is already active' }, { status: 409 });
  }

  loopManager.start(validation.cfg).catch((err) => {
    console.error('loopManager.start rejected:', err);
  });

  return NextResponse.json({ state: loopManager.getState() }, { status: 202 });
}

export async function GET() {
  return NextResponse.json({ state: loopManager.getState() }, { status: 200 });
}
