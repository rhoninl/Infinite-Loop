import type { LineParser, LineParserFactory } from './index';

/** Treat every line as raw text. The runner emits `lineWithNl` for plain. */
const plainParser: LineParser = () => ({ kind: 'plain' });

export const createPlainParser: LineParserFactory = () => plainParser;
