import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RunRecord, RunSummary } from '../shared/workflow';

/* ─── env / paths ─────────────────────────────────────────────────────────── */

function runsDir(): string {
  return process.env.INFLOOP_RUNS_DIR || path.join(process.cwd(), 'runs');
}

const DEFAULT_HISTORY_LIMIT = 100;

export function historyLimit(): number {
  const raw = process.env.INFLOOP_RUN_HISTORY_LIMIT;
  if (!raw) return DEFAULT_HISTORY_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HISTORY_LIMIT;
}

function workflowDir(workflowId: string): string {
  return path.join(runsDir(), workflowId);
}

function fileFor(workflowId: string, runId: string): string {
  return path.join(workflowDir(workflowId), `${runId}.json`);
}

/* ─── shape helpers ──────────────────────────────────────────────────────── */

function summarize(r: RunRecord): RunSummary {
  return {
    runId: r.runId,
    workflowId: r.workflowId,
    workflowName: r.workflowName,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    errorMessage: r.errorMessage,
    eventCount: r.events.length,
    truncated: r.truncated,
  };
}

function isRunRecord(v: unknown): v is RunRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.runId === 'string' &&
    typeof r.workflowId === 'string' &&
    typeof r.workflowName === 'string' &&
    typeof r.status === 'string' &&
    typeof r.startedAt === 'number' &&
    typeof r.finishedAt === 'number' &&
    Array.isArray(r.events)
  );
}

async function readRunFile(p: string): Promise<RunRecord | null> {
  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return isRunRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/* ─── public API ─────────────────────────────────────────────────────────── */

/**
 * Persist a finished run, then prune oldest entries for that workflow until
 * the on-disk count is at or below the configured limit.
 *
 * Atomicity: writes to `<file>.tmp` and renames into place — same pattern as
 * workflow-store. Pruning is best-effort and runs after the rename, so an
 * abrupt process exit might leave count > cap until the next save.
 */
export async function saveRun(record: RunRecord): Promise<void> {
  const dir = workflowDir(record.workflowId);
  await fs.mkdir(dir, { recursive: true });

  const target = fileFor(record.workflowId, record.runId);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tmp, target);

  await pruneOldest(record.workflowId);
}

async function pruneOldest(workflowId: string): Promise<void> {
  const cap = historyLimit();
  const dir = workflowDir(workflowId);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  // Reap any leftover `.tmp` files from a crashed prior write — they can't
  // be valid records (the rename is the commit point) and would otherwise
  // accumulate forever.
  for (const e of entries) {
    if (e.endsWith('.tmp')) {
      try {
        await fs.unlink(path.join(dir, e));
      } catch {
        // best effort
      }
    }
  }

  const files = entries.filter(
    (e) => e.endsWith('.json') && !e.endsWith('.tmp'),
  );
  if (files.length <= cap) return;

  const records = await Promise.all(
    files.map(async (name) => {
      const rec = await readRunFile(path.join(dir, name));
      return rec ? { name, startedAt: rec.startedAt, runId: rec.runId } : null;
    }),
  );
  const valid = records.filter(
    (r): r is { name: string; startedAt: number; runId: string } => r !== null,
  );
  // Oldest first, tie-broken by runId for determinism when timestamps collide.
  valid.sort(
    (a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId),
  );

  const drop = valid.length - cap;
  for (let i = 0; i < drop; i++) {
    try {
      await fs.unlink(path.join(dir, valid[i].name));
    } catch {
      // Best effort; another writer may have already moved/removed it.
    }
  }
}

/** List run summaries. Without `workflowId`, lists across all workflows. */
export async function listRuns(workflowId?: string): Promise<RunSummary[]> {
  const root = runsDir();
  await fs.mkdir(root, { recursive: true });

  const workflowDirs: string[] = [];
  if (workflowId) {
    workflowDirs.push(workflowDir(workflowId));
  } else {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      return [];
    }
    for (const e of entries) {
      const full = path.join(root, e);
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) workflowDirs.push(full);
      } catch {
        // skip unreadable entries
      }
    }
  }

  const all: RunSummary[] = [];
  for (const dir of workflowDirs) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    const files = names.filter(
      (n) => n.endsWith('.json') && !n.endsWith('.json.tmp'),
    );
    const records = await Promise.all(
      files.map((n) => readRunFile(path.join(dir, n))),
    );
    for (const r of records) {
      if (r) all.push(summarize(r));
    }
  }

  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/** Look up a run by id within a workflow's directory; throws if missing. */
export async function getRun(
  workflowId: string,
  runId: string,
): Promise<RunRecord> {
  const rec = await readRunFile(fileFor(workflowId, runId));
  if (!rec) {
    throw new Error(`run not found: ${workflowId}/${runId}`);
  }
  return rec;
}
