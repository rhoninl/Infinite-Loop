import type { Workflow } from '@/lib/shared/workflow';

export function hasBasicWorkflowShape(body: unknown): body is Workflow {
  if (!body || typeof body !== 'object') return false;
  const w = body as Record<string, unknown>;
  return (
    typeof w.id === 'string' &&
    w.id.length > 0 &&
    typeof w.name === 'string' &&
    Array.isArray(w.nodes) &&
    Array.isArray(w.edges)
  );
}

export function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /not\s*found/i.test(err.message);
}
