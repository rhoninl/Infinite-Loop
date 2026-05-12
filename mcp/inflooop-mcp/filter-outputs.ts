const HIDDEN_KEYS = new Set(['inputs', '__inputs', 'globals']);

/** Drop caller-supplied keys from a run scope before returning it to an
 *  MCP caller. The caller already supplied `inputs` and the workflow's
 *  `globals` are static; both add noise without signal. */
export function filterOutputs(
  scope: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!scope || typeof scope !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(scope)) {
    if (HIDDEN_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
