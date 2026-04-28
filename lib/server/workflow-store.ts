import type { Workflow, WorkflowSummary } from '../shared/workflow';

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  throw new Error('workflow-store.listWorkflows: not yet implemented (Phase B unit 2)');
}

export async function getWorkflow(_id: string): Promise<Workflow> {
  throw new Error('workflow-store.getWorkflow: not yet implemented (Phase B unit 2)');
}

export async function saveWorkflow(_workflow: Workflow): Promise<Workflow> {
  throw new Error('workflow-store.saveWorkflow: not yet implemented (Phase B unit 2)');
}

export async function deleteWorkflow(_id: string): Promise<void> {
  throw new Error('workflow-store.deleteWorkflow: not yet implemented (Phase B unit 2)');
}
