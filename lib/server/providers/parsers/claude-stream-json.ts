import type { LineParser } from './index';

/**
 * Anthropic Messages API streaming + claude CLI's `--output-format stream-json`
 * wrapper. Pulls human-readable text out of:
 *   - {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
 *   - {"type":"stream_event","event":{<inner anthropic event>}}
 *
 * The CLI also emits a rolled-up `{"type":"assistant"|"message",…}` event
 * after a turn whose `content[*].text` is the *concatenation* of the
 * preceding deltas. Emitting both would duplicate the entire reply in the
 * UI — once line-by-line, then again as one block. We treat the rolled-up
 * frame as already-rendered (kind:'json', text:'') so it's swallowed.
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

  // Rolled-up turn frame — content already streamed via deltas above.
  if (obj.type === 'assistant' || obj.type === 'message') {
    return { kind: 'json', text: '' };
  }

  return { kind: 'json', text: '' };
};
