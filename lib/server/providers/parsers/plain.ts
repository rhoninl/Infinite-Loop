import type { LineParser } from './index';

/** Treat every line as raw text. The runner emits `lineWithNl` for plain. */
export const plainParser: LineParser = () => ({ kind: 'plain' });
