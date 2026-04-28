import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RunPanel from './RunPanel';
import type { RunConfig, RunEvent } from '../../lib/shared/types';

const baseCfg: RunConfig = {
  prompt: 'do the thing',
  cwd: '/tmp',
  condition: { type: 'sentinel', config: { pattern: 'DONE', isRegex: false } },
  maxIterations: 5,
  iterationTimeoutMs: 60000,
};

describe('RunPanel', () => {
  it('renders idle state with empty events and no iterations or stop button', () => {
    render(<RunPanel events={[]} wsStatus="closed" onStop={() => {}} />);

    const badge = screen.getByLabelText('run status');
    expect(badge).toHaveTextContent('idle');
    expect(badge).toHaveAttribute('data-status', 'idle');

    expect(screen.getByLabelText('websocket status')).toHaveTextContent(
      'WS: closed',
    );

    expect(screen.queryByLabelText('stop run')).not.toBeInTheDocument();

    const list = screen.getByLabelText('iterations');
    expect(within(list).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows running status, iteration row with stdout, and stop button', () => {
    const events: RunEvent[] = [
      { type: 'run_started', cfg: baseCfg },
      { type: 'iteration_started', n: 1 },
      { type: 'stdout_chunk', n: 1, line: 'hello' },
    ];

    render(<RunPanel events={events} wsStatus="open" onStop={() => {}} />);

    expect(screen.getByLabelText('run status')).toHaveTextContent('running');
    expect(screen.getByLabelText('stop run')).toBeInTheDocument();

    const stdout = screen.getByLabelText('iteration 1 stdout');
    expect(stdout).toHaveTextContent('hello');
  });

  it('renders iteration finished metadata and condition result', () => {
    const events: RunEvent[] = [
      { type: 'run_started', cfg: baseCfg },
      { type: 'iteration_started', n: 1 },
      { type: 'stdout_chunk', n: 1, line: 'output' },
      {
        type: 'iteration_finished',
        n: 1,
        exitCode: 0,
        durationMs: 100,
        timedOut: false,
      },
      { type: 'condition_checked', n: 1, met: true, detail: 'matched' },
    ];

    render(<RunPanel events={events} wsStatus="open" onStop={() => {}} />);

    const result = screen.getByLabelText('iteration 1 result');
    expect(result).toHaveTextContent('exit: 0');
    expect(result).toHaveTextContent('duration: 100ms');
    expect(result).not.toHaveTextContent('timedOut');

    const cond = screen.getByLabelText('iteration 1 condition');
    expect(cond).toHaveTextContent('met: true');
    expect(cond).toHaveTextContent('detail: matched');
  });

  it('shows succeeded outcome and hides stop button after run_finished', () => {
    const events: RunEvent[] = [
      { type: 'run_started', cfg: baseCfg },
      { type: 'iteration_started', n: 1 },
      {
        type: 'iteration_finished',
        n: 1,
        exitCode: 0,
        durationMs: 50,
        timedOut: false,
      },
      { type: 'condition_checked', n: 1, met: true, detail: 'ok' },
      {
        type: 'run_finished',
        outcome: 'succeeded',
        iterations: [
          {
            n: 1,
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 50,
            timedOut: false,
            conditionMet: true,
            conditionDetail: 'ok',
          },
        ],
      },
    ];

    render(<RunPanel events={events} wsStatus="open" onStop={() => {}} />);

    expect(screen.getByLabelText('run status')).toHaveTextContent('succeeded');
    expect(screen.queryByLabelText('stop run')).not.toBeInTheDocument();
  });

  it('calls onStop exactly once when the stop button is clicked while running', () => {
    const onStop = vi.fn();
    const events: RunEvent[] = [
      { type: 'run_started', cfg: baseCfg },
      { type: 'iteration_started', n: 1 },
    ];

    render(<RunPanel events={events} wsStatus="open" onStop={onStop} />);

    fireEvent.click(screen.getByLabelText('stop run'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('renders error events in the errors block', () => {
    const events: RunEvent[] = [
      {
        type: 'error',
        message: 'something went wrong',
        stderr: 'boom\nstack',
      },
    ];

    render(<RunPanel events={events} wsStatus="open" onStop={() => {}} />);

    const errBlock = screen.getByLabelText('errors');
    expect(errBlock).toHaveTextContent('something went wrong');
    expect(errBlock).toHaveTextContent('boom');
  });
});
