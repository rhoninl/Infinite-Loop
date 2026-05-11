import { promises as fs } from 'node:fs';
import path from 'node:path';
import { KNOWN_OUTPUT_FORMATS } from './parsers/index';
import type {
  CliProviderManifest,
  HttpProviderAuth,
  HttpProviderManifest,
  HttpProviderProfile,
  ProviderManifest,
  ProviderTransport,
} from './types';

function providersDir(): string {
  return (
    process.env.INFLOOP_PROVIDERS_DIR || path.join(process.cwd(), 'providers')
  );
}

/**
 * Resolve the binary for a CLI-transport provider. Order:
 *   1. `INFLOOP_PROVIDER_BIN_<ID>` env override (id upper-cased).
 *   2. `INFLOOP_CLAUDE_BIN` for the legacy claude-only override.
 *   3. The manifest's declared `bin`.
 *
 * HTTP-transport manifests have no `bin` and never reach this function.
 */
export function resolveBin(manifest: CliProviderManifest): string {
  const idEnv = `INFLOOP_PROVIDER_BIN_${manifest.id.toUpperCase()}`;
  const fromIdEnv = process.env[idEnv];
  if (fromIdEnv) return fromIdEnv;
  if (manifest.id === 'claude' && process.env.INFLOOP_CLAUDE_BIN) {
    return process.env.INFLOOP_CLAUDE_BIN;
  }
  return manifest.bin;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validateCommon(
  m: Record<string, unknown>,
  file: string,
): { id: string; label: string; description: string; glyph?: string } {
  for (const key of ['id', 'label', 'description']) {
    if (!isNonEmptyString(m[key])) {
      throw new Error(`provider ${file}: \`${key}\` must be a non-empty string`);
    }
  }
  if (m.glyph !== undefined && typeof m.glyph !== 'string') {
    throw new Error(`provider ${file}: \`glyph\` must be a string if set`);
  }
  return {
    id: m.id as string,
    label: m.label as string,
    description: m.description as string,
    glyph: m.glyph as string | undefined,
  };
}

function validateCliManifest(
  m: Record<string, unknown>,
  file: string,
): CliProviderManifest {
  const common = validateCommon(m, file);
  if (!isNonEmptyString(m.bin)) {
    throw new Error(`provider ${file}: \`bin\` must be a non-empty string`);
  }
  if (!isNonEmptyString(m.outputFormat)) {
    throw new Error(`provider ${file}: \`outputFormat\` must be a non-empty string`);
  }
  if (!isStringArray(m.args)) {
    throw new Error(`provider ${file}: \`args\` must be a string array`);
  }
  if (!KNOWN_OUTPUT_FORMATS.includes(m.outputFormat as string)) {
    throw new Error(
      `provider ${file}: unknown outputFormat "${m.outputFormat}". Known: ${KNOWN_OUTPUT_FORMATS.join(', ')}`,
    );
  }
  if (
    m.promptVia !== undefined &&
    m.promptVia !== 'arg' &&
    m.promptVia !== 'stdin'
  ) {
    throw new Error(
      `provider ${file}: \`promptVia\` must be "arg" or "stdin" if set`,
    );
  }
  return {
    ...common,
    transport: 'cli',
    bin: m.bin as string,
    args: m.args as string[],
    outputFormat: m.outputFormat as string,
    promptVia: (m.promptVia as 'arg' | 'stdin' | undefined) ?? 'arg',
  };
}

function validateHttpAuth(raw: unknown, file: string): HttpProviderAuth | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`provider ${file}: \`auth\` must be an object if set`);
  }
  const auth = raw as Record<string, unknown>;
  if (auth.type !== 'bearer') {
    throw new Error(`provider ${file}: \`auth.type\` must be "bearer" (only kind supported)`);
  }
  if (!isNonEmptyString(auth.envVar)) {
    throw new Error(`provider ${file}: \`auth.envVar\` must be a non-empty string`);
  }
  return { type: 'bearer', envVar: auth.envVar };
}

function validateHttpProfiles(
  raw: unknown,
  file: string,
): HttpProviderProfile[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`provider ${file}: \`profiles\` must be an array if set`);
  }
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`provider ${file}: \`profiles[${i}]\` must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (!isNonEmptyString(e.id)) {
      throw new Error(`provider ${file}: \`profiles[${i}].id\` must be a non-empty string`);
    }
    if (e.label !== undefined && typeof e.label !== 'string') {
      throw new Error(`provider ${file}: \`profiles[${i}].label\` must be a string if set`);
    }
    return { id: e.id, label: e.label as string | undefined };
  });
}

function validateHttpManifest(
  m: Record<string, unknown>,
  file: string,
): HttpProviderManifest {
  const common = validateCommon(m, file);
  if (!isNonEmptyString(m.baseUrl)) {
    throw new Error(`provider ${file}: \`baseUrl\` must be a non-empty string`);
  }
  if (!isNonEmptyString(m.endpoint)) {
    throw new Error(`provider ${file}: \`endpoint\` must be a non-empty string`);
  }
  // Endpoints are joined with `baseUrl` via raw concatenation in the runner —
  // both halves MUST be deliberate about the boundary. We require a leading
  // slash here so a typo can't silently produce `https://host/v1chat/...`.
  if (!(m.endpoint as string).startsWith('/')) {
    throw new Error(`provider ${file}: \`endpoint\` must start with "/"`);
  }
  if (m.profilesEndpoint !== undefined) {
    if (typeof m.profilesEndpoint !== 'string') {
      throw new Error(`provider ${file}: \`profilesEndpoint\` must be a string if set`);
    }
    if (!(m.profilesEndpoint as string).startsWith('/')) {
      throw new Error(`provider ${file}: \`profilesEndpoint\` must start with "/"`);
    }
  }
  if (m.defaultProfile !== undefined && typeof m.defaultProfile !== 'string') {
    throw new Error(`provider ${file}: \`defaultProfile\` must be a string if set`);
  }
  return {
    ...common,
    transport: 'http',
    baseUrl: (m.baseUrl as string).replace(/\/+$/, ''),
    endpoint: m.endpoint as string,
    profilesEndpoint: m.profilesEndpoint as string | undefined,
    defaultProfile: m.defaultProfile as string | undefined,
    auth: validateHttpAuth(m.auth, file),
    profiles: validateHttpProfiles(m.profiles, file),
  };
}

function validateManifest(parsed: unknown, file: string): ProviderManifest {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`provider ${file}: not a JSON object`);
  }
  const m = parsed as Record<string, unknown>;
  const transportRaw = m.transport ?? 'cli';
  if (transportRaw !== 'cli' && transportRaw !== 'http') {
    throw new Error(
      `provider ${file}: \`transport\` must be "cli" or "http"`,
    );
  }
  const transport = transportRaw as ProviderTransport;
  return transport === 'http'
    ? validateHttpManifest(m, file)
    : validateCliManifest(m, file);
}

interface CacheEntry {
  dir: string;
  manifests: ProviderManifest[];
  byId: Map<string, ProviderManifest>;
}

let cache: CacheEntry | null = null;

/**
 * Load all `*.json` provider manifests from `INFLOOP_PROVIDERS_DIR` (or
 * `./providers/`). Cached for the process lifetime — restart to pick up new
 * files. Malformed JSON, invalid manifests (missing fields, unknown
 * outputFormat, bad promptVia/glyph), and id collisions are all logged with
 * `console.warn` and skipped — never thrown — so a single typo in one provider
 * file can't break the whole API. First-wins on duplicate ids.
 */
export async function loadProviders(): Promise<ProviderManifest[]> {
  const dir = providersDir();
  if (cache && cache.dir === dir) return cache.manifests;

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = { dir, manifests: [], byId: new Map() };
      return [];
    }
    throw err;
  }

  const manifests: ProviderManifest[] = [];
  const byId = new Map<string, ProviderManifest>();
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(dir, entry);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      console.warn(`[providers] could not read ${file}: ${(err as Error).message}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`[providers] ${file} is not valid JSON: ${(err as Error).message}`);
      continue;
    }
    let manifest: ProviderManifest;
    try {
      manifest = validateManifest(parsed, entry);
    } catch (err) {
      console.warn(`[providers] ${(err as Error).message}`);
      continue;
    }
    if (byId.has(manifest.id)) {
      console.warn(
        `[providers] id collision: "${manifest.id}" already loaded; ignoring ${entry}`,
      );
      continue;
    }
    byId.set(manifest.id, manifest);
    manifests.push(manifest);
  }

  manifests.sort((a, b) => a.label.localeCompare(b.label));
  cache = { dir, manifests, byId };
  return manifests;
}

export async function getProvider(id: string): Promise<ProviderManifest | undefined> {
  await loadProviders();
  return cache?.byId.get(id);
}

/** Test/dev helper: drop the in-process cache so the next load re-reads disk. */
export function _resetProviderCache(): void {
  cache = null;
}
