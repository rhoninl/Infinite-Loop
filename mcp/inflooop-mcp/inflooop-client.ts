export interface PersistedRun {
  runId: string;
  workflowId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  currentNodeId?: string;
  iterationByLoopId?: Record<string, number>;
  scope?: Record<string, unknown>;
}

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; kind: 'busy'; runId?: string; workflowId?: string }
  | { ok: false; kind: 'invalid-inputs'; field?: string; reason?: string }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'http-error'; status: number; message: string };

export type GetRunResult =
  | { ok: true; run: PersistedRun }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'http-error'; status: number; message: string };

export type CancelRunResult =
  | { ok: true }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'http-error'; status: number; message: string };

export class InflooopClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  async listWorkflowSummaries(): Promise<
    Array<{ id: string; name: string; version: number; updatedAt: number; source?: string }>
  > {
    const r = await fetch(`${this.baseUrl}/api/workflows`, { headers: this.headers() });
    if (!r.ok) throw new Error(`listWorkflows: HTTP ${r.status}`);
    const body = (await r.json()) as { workflows: Array<{ id: string; name: string; version: number; updatedAt: number; source?: string }> };
    return body.workflows;
  }

  async getWorkflow(id: string): Promise<unknown> {
    const r = await fetch(`${this.baseUrl}/api/workflows/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    });
    if (!r.ok) throw new Error(`getWorkflow(${id}): HTTP ${r.status}`);
    const body = (await r.json()) as { workflow: unknown };
    return body.workflow;
  }

  async startRun(workflowId: string, inputs: Record<string, unknown>): Promise<StartRunResult> {
    const r = await fetch(`${this.baseUrl}/api/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ workflowId, inputs }),
    });
    const body = await r.json().catch(() => ({} as Record<string, unknown>));

    if (r.status === 202) {
      return { ok: true, runId: String((body as { runId?: string }).runId ?? '') };
    }
    if (r.status === 409) {
      const b = body as { runId?: string; workflowId?: string };
      return { ok: false, kind: 'busy', runId: b.runId, workflowId: b.workflowId };
    }
    if (r.status === 400) {
      const b = body as { field?: string; reason?: string };
      return { ok: false, kind: 'invalid-inputs', field: b.field, reason: b.reason };
    }
    if (r.status === 401) return { ok: false, kind: 'unauthorized' };
    if (r.status === 404) return { ok: false, kind: 'not-found' };
    return {
      ok: false,
      kind: 'http-error',
      status: r.status,
      message: String((body as { error?: string }).error ?? r.statusText),
    };
  }

  async getRun(workflowId: string, runId: string): Promise<GetRunResult> {
    const r = await fetch(
      `${this.baseUrl}/api/runs/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}`,
      { headers: this.headers() },
    );
    if (r.status === 200) {
      const body = (await r.json()) as { run: PersistedRun };
      return { ok: true, run: body.run };
    }
    if (r.status === 404) return { ok: false, kind: 'not-found' };
    if (r.status === 401) return { ok: false, kind: 'unauthorized' };
    const body = await r.json().catch(() => ({}));
    return {
      ok: false,
      kind: 'http-error',
      status: r.status,
      message: String((body as { error?: string }).error ?? r.statusText),
    };
  }

  async listRuns(workflowId?: string): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/runs`);
    if (workflowId) url.searchParams.set('workflowId', workflowId);
    const r = await fetch(url.toString(), { headers: this.headers() });
    if (!r.ok) throw new Error(`listRuns: HTTP ${r.status}`);
    return (await r.json()) as { runs: unknown };
  }

  /** Cancels the engine's current run. The engine is single-run, so this
   *  doesn't take a runId — the caller (utility tool) is responsible for
   *  confirming the runId matches the current run before calling. */
  async cancelRun(): Promise<CancelRunResult> {
    const r = await fetch(`${this.baseUrl}/api/run/stop`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, kind: 'unauthorized' };
    const body = await r.json().catch(() => ({}));
    return {
      ok: false,
      kind: 'http-error',
      status: r.status,
      message: String((body as { error?: string }).error ?? r.statusText),
    };
  }
}
