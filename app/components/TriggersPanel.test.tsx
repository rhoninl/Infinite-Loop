import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { TriggersPanel } from './TriggersPanel';
import type { Workflow } from '@/lib/shared/workflow';

const wf: Workflow = {
  id: 'wf-a', name: 'A', version: 1, createdAt: 0, updatedAt: 0,
  nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
  triggers: [
    {
      id: 'idAAAAAAAAAAAAAAAAAAAA',
      name: 'push-to-main',
      enabled: true,
      match: [{ lhs: '{{headers.x-github-event}}', op: '==', rhs: 'push' }],
      inputs: { branch: '{{body.ref}}' },
      lastFiredAt: null,
    },
    {
      id: 'idBBBBBBBBBBBBBBBBBBBB',
      name: 'pr-opened',
      enabled: false,
      match: [],
      inputs: {},
      lastFiredAt: 1_700_000_000_000,
    },
  ],
};

describe('TriggersPanel', () => {
  test('renders empty state when no triggers', () => {
    render(<TriggersPanel workflow={{ ...wf, triggers: [] }} origin="http://localhost:3000" />);
    expect(screen.getByText(/no triggers/i)).toBeTruthy();
  });

  test('renders one row per trigger with the URL', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText('push-to-main')).toBeTruthy();
    expect(screen.getByText('pr-opened')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('idAAAA'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('idBBBB'))).toBeTruthy();
  });

  test('shows Enabled/Disabled chips', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText(/Enabled/)).toBeTruthy();
    expect(screen.getByText(/Disabled/)).toBeTruthy();
  });

  test('shows Last fired and Never fired', () => {
    render(<TriggersPanel workflow={wf} origin="http://localhost:3000" />);
    expect(screen.getByText(/Never fired/i)).toBeTruthy();
    expect(screen.getByText(/Last fired/i)).toBeTruthy();
  });
});
