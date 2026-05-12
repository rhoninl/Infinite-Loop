#!/usr/bin/env bun
// InfLoop MCP server: spawned over stdio by an MCP client (Claude Code, etc.)
// and exposes each saved workflow as its own tool. See
// docs/superpowers/specs/2026-05-12-trigger-api-mcp-design.md

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const baseUrl = process.env.INFLOOP_BASE_URL ?? 'http://localhost:3000';

const server = new Server(
  { name: 'inflooop', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Tool registration happens in Task B6; this file is a skeleton for now.

await server.connect(new StdioServerTransport());
process.stderr.write(`[inflooop-mcp] connected to ${baseUrl}\n`);
