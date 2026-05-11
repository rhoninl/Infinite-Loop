/*
 * Provider manifest — the shape of a `providers/*.json` file.
 *
 * v1 scope: stdout-text providers with single positional `{prompt}`
 * substitution (or via stdin). Out of scope: auth, multi-token
 * templates, hot reload, per-provider extra config knobs.
 *
 * v2 (this file): adds `transport: "http"` for remote OpenAI-compatible
 * APIs (Hermes / OpenRouter / vLLM / …). Existing CLI providers keep
 * working unchanged — `transport` defaults to "cli".
 */

export type ProviderTransport = 'cli' | 'http';

interface ProviderManifestCommon {
  id: string;
  label: string;
  description: string;
  glyph?: string;
  /** Always present after validation. Manifest files may omit it — the
   * loader defaults a missing value to "cli". */
  transport: ProviderTransport;
}

export interface CliProviderManifest extends ProviderManifestCommon {
  transport: 'cli';
  bin: string;
  args: string[];
  outputFormat: string;
  /** How the prompt is delivered. Default `"arg"` substitutes `{prompt}`
   * inside `args`. `"stdin"` writes the prompt to the child's stdin and
   * leaves `args` untouched (no `{prompt}` substitution). */
  promptVia: 'arg' | 'stdin';
}

export interface HttpProviderAuth {
  type: 'bearer';
  /** Name of the env var holding the bearer token. Required so the secret
   * never lives on disk alongside the manifest. */
  envVar: string;
}

export interface HttpProviderProfile {
  id: string;
  label?: string;
}

export interface HttpProviderManifest extends ProviderManifestCommon {
  transport: 'http';
  /** Base URL with no trailing slash, e.g. "https://hermes.example/v1". */
  baseUrl: string;
  /** Path appended to baseUrl for the chat-completions call. */
  endpoint: string;
  /** Optional path for live profile discovery (e.g. "/models"). */
  profilesEndpoint?: string;
  auth?: HttpProviderAuth;
  /** Static fallback list, used when the live fetch fails or
   * `profilesEndpoint` is unset. */
  profiles?: HttpProviderProfile[];
  /** Profile id used when the agent node didn't pick one. */
  defaultProfile?: string;
}

export type ProviderManifest = CliProviderManifest | HttpProviderManifest;

/** Public summary shipped to the client palette via `/api/providers`. */
export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  glyph?: string;
  transport: ProviderTransport;
}
