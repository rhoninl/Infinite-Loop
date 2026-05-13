import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { RunRecord } from '../shared/workflow';
import { getRun, historyLimit, listRuns, saveRun } from './run-store';

let tmpDir: string;
let prevDir: string | undefined;
let prevLimit: string | undefined;

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: overrides.runId ?? 'run-1',
    workflowId: overrides.workflowId ?? 'wf-a',
    workflowName: overrides.workflowName ?? 'Workflow A',
    status: overrides.status ?? 'succeeded',
    startedAt: overrides.startedAt ?? 1000,
    finishedAt: overrides.finishedAt ?? 1500,
    durationMs: overrides.durationMs ?? 500,
    scope: overrides.scope ?? {},
    errorMessage: overrides.errorMessage,
    events: overrides.events ?? [
      { type: 'run_started', workflowId: 'wf-a', workflowName: 'Workflow A' },
      { type: 'run_finished', status: 'succeeded', scope: {} },
    ],
    truncated: overrides.truncated,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinite-loop-runs-'));
  prevDir = process.env.INFLOOP_RUNS_DIR;
  prevLimit = process.env.INFLOOP_RUN_HISTORY_LIMIT;
  process.env.INFLOOP_RUNS_DIR = tmpDir;
});

afterEach(async () => {
  if (prevDir === undefined) delete process.env.INFLOOP_RUNS_DIR;
  else process.env.INFLOOP_RUNS_DIR = prevDir;
  if (prevLimit === undefined) delete process.env.INFLOOP_RUN_HISTORY_LIMIT;
  else process.env.INFLOOP_RUN_HISTORY_LIMIT = prevLimit;
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe('historyLimit', () => {
  it('defaults to 100 when env var is unset', () => {
    delete process.env.INFLOOP_RUN_HISTORY_LIMIT;
    expect(historyLimit()).toBe(100);
  });

  it('reads INFLOOP_RUN_HISTORY_LIMIT when set to a positive integer', () => {
    process.env.INFLOOP_RUN_HISTORY_LIMIT = '5';
    expect(historyLimit()).toBe(5);
  });

  it('falls back to default for non-numeric or non-positive values', () => {
    process.env.INFLOOP_RUN_HISTORY_LIMIT = 'NaN';
    expect(historyLimit()).toBe(100);
    process.env.INFLOOP_RUN_HISTORY_LIMIT = '-3';
    expect(historyLimit()).toBe(100);
    process.env.INFLOOP_RUN_HISTORY_LIMIT = '0';
    expect(historyLimit()).toBe(100);
  });
});

describe('saveRun + getRun', () => {
  it('writes a run as JSON under runs/<workflowId>/<runId>.json', async () => {
    const rec = makeRun();
    await saveRun(rec);

    const file = path.join(tmpDir, 'wf-a', 'run-1.json');
    const raw = await fsp.readFile(file, 'utf8');
    expect(JSON.parse(raw)).toEqual(rec);
  });

  it('round-trips a run through saveRun → getRun', async () => {
    const rec = makeRun({ runId: 'r-x', truncated: true });
    await saveRun(rec);
    const loaded = await getRun('wf-a', 'r-x');
    expect(loaded).toEqual(rec);
  });

  it('throws when getRun cannot find the file', async () => {
    await expect(getRun('wf-a', 'missing')).rejects.toThrow(/run not found/);
  });

  it('does not leak the .tmp file when the rename succeeds', async () => {
    await saveRun(makeRun());
    const dir = path.join(tmpDir, 'wf-a');
    const entries = await fsp.readdir(dir);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});

describe('listRuns', () => {
  it('returns summaries sorted by startedAt desc', async () => {
    await saveRun(makeRun({ runId: 'old', startedAt: 1000 }));
    await saveRun(makeRun({ runId: 'mid', startedAt: 2000 }));
    await saveRun(makeRun({ runId: 'new', startedAt: 3000 }));

    const list = await listRuns('wf-a');
    expect(list.map((r) => r.runId)).toEqual(['new', 'mid', 'old']);
  });

  it('filters by workflowId when provided', async () => {
    await saveRun(makeRun({ runId: 'a-1', workflowId: 'wf-a' }));
    await saveRun(
      makeRun({
        runId: 'b-1',
        workflowId: 'wf-b',
        workflowName: 'Workflow B',
      }),
    );

    const aOnly = await listRuns('wf-a');
    expect(aOnly.map((r) => r.workflowId)).toEqual(['wf-a']);
  });

  it('lists across all workflows when no id is given', async () => {
    await saveRun(makeRun({ runId: 'a-1', workflowId: 'wf-a' }));
    await saveRun(
      makeRun({
        runId: 'b-1',
        workflowId: 'wf-b',
        workflowName: 'Workflow B',
        startedAt: 2000,
      }),
    );

    const all = await listRuns();
    expect(all.map((r) => r.runId)).toEqual(['b-1', 'a-1']);
  });

  it('exposes eventCount and truncated on the summary', async () => {
    await saveRun(
      makeRun({
        runId: 'r',
        events: [
          { type: 'run_started', workflowId: 'wf-a', workflowName: 'A' },
          { type: 'error', message: 'x' },
          { type: 'run_finished', status: 'failed', scope: {} },
        ],
        truncated: true,
      }),
    );
    const [s] = await listRuns('wf-a');
    expect(s.eventCount).toBe(3);
    expect(s.truncated).toBe(true);
  });
});

describe('retention cap', () => {
  it('drops the oldest runs once the per-workflow cap is exceeded', async () => {
    process.env.INFLOOP_RUN_HISTORY_LIMIT = '3';

    for (let i = 1; i <= 5; i++) {
      await saveRun(makeRun({ runId: `r-${i}`, startedAt: i * 100 }));
    }

    const list = await listRuns('wf-a');
    // Newest 3 should remain; oldest two pruned.
    expect(list.map((r) => r.runId)).toEqual(['r-5', 'r-4', 'r-3']);
  });

  it('prune is per-workflow — a different workflow is not affected', async () => {
    process.env.INFLOOP_RUN_HISTORY_LIMIT = '2';

    for (let i = 1; i <= 3; i++) {
      await saveRun(makeRun({ runId: `a-${i}`, startedAt: i * 100 }));
    }
    await saveRun(
      makeRun({
        runId: 'b-1',
        workflowId: 'wf-b',
        workflowName: 'B',
        startedAt: 1,
      }),
    );

    const a = await listRuns('wf-a');
    const b = await listRuns('wf-b');
    expect(a.map((r) => r.runId)).toEqual(['a-3', 'a-2']);
    expect(b.map((r) => r.runId)).toEqual(['b-1']);
  });
});
