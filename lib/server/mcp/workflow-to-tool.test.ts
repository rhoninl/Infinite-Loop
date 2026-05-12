import { describe, expect, it } from 'bun:test';
import type { Workflow } from '../../shared/workflow';
import { workflowToTool, sanitizeToolName, deconflictNames } from './workflow-to-tool';

function wf(partial: Partial<Workflow>): Workflow {
  return {
    id: 'wf',
    name: 'wf',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    nodes: [],
    edges: [],
    ...partial,
  };
}

describe('sanitizeToolName', () => {
  it('lowercases, replaces non-[a-z0-9_] with _', () => {
    expect(sanitizeToolName('Summarize-PR')).toBe('summarize_pr');
    expect(sanitizeToolName('loop-claude-until-condition'))
      .toBe('loop_claude_until_condition');
    expect(sanitizeToolName('foo bar baz!')).toBe('foo_bar_baz_');
  });
});

describe('deconflictNames', () => {
  it('suffixes _2, _3 on collision', () => {
    const out = deconflictNames(['foo', 'foo', 'foo', 'bar']);
    expect(out).toEqual(['foo', 'foo_2', 'foo_3', 'bar']);
  });
});

describe('workflowToTool', () => {
  it('builds a tool with empty object schema when no inputs declared', () => {
    const tool = workflowToTool(wf({ id: 'simple', name: 'Simple' }), 'simple');
    expect(tool.name).toBe('simple');
    expect(tool.description).toContain('Simple');
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('maps declared inputs to JSON-schema properties', () => {
    const tool = workflowToTool(
      wf({
        id: 'pr',
        name: 'Summarize PR',
        inputs: [
          { name: 'pr_url', type: 'string', description: 'The PR URL' },
          { name: 'max_iters', type: 'number', default: 5 },
          { name: 'verbose', type: 'boolean', default: false },
          { name: 'notes', type: 'text', description: 'Free-form notes' },
        ],
      }),
      'pr',
    );

    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        pr_url: { type: 'string', description: 'The PR URL' },
        max_iters: { type: 'number', default: 5 },
        verbose: { type: 'boolean', default: false },
        notes: { type: 'string', description: 'Free-form notes' },
      },
      required: ['pr_url', 'notes'],
      additionalProperties: false,
    });
  });
});
