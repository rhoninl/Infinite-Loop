import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Palette from './Palette';

const PROVIDERS = [
  { id: 'claude', label: 'Claude', description: 'spawn claude --print', glyph: '⟳' },
  { id: 'codex', label: 'Codex', description: 'spawn codex exec', glyph: '◈' },
];

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/api/providers')) {
      return new Response(JSON.stringify({ providers: PROVIDERS }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Palette', () => {
  it('renders the static (non-provider) draggable node items', () => {
    render(<Palette />);

    const types = ['start', 'end', 'loop', 'condition'] as const;
    for (const t of types) {
      const item = screen.getByRole('button', { name: `add ${t} node` });
      expect(item).toBeInTheDocument();
      expect(item).toHaveAttribute('draggable', 'true');
    }
  });

  it('renders Control, I/O, and Model Runners category headings', async () => {
    render(<Palette />);

    expect(screen.getByRole('heading', { name: /control/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /i\/o/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /model runners/i })).toBeInTheDocument();
    // Provider list is fetched async — wait for them.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'add claude agent node' }),
      ).toBeInTheDocument();
    });
  });

  it('dragStart on the Claude provider writes type:"agent" + providerId:"claude"', async () => {
    render(<Palette />);

    const claudeItem = await waitFor(() =>
      screen.getByRole('button', { name: 'add claude agent node' }),
    );

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };

    fireEvent.dragStart(claudeItem, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledTimes(1);
    const [mime, payload] = dataTransfer.setData.mock.calls[0];
    expect(mime).toBe('application/x-infloop-node');
    expect(JSON.parse(payload)).toEqual({ type: 'agent', providerId: 'claude' });
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('keeps every palette item in the natural tab order', () => {
    render(<Palette />);

    const types = ['start', 'end', 'loop', 'condition'] as const;
    for (const t of types) {
      const item = screen.getByRole('button', { name: `add ${t} node` });
      const tabIndex = item.getAttribute('tabindex');
      expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);
    }
  });
});
