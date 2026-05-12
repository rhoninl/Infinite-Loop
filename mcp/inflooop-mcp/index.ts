#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { Workflow } from '../../lib/shared/workflow';
import { InflooopClient } from './inflooop-client';
import { runWorkflowTool } from './run-tool';
import { getRunStatus, listRuns, cancelRun } from './utility-tools';
import {
  sanitizeToolName,
  deconflictNames,
  workflowToTool,
  type McpToolSpec,
} from './workflow-to-tool';

const baseUrl = process.env.INFLOOP_BASE_URL ?? 'http://localhost:3000';
const token = process.env.INFLOOP_API_TOKEN;
const toolTimeoutMs = Number(process.env.INFLOOP_TOOL_TIMEOUT_MS ?? 600_000);
const pollIntervalMs = Number(process.env.INFLOOP_POLL_INTERVAL_MS ?? 500);

const client = new InflooopClient(baseUrl, token);

// ─── Workflow discovery + tool registration ──────────────────────────────
//
// Workflows are fetched once at startup. Adding/renaming a workflow
// requires restarting the MCP server. Live refresh is a follow-up.

interface RegisteredWorkflowTool {
  spec: McpToolSpec;
  workflowId: string;
}

async function discoverWorkflowTools(): Promise<RegisteredWorkflowTool[]> {
  let summaries: Awaited<ReturnType<InflooopClient['listWorkflowSummaries']>>;
  try {
    summaries = await client.listWorkflowSummaries();
  } catch (err) {
    process.stderr.write(
      `[inflooop-mcp] could not fetch /api/workflows from ${baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }\n[inflooop-mcp] registering utility tools only; restart once InfLoop is reachable.\n`,
    );
    return [];
  }

  const fulls: Workflow[] = [];
  for (const s of summaries) {
    try {
      const wf = (await client.getWorkflow(s.id)) as Workflow;
      fulls.push(wf);
    } catch (err) {
      process.stderr.write(
        `[inflooop-mcp] skipped workflow ${s.id}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }

  const rawNames = fulls.map((w) => sanitizeToolName(w.id));
  const finalNames = deconflictNames(rawNames);

  for (let i = 0; i < fulls.length; i++) {
    if (rawNames[i] !== finalNames[i]) {
      process.stderr.write(
        `[inflooop-mcp] tool-name collision: "${fulls[i]!.id}" -> "${finalNames[i]}"\n`,
      );
    }
  }

  return fulls.map((wf, i) => ({
    workflowId: wf.id,
    spec: workflowToTool(wf, finalNames[i]!),
  }));
}

// ─── Utility-tool specs (fixed) ──────────────────────────────────────────

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

// ─── Server setup ────────────────────────────────────────────────────────

const workflowTools = await discoverWorkflowTools();
const workflowToolByName = new Map(workflowTools.map((t) => [t.spec.name, t]));

const server = new Server(
  { name: 'inflooop', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...workflowTools.map((t) => t.spec),
    ...UTILITY_TOOLS,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  if (name === 'inflooop_get_run_status') {
    const out = await getRunStatus(client, args as { workflowId: string; runId: string });
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'inflooop_list_runs') {
    const out = await listRuns(client, args as { workflowId?: string });
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'inflooop_cancel_run') {
    const out = await cancelRun(client, args as { workflowId: string; runId: string });
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }

  const wt = workflowToolByName.get(name);
  if (!wt) {
    return {
      content: [{ type: 'text', text: `Unknown tool "${name}".` }],
      isError: true,
    };
  }

  const out = await runWorkflowTool(client, {
    workflowId: wt.workflowId,
    inputs: args as Record<string, unknown>,
    pollIntervalMs,
    timeoutMs: toolTimeoutMs,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
    isError: out.status === 'error',
  };
});

await server.connect(new StdioServerTransport());
process.stderr.write(
  `[inflooop-mcp] connected — ${workflowTools.length} workflow tool(s) registered, ` +
    `base=${baseUrl}\n`,
);
