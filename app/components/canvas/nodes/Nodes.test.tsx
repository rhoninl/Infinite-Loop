import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { ReactElement } from 'react';

import StartNode from './StartNode';
import EndNode from './EndNode';
import AgentNode from './AgentNode';
import ConditionNode from './ConditionNode';
import LoopNode from './LoopNode';

beforeEach(() => {
  // xyflow's <Handle> uses ResizeObserver under the hood; jsdom needs a polyfill.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
  if (!('DOMMatrixReadOnly' in globalThis)) {
    (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly =
      class {
        m22 = 1;
        constructor() {}
      };
  }
});

/**
 * Build a minimal NodeProps object. xyflow only forwards a subset of these to
 * the user component; the test components only read `data` and `selected`.
 */
function makeProps(
  data: Record<string, unknown>,
  overrides: Partial<NodeProps> = {}
): NodeProps {
  return {
    id: 'n1',
    type: 'start',
    data,
    selected: false,
    dragging: false,
    isConnectable: true,
    zIndex: 0,
    selectable: true,
    deletable: true,
    draggable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    ...overrides,
  } as NodeProps;
}

function renderWithFlow(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('node components', () => {
  it('StartNode renders with sample data', () => {
    renderWithFlow(<StartNode {...makeProps({ config: {} })} />);
    expect(screen.getByLabelText('start node')).toBeInTheDocument();
    expect(screen.getByText('begin')).toBeInTheDocument();
  });

  it('EndNode renders with outcome', () => {
    renderWithFlow(
      <EndNode
        {...makeProps({ config: { outcome: 'failed' } }, { type: 'end' })}
      />
    );
    expect(screen.getByLabelText('end node')).toBeInTheDocument();
    expect(screen.getByText(/→ failed/)).toBeInTheDocument();
  });

  it('AgentNode renders prompt preview truncated to 40 chars', () => {
    const longPrompt = 'a'.repeat(80);
    renderWithFlow(
      <AgentNode
        {...makeProps(
          {
            config: {
              providerId: 'claude',
              prompt: longPrompt,
              cwd: '/tmp',
              timeoutMs: 60000,
            },
          },
          { type: 'agent' }
        )}
      />
    );
    const card = screen.getByLabelText('agent node');
    expect(card).toBeInTheDocument();
    const body = card.querySelector('.wf-node-body');
    expect(body).not.toBeNull();
    // truncated -> 39 chars + ellipsis = 40 chars total.
    expect(body!.textContent!.length).toBeLessThanOrEqual(40);
    expect(body!.textContent).toContain('a');
  });

  it('AgentNode shows the providerId in the header', () => {
    renderWithFlow(
      <AgentNode
        {...makeProps(
          {
            config: {
              providerId: 'codex',
              prompt: 'hi',
              cwd: '/tmp',
              timeoutMs: 60000,
            },
          },
          { type: 'agent' }
        )}
      />
    );
    expect(screen.getByText('CODEX')).toBeInTheDocument();
  });

  it('ConditionNode renders kind brief', () => {
    renderWithFlow(
      <ConditionNode
        {...makeProps(
          {
            config: {
              kind: 'sentinel',
              sentinel: { pattern: 'DONE', isRegex: false },
            },
          },
          { type: 'condition' }
        )}
      />
    );
    expect(screen.getByText(/sentinel · DONE/)).toBeInTheDocument();
  });

  it('LoopNode renders maxIterations and mode', () => {
    renderWithFlow(
      <LoopNode
        {...makeProps(
          { config: { maxIterations: 5, mode: 'while-not-met' } },
          { type: 'loop' }
        )}
      />
    );
    expect(
      screen.getByText(/×5 · while-not-met/)
    ).toBeInTheDocument();
  });

  it('LoopNode renders ×∞ when infinite is true', () => {
    renderWithFlow(
      <LoopNode
        {...makeProps(
          { config: { maxIterations: 5, mode: 'unbounded', infinite: true } },
          { type: 'loop' }
        )}
      />
    );
    expect(
      screen.getByText(/×∞ · unbounded/)
    ).toBeInTheDocument();
  });

  it('propagates _state via data-state attribute (live)', () => {
    renderWithFlow(
      <AgentNode
        {...makeProps(
          {
            _state: 'live',
            config: { providerId: 'claude', prompt: 'p', cwd: '/tmp', timeoutMs: 60000 },
          },
          { type: 'agent' }
        )}
      />
    );
    const card = screen.getByLabelText('agent node');
    expect(card.getAttribute('data-state')).toBe('live');
    // also queryable by attribute selector
    expect(document.querySelector('[data-state="live"]')).not.toBeNull();
  });

  it('selected styling marks the card', () => {
    renderWithFlow(
      <StartNode {...makeProps({ config: {} }, { selected: true })} />
    );
    const card = screen.getByLabelText('start node');
    expect(card.getAttribute('data-selected')).toBe('true');
  });

  it('ConditionNode exposes met / not_met / error handle ids', () => {
    renderWithFlow(
      <ConditionNode
        {...makeProps(
          {
            config: {
              kind: 'sentinel',
              sentinel: { pattern: 'DONE', isRegex: false },
            },
          },
          { type: 'condition' }
        )}
      />
    );
    const card = screen.getByLabelText('condition node');
    expect(card.querySelector('[data-handleid="met"]')).not.toBeNull();
    expect(card.querySelector('[data-handleid="not_met"]')).not.toBeNull();
    expect(card.querySelector('[data-handleid="error"]')).not.toBeNull();
  });
});
