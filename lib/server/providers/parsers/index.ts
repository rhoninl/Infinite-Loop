/*
 * Output-format → line parser registry.
 *
 * Provider JSON files declare `outputFormat: <key>` to pick a parser; the key
 * MUST be one of `KNOWN_OUTPUT_FORMATS` below. Adding a provider that reuses
 * an existing format = pure JSON. A provider with a brand-new output shape
 * gets a small parser file here plus an entry in `parsers`.
 *
 * Known formats:
 *  - "claude-stream-json" — Anthropic Messages stream-json (text deltas only)
 *  - "plain"              — every stdout line emitted verbatim
 */

import { claudeStreamJsonParser } from './claude-stream-json';
import { plainParser } from './plain';

export type LineParseResult = { kind: 'json'; text: string } | { kind: 'plain' };
export type LineParser = (line: string) => LineParseResult;

export const parsers: Record<string, LineParser> = {
  'claude-stream-json': claudeStreamJsonParser,
  plain: plainParser,
};

export const KNOWN_OUTPUT_FORMATS = Object.keys(parsers);
