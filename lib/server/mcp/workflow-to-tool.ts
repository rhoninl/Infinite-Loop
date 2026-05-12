import type { Workflow, WorkflowInputDecl } from '../../shared/workflow';

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

export function sanitizeToolName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/** Apply `_2`, `_3`, … suffixes so the returned list has no duplicates,
 *  preserving order. Used after sanitising workflow ids in case two ids
 *  collide on the same sanitised name. */
export function deconflictNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((n) => {
    const seen = counts.get(n) ?? 0;
    counts.set(n, seen + 1);
    return seen === 0 ? n : `${n}_${seen + 1}`;
  });
}

function inputToSchemaProperty(input: WorkflowInputDecl): Record<string, unknown> {
  // 'text' is multi-line string in InfLoop; JSON schema doesn't
  // distinguish, so we map both to 'string'.
  const jsonType: 'string' | 'number' | 'boolean' =
    input.type === 'number' ? 'number'
    : input.type === 'boolean' ? 'boolean'
    : 'string';

  const prop: Record<string, unknown> = { type: jsonType };
  if (input.description) prop.description = input.description;
  if (input.default !== undefined) prop.default = input.default;
  return prop;
}

export function workflowToTool(
  workflow: Workflow,
  toolName: string,
): McpToolSpec {
  const inputs = workflow.inputs ?? [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const input of inputs) {
    properties[input.name] = inputToSchemaProperty(input);
    if (input.default === undefined) required.push(input.name);
  }

  const description =
    `${workflow.name}\n\nRuns InfLoop workflow "${workflow.id}". ` +
    `Returns once the run settles (or after timeout).`;

  const inputSchema: McpToolSpec['inputSchema'] = {
    type: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) inputSchema.required = required;

  return { name: toolName, description, inputSchema };
}
