import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  PluginEvent,
  PluginField,
  PluginFieldType,
  WebhookPlugin,
} from '../../shared/trigger';

const FIELD_TYPES: PluginFieldType[] = [
  'string', 'number', 'boolean', 'array', 'object',
];

const BUILTIN_GENERIC: WebhookPlugin = {
  id: 'generic',
  displayName: 'Generic',
  icon: 'generic',
  events: [
    { type: 'any', displayName: 'Any POST', fields: [] },
  ],
};

function isStringNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validatePluginField(v: unknown, file: string): PluginField {
  if (!v || typeof v !== 'object') {
    throw new Error(`${file}: field must be an object`);
  }
  const f = v as Record<string, unknown>;
  if (!isStringNonEmpty(f.path)) throw new Error(`${file}: field.path must be non-empty string`);
  if (typeof f.type !== 'string' || !FIELD_TYPES.includes(f.type as PluginFieldType)) {
    throw new Error(`${file}: field.type "${f.type}" must be one of ${FIELD_TYPES.join(', ')}`);
  }
  if (f.description !== undefined && typeof f.description !== 'string') {
    throw new Error(`${file}: field.description must be string if set`);
  }
  return {
    path: f.path,
    type: f.type as PluginFieldType,
    description: f.description as string | undefined,
  };
}

function validatePluginEvent(v: unknown, file: string): PluginEvent {
  if (!v || typeof v !== 'object') throw new Error(`${file}: event must be an object`);
  const e = v as Record<string, unknown>;
  if (!isStringNonEmpty(e.type)) throw new Error(`${file}: event.type must be non-empty string`);
  if (!isStringNonEmpty(e.displayName)) {
    throw new Error(`${file}: event.displayName must be non-empty string`);
  }
  if (!Array.isArray(e.fields)) throw new Error(`${file}: event.fields must be array`);
  return {
    type: e.type,
    displayName: e.displayName,
    fields: e.fields.map((f) => validatePluginField(f, file)),
    examplePayload: e.examplePayload,
  };
}

function validatePlugin(raw: unknown, file: string): WebhookPlugin {
  if (!raw || typeof raw !== 'object') throw new Error(`${file}: not an object`);
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(p.id)) {
    throw new Error(`${file}: id must match /^[a-z][a-z0-9_-]*$/`);
  }
  if (!isStringNonEmpty(p.displayName)) {
    throw new Error(`${file}: displayName must be non-empty string`);
  }
  if (p.eventHeader !== undefined && !isStringNonEmpty(p.eventHeader)) {
    throw new Error(`${file}: eventHeader must be a non-empty string if set`);
  }
  if (!Array.isArray(p.events) || p.events.length === 0) {
    throw new Error(`${file}: events must be a non-empty array`);
  }
  const events = p.events.map((e) => validatePluginEvent(e, file));
  const seenTypes = new Set<string>();
  for (const ev of events) {
    if (seenTypes.has(ev.type)) {
      throw new Error(`${file}: duplicate event.type "${ev.type}"`);
    }
    seenTypes.add(ev.type);
  }
  return {
    id: p.id,
    displayName: p.displayName,
    icon: typeof p.icon === 'string' ? p.icon : undefined,
    eventHeader: p.eventHeader as string | undefined,
    events,
  };
}

/** Scan `dir` for `*.json` plugin files; combine with the built-in Generic
 *  plugin. Invalid files are skipped with a console error. The built-in
 *  Generic plugin always wins over a user file with the same id. */
export async function loadPlugins(dir: string): Promise<WebhookPlugin[]> {
  const out: WebhookPlugin[] = [BUILTIN_GENERIC];
  const seenIds = new Set<string>(['generic']);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.endsWith('.json.tmp')) continue;
    const full = path.join(dir, entry);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const parsed = JSON.parse(raw);
      const plugin = validatePlugin(parsed, entry);
      if (seenIds.has(plugin.id)) {
        console.error(`[webhook-plugins] skipping ${entry}: id "${plugin.id}" already loaded`);
        continue;
      }
      seenIds.add(plugin.id);
      out.push(plugin);
    } catch (err) {
      console.error(`[webhook-plugins] failed to load ${entry}:`, err);
    }
  }
  return out;
}
