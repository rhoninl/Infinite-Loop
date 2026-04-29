import type { LineParser } from './index';

/**
 * Anthropic Messages API streaming + claude CLI's `--output-format stream-json`
 * wrapper. Pulls human-readable text out of:
 *   - {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
 *   - {"type":"stream_event","event":{<inner anthropic event>}}
 *   - {"type":"assistant"|"message","message":{"content":[{"type":"text","text":"…"}]}}
 *
 * Returns `kind:'plain'` for non-JSON lines so the runner falls back to
 * passthrough — useful when fixtures or stderr leaks land on stdout.
 */
export const claudeStreamJsonParser: LineParser = (line) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'plain' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'plain' };
  const obj = parsed as Record<string, unknown>;

  if (obj.type === 'content_block_delta') {
    const delta = obj.delta as Record<string, unknown> | undefined;
    if (delta && delta.type === 'text_delta' && typeof delta.text === 'string') {
      return { kind: 'json', text: delta.text };
    }
    return { kind: 'json', text: '' };
  }

  if (obj.type === 'stream_event' && obj.event && typeof obj.event === 'object') {
    const inner = claudeStreamJsonParser(JSON.stringify(obj.event));
    return inner.kind === 'json' ? inner : { kind: 'json', text: '' };
  }

  if (obj.type === 'assistant' || obj.type === 'message') {
    const msg = (obj.message as Record<string, unknown> | undefined) ?? obj;
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const parts = content
        .filter(
          (c): c is { type: string; text: string } =>
            !!c &&
            typeof c === 'object' &&
            (c as { type?: unknown }).type === 'text' &&
            typeof (c as { text?: unknown }).text === 'string',
        )
        .map((c) => c.text);
      if (parts.length > 0) return { kind: 'json', text: parts.join('') };
    }
    return { kind: 'json', text: '' };
  }

  return { kind: 'json', text: '' };
};
