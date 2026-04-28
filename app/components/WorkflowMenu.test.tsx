import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Workflow, WorkflowSummary } from '../../lib/shared/workflow';
import { useWorkflowStore } from '../../lib/client/workflow-store-client';
import WorkflowMenu from './WorkflowMenu';

const SUMMARY_A: WorkflowSummary = {
  id: 'wf-a',
  name: 'Alpha',
  version: 1,
  updatedAt: 1,
};
const SUMMARY_B: WorkflowSummary = {
  id: 'wf-b',
  name: 'Beta',
  version: 2,
  updatedAt: 2,
};

const FULL_A: Workflow = {
  id: 'wf-a',
  name: 'Alpha',
  version: 1,
  nodes: [
    { id: 'start-1', type: 'start', position: { x: 0, y: 0 }, config: {} },
    {
      id: 'end-1',
      type: 'end',
      position: { x: 200, y: 0 },
      config: { outcome: 'succeeded' },
    },
  ],
  edges: [{ id: 'e1', source: 'start-1', sourceHandle: 'next', target: 'end-1' }],
  createdAt: 1,
  updatedAt: 1,
};

const SEED: Workflow = {
  id: 'w1',
  name: 'My Wf',
  version: 1,
  nodes: [],
  edges: [],
  createdAt: 0,
  updatedAt: 0,
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const resetStore = () => {
  useWorkflowStore.setState({
    currentWorkflow: null,
    isDirty: false,
    selectedNodeId: null,
    runStatus: 'idle',
    runEvents: [],
    connectionStatus: 'connecting',
  });
};

describe('WorkflowMenu', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the trigger with the current workflow name', () => {
    useWorkflowStore.setState({ currentWorkflow: SEED });
    render(<WorkflowMenu />);
    const trigger = screen.getByRole('button', { name: 'workflow menu' });
    expect(trigger).toHaveTextContent('My Wf');
  });

  it('falls back to "(no workflow)" when nothing is loaded', () => {
    render(<WorkflowMenu />);
    expect(
      screen.getByRole('button', { name: 'workflow menu' }),
    ).toHaveTextContent('(no workflow)');
  });

  it('fetches /api/workflows and lists summaries when opened', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/workflows') {
        return jsonResponse({ workflows: [SUMMARY_A, SUMMARY_B] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WorkflowMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'workflow menu' }));

    await waitFor(() =>
      expect(screen.getByLabelText('workflow wf-a')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('workflow wf-b')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows');
  });

  it('loads a workflow when its row is clicked', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === '/api/workflows') {
        return jsonResponse({ workflows: [SUMMARY_A] });
      }
      if (u === '/api/workflows/wf-a') {
        return jsonResponse({ workflow: FULL_A });
      }
      throw new Error(`unexpected fetch ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WorkflowMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'workflow menu' }));

    const row = await screen.findByLabelText('workflow wf-a');
    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() =>
      expect(useWorkflowStore.getState().currentWorkflow?.id).toBe('wf-a'),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/wf-a');
    // Menu closes after selection.
    expect(screen.queryByLabelText('workflow list')).toBeNull();
  });

  it('POSTs to /api/workflows when "New" is clicked and loads the result', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === '/api/workflows' && (!init || !init.method || init.method === 'GET')) {
        return jsonResponse({ workflows: [] });
      }
      if (u === '/api/workflows' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Workflow;
        return jsonResponse({ workflow: body });
      }
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WorkflowMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'workflow menu' }));

    const newBtn = await screen.findByLabelText('new workflow');
    await act(async () => {
      fireEvent.click(newBtn);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().currentWorkflow).not.toBeNull();
    });
    const wf = useWorkflowStore.getState().currentWorkflow!;
    expect(wf.name).toBe('Untitled');
    expect(wf.nodes.find((n) => n.type === 'start')?.id).toBe('start-1');
    expect(wf.nodes.find((n) => n.type === 'end')?.id).toBe('end-1');
    expect(wf.edges).toHaveLength(1);

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
  });

  it('closes the dropdown when clicking outside', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ workflows: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <WorkflowMenu />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'workflow menu' }));
    await waitFor(() =>
      expect(screen.getByLabelText('workflow list')).toBeInTheDocument(),
    );

    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() =>
      expect(screen.queryByLabelText('workflow list')).toBeNull(),
    );
  });
});
