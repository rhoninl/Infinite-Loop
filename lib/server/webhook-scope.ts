import type { Scope } from '../shared/workflow';

export interface WebhookScopeInput {
  headers: Headers;
  url: string;
  bodyText: string;
}

/** Build a templating scope from an HTTP request's parts.
 *
 *  - `headers` keys are lowercased; multi-value headers are joined with ", "
 *    (Fetch spec — Headers iterator already does this).
 *  - `query` is parsed from the URL.
 *  - `body` is JSON.parse'd. Empty body → `{}`. Non-JSON → `{ raw: <text> }`.
 *    Top-level array → spread numeric-string keys onto body record so
 *    `{{body.0.x}}` works. Top-level scalar → `{ value: <scalar> }`.
 *
 *  The templating resolver walks dotted paths through nested records natively,
 *  so `{{body.commits.0.id}}` works for nested JSON without a flatten helper. */
export function buildWebhookScope(input: WebhookScopeInput): Scope {
  const headers: Record<string, string> = {};
  for (const [name, value] of input.headers.entries()) {
    headers[name.toLowerCase()] = value;
  }

  const url = new URL(input.url);
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    query[k] = v;
  }

  let body: Record<string, unknown> = {};
  if (input.bodyText.length > 0) {
    try {
      const parsed: unknown = JSON.parse(input.bodyText);
      if (parsed === null) {
        body = {};
      } else if (Array.isArray(parsed)) {
        body = { ...(parsed as unknown as Record<string, unknown>) };
      } else if (typeof parsed === 'object') {
        body = parsed as Record<string, unknown>;
      } else {
        body = { value: parsed };
      }
    } catch {
      body = { raw: input.bodyText };
    }
  }

  return { headers, query, body } as Scope;
}
