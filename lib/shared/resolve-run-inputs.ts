import type { WorkflowInputDecl, WorkflowInputType } from './workflow';

export type WorkflowInputValue = string | number | boolean;
export type ResolvedInputs = Record<string, WorkflowInputValue>;
export type WorkflowInputErrorReason = 'required' | 'type';

export class WorkflowInputError extends Error {
  field: string;
  reason: WorkflowInputErrorReason;
  expected?: WorkflowInputType;
  got?: string;

  constructor(opts: {
    field: string;
    reason: WorkflowInputErrorReason;
    expected?: WorkflowInputType;
    got?: string;
  }) {
    super(`input "${opts.field}": ${opts.reason}`);
    this.name = 'WorkflowInputError';
    this.field = opts.field;
    this.reason = opts.reason;
    this.expected = opts.expected;
    this.got = opts.got;
  }
}

/** Validate `supplied` against `declared`, applying defaults. Throws
 * `WorkflowInputError` on the first missing-required or type-mismatch.
 * Unknown keys in `supplied` (not in `declared`) are silently dropped.
 *
 * Single source of truth: called by the API route, the subworkflow
 * executor, and the client-side run modal (same module, no
 * server-only imports). */
export function resolveRunInputs(
  declared: readonly WorkflowInputDecl[],
  supplied: Record<string, unknown> | undefined,
): ResolvedInputs {
  const out: ResolvedInputs = {};
  const supp = supplied ?? {};

  for (const d of declared) {
    const has = Object.prototype.hasOwnProperty.call(supp, d.name);
    const raw: unknown = has ? supp[d.name] : d.default;

    if (raw === undefined) {
      throw new WorkflowInputError({ field: d.name, reason: 'required' });
    }

    out[d.name] = coerce(d, raw);
  }

  return out;
}

function coerce(d: WorkflowInputDecl, raw: unknown): WorkflowInputValue {
  switch (d.type) {
    case 'string':
    case 'text':
      if (typeof raw !== 'string') {
        throw new WorkflowInputError({
          field: d.name,
          reason: 'type',
          expected: d.type,
          got: typeof raw,
        });
      }
      return raw;
    case 'number': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string' && raw.length > 0) {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
      throw new WorkflowInputError({
        field: d.name,
        reason: 'type',
        expected: 'number',
        got: typeof raw,
      });
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'string') {
        const lower = raw.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
      }
      throw new WorkflowInputError({
        field: d.name,
        reason: 'type',
        expected: 'boolean',
        got: typeof raw,
      });
    }
  }
}
