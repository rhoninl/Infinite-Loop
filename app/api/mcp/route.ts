/**
 * POST /api/mcp — Streamable HTTP MCP endpoint (stateless, JSON-RPC over HTTP).
 *
 * Implements the minimal MCP surface needed for tool discovery and invocation:
 *   - initialize         → version handshake
 *   - notifications/initialized → no-op (client ack)
 *   - tools/list         → per-request workflow discovery + utility tools
 *   - tools/call         → dispatch to in-process tool handlers
 *
 * Each request is authenticated via requireAuth (same as all other /api/* routes).
 * Workflow discovery is per-request so the list is always live.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { listWorkflows, getWorkflow } from '@/lib/server/workflow-store';
import { runWorkflowTool } from '@/lib/server/mcp/run-tool';
import { getRunStatus, listRuns, cancelRun } from '@/lib/server/mcp/utility-tools';
import {
  sanitizeToolName,
  deconflictNames,
  workflowToTool,
  type McpToolSpec,
} from '@/lib/server/mcp/workflow-to-tool';
import type { Workflow } from '@/lib/shared/workflow';

const TOOL_TIMEOUT_MS = Number(process.env.INFLOOP_TOOL_TIMEOUT_MS ?? 600_000);
const MCP_PROTOCOL_VERSION = '2024-11-05';

// ─── Utility-tool specs (fixed) ──────────────────────────────────────────────

const UTILITY_TOOLS: McpToolSpec[] = [
  {
    name: 'inflooop_get_run_status',
    description: 'Fetch the status and outputs of an InfLoop run by id.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'The workflow id.' },
        runId: { type: 'string', description: 'The run id returned by a tool call.' },
      },
      required: ['workflowId', 'runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'inflooop_list_runs',
    description: 'List recent InfLoop runs, optionally filtered by workflowId.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Optional workflow id filter.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inflooop_cancel_run',
    description: 'Cancel an in-flight InfLoop run, if runId matches the current run.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        runId: { type: 'string' },
      },
      required: ['workflowId', 'runId'],
      additionalProperties: false,
    },
  },
];

// ─── Workflow discovery ───────────────────────────────────────────────────────

interface RegisteredWorkflowTool {
  spec: McpToolSpec;
  workflowId: string;
}

async function discoverWorkflowTools(): Promise<RegisteredWorkflowTool[]> {
  let summaries: Awaited<ReturnType<typeof listWorkflows>>;
  try {
    summaries = await listWorkflows();
  } catch {
    return [];
  }

  const fulls: Workflow[] = [];
  for (const s of summaries) {
    try {
      const wf = await getWorkflow(s.id);
      fulls.push(wf);
    } catch {
      // Skip unreadable workflows.
    }
  }

  const rawNames = fulls.map((w) => sanitizeToolName(w.id));
  const finalNames = deconflictNames(rawNames);

  return fulls.map((wf, i) => ({
    workflowId: wf.id,
    spec: workflowToTool(wf, finalNames[i]!),
  }));
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function jsonRpcSuccess(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { status: 200 });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status: 200 },
  );
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const unauth = requireAuth(req);
  if (unauth) return unauth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 },
    );
  }

  const rpc = body as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
  const id = rpc.id ?? null;
  const method = rpc.method;
  const params = (rpc.params ?? {}) as Record<string, unknown>;

  if (rpc.jsonrpc !== '2.0' || typeof method !== 'string') {
    return jsonRpcError(id, -32600, 'Invalid Request');
  }

  // ── initialize ──────────────────────────────────────────────────────────────
  if (method === 'initialize') {
    return jsonRpcSuccess(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: 'inflooop', version: '0.1.0' },
      capabilities: { tools: {} },
    });
  }

  // ── notifications/initialized (client ack — no response needed) ─────────────
  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204 });
  }

  // ── tools/list ──────────────────────────────────────────────────────────────
  if (method === 'tools/list') {
    const workflowTools = await discoverWorkflowTools();
    const tools = [
      ...workflowTools.map((t) => t.spec),
      ...UTILITY_TOOLS,
    ];
    return jsonRpcSuccess(id, { tools });
  }

  // ── tools/call ──────────────────────────────────────────────────────────────
  if (method === 'tools/call') {
    const toolParams = params as { name?: string; arguments?: Record<string, unknown> };
    const name = toolParams.name;
    const args = toolParams.arguments ?? {};

    if (typeof name !== 'string') {
      return jsonRpcError(id, -32602, 'tools/call requires params.name');
    }

    // Utility tools.
    if (name === 'inflooop_get_run_status') {
      const out = await getRunStatus(args as { workflowId: string; runId: string });
      return jsonRpcSuccess(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      });
    }
    if (name === 'inflooop_list_runs') {
      const out = await listRuns(args as { workflowId?: string });
      return jsonRpcSuccess(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      });
    }
    if (name === 'inflooop_cancel_run') {
      const out = await cancelRun(args as { workflowId: string; runId: string });
      return jsonRpcSuccess(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      });
    }

    // Per-workflow tools: discover on every call so the tool list is always live.
    const workflowTools = await discoverWorkflowTools();
    const workflowToolByName = new Map(workflowTools.map((t) => [t.spec.name, t]));
    const wt = workflowToolByName.get(name);
    if (!wt) {
      return jsonRpcSuccess(id, {
        content: [{ type: 'text', text: `Unknown tool "${name}".` }],
        isError: true,
      });
    }

    const out = await runWorkflowTool({
      workflowId: wt.workflowId,
      inputs: args,
      timeoutMs: TOOL_TIMEOUT_MS,
    });

    return jsonRpcSuccess(id, {
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      isError: out.status === 'error' || out.status === 'timeout',
    });
  }

  // ── unknown method ───────────────────────────────────────────────────────────
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}
