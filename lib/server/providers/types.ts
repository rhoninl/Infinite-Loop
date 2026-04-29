/*
 * Provider manifest — the shape of a `providers/*.json` file.
 *
 * v1 scope: stdout-text providers with single positional `{prompt}`
 * substitution (or via stdin). Out of scope: auth, multi-token
 * templates, hot reload, per-provider extra config knobs.
 */

export interface ProviderManifest {
  id: string;
  label: string;
  description: string;
  glyph?: string;
  bin: string;
  args: string[];
  outputFormat: string;
  /** How the prompt is delivered. Default `"arg"` substitutes `{prompt}`
   * inside `args`. `"stdin"` writes the prompt to the child's stdin and
   * leaves `args` untouched (no `{prompt}` substitution). */
  promptVia?: 'arg' | 'stdin';
}

/** Public summary shipped to the client palette via `/api/providers`. */
export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  glyph?: string;
}
