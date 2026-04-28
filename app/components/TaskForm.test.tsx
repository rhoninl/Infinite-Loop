import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskForm from './TaskForm';
import type { RunConfig } from '../../lib/shared/types';

describe('TaskForm', () => {
  it('renders all default-visible fields with sentinel config by default', () => {
    render(<TaskForm onSubmit={() => {}} />);

    expect(screen.getByLabelText(/Prompt/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Working directory/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Exit condition/i)).toBeInTheDocument();
    // sentinel by default
    expect(screen.getByLabelText(/^Pattern$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Treat pattern as regex/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Max iterations/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Iteration timeout/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start run/i }),
    ).toBeInTheDocument();
  });

  it('switching to command hides sentinel inputs and shows cmd input', () => {
    render(<TaskForm onSubmit={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Exit condition/i), {
      target: { value: 'command' },
    });

    expect(screen.queryByLabelText(/^Pattern$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Treat pattern as regex/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Command/i)).toBeInTheDocument();
  });

  it('switching to judge shows rubric and model inputs', () => {
    render(<TaskForm onSubmit={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Exit condition/i), {
      target: { value: 'judge' },
    });

    expect(screen.queryByLabelText(/^Pattern$/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Rubric/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Model/i)).toBeInTheDocument();
  });

  it('submitting a valid sentinel form calls onSubmit once with shaped RunConfig', () => {
    const onSubmit = vi.fn();
    render(<TaskForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Prompt/i), {
      target: { value: 'do the thing' },
    });
    fireEvent.change(screen.getByLabelText(/Working directory/i), {
      target: { value: '/tmp/work' },
    });
    fireEvent.change(screen.getByLabelText(/^Pattern$/i), {
      target: { value: 'DONE' },
    });
    fireEvent.click(screen.getByLabelText(/Treat pattern as regex/i));
    fireEvent.change(screen.getByLabelText(/Max iterations/i), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText(/Iteration timeout/i), {
      target: { value: '30000' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start run/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const cfg = onSubmit.mock.calls[0][0] as RunConfig;
    expect(cfg).toEqual({
      prompt: 'do the thing',
      cwd: '/tmp/work',
      condition: {
        type: 'sentinel',
        config: { pattern: 'DONE', isRegex: true },
      },
      maxIterations: 10,
      iterationTimeoutMs: 30000,
    });
  });

  it('does not call onSubmit when required fields are empty', () => {
    const onSubmit = vi.fn();
    render(<TaskForm onSubmit={onSubmit} />);

    // Click submit without filling anything in.
    fireEvent.click(screen.getByRole('button', { name: /start run/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables submit button when disabled=true', () => {
    render(<TaskForm disabled onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: /start run/i })).toBeDisabled();
  });
});
