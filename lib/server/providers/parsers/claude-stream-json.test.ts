import { describe, expect, it } from 'bun:test';
import { claudeStreamJsonParser } from './claude-stream-json';

describe('claudeStreamJsonParser', () => {
  it('emits text from content_block_delta frames', () => {
    const out = claudeStreamJsonParser(
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello' },
      }),
    );
    expect(out).toEqual({ kind: 'json', text: 'hello' });
  });

  it('unwraps stream_event wrappers', () => {
    const out = claudeStreamJsonParser(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'x' },
        },
      }),
    );
    expect(out).toEqual({ kind: 'json', text: 'x' });
  });

  it('swallows the rolled-up assistant frame so deltas are not duplicated', () => {
    // The CLI emits this AFTER a sequence of deltas that already streamed the
    // same text. Emitting it again was the bug behind the doubled run-log.
    const out = claudeStreamJsonParser(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'hello world' }],
        },
      }),
    );
    expect(out).toEqual({ kind: 'json', text: '' });
  });

  it('swallows the rolled-up message frame as well', () => {
    const out = claudeStreamJsonParser(
      JSON.stringify({
        type: 'message',
        content: [{ type: 'text', text: 'rolled-up' }],
      }),
    );
    expect(out).toEqual({ kind: 'json', text: '' });
  });

  it('returns plain for non-JSON lines so the runner can pass them through', () => {
    expect(claudeStreamJsonParser('not json')).toEqual({ kind: 'plain' });
  });

  it('a delta-then-rollup transcript yields the delta text only when joined', () => {
    const lines = [
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hi ' },
      }),
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'there' },
      }),
      // Rolled-up duplicate — the very thing that caused the doubled UI log.
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hi there' }] },
      }),
    ];
    const joined = lines
      .map((l) => claudeStreamJsonParser(l))
      .filter((r) => r.kind === 'json')
      .map((r) => r.text)
      .join('');
    expect(joined).toBe('Hi there');
  });
});
