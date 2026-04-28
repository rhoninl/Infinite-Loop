import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Palette from './Palette';

describe('Palette', () => {
  it('renders all five draggable node items, each findable by aria-label', () => {
    render(<Palette />);

    const types = ['start', 'end', 'loop', 'claude', 'condition'] as const;
    for (const t of types) {
      const item = screen.getByRole('button', { name: `add ${t} node` });
      expect(item).toBeInTheDocument();
      expect(item).toHaveAttribute('draggable', 'true');
    }
  });

  it('renders Control and I/O category headings', () => {
    render(<Palette />);

    expect(
      screen.getByRole('heading', { name: /control/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /i\/o/i }),
    ).toBeInTheDocument();
  });

  it('onDragStart on the Claude item writes a JSON payload with type:"claude" to dataTransfer', () => {
    render(<Palette />);

    const claudeItem = screen.getByRole('button', { name: 'add claude node' });

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };

    fireEvent.dragStart(claudeItem, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledTimes(1);
    const [mime, payload] = dataTransfer.setData.mock.calls[0];
    expect(mime).toBe('application/x-infloop-node');
    expect(JSON.parse(payload)).toEqual({ type: 'claude' });
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('keeps every palette item in the natural tab order', () => {
    render(<Palette />);

    const types = ['start', 'end', 'loop', 'claude', 'condition'] as const;
    for (const t of types) {
      const item = screen.getByRole('button', { name: `add ${t} node` });
      // <button> is implicitly focusable; explicit tabIndex must not be -1.
      const tabIndex = item.getAttribute('tabindex');
      expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);
    }
  });
});
