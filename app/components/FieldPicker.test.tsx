import { describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldPicker } from './FieldPicker';
import type { PluginField } from '@/lib/shared/trigger';

const fields: PluginField[] = [
  { path: 'body.action', type: 'string', description: 'opened, closed, …' },
  { path: 'body.issue.number', type: 'number' },
  { path: 'body.issue.title', type: 'string' },
];

describe('FieldPicker', () => {
  test('renders the current value in the input', () => {
    render(<FieldPicker fields={fields} value="{{body.action}}" onChange={() => {}} />);
    const input = screen.getByDisplayValue('{{body.action}}') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  test('opens the dropdown on focus and shows all fields', () => {
    render(<FieldPicker fields={fields} value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/{{.*}}/);
    fireEvent.focus(input);
    expect(screen.getByText('body.action')).toBeTruthy();
    expect(screen.getByText('body.issue.number')).toBeTruthy();
    expect(screen.getByText('body.issue.title')).toBeTruthy();
  });

  test('clicking an option calls onChange with {{path}}', () => {
    let captured = '';
    render(<FieldPicker fields={fields} value="" onChange={(v) => { captured = v; }} />);
    const input = screen.getByPlaceholderText(/{{.*}}/);
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText('body.issue.number'));
    expect(captured).toBe('{{body.issue.number}}');
  });

  test('typing a custom value calls onChange with the typed text', () => {
    let captured = '';
    render(<FieldPicker fields={fields} value="" onChange={(v) => { captured = v; }} />);
    const input = screen.getByPlaceholderText(/{{.*}}/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '{{body.custom.path}}' } });
    expect(captured).toBe('{{body.custom.path}}');
  });

  test('shows a not-in-schema warning when value is a template not in declared fields', () => {
    render(<FieldPicker fields={fields} value="{{body.custom.path}}" onChange={() => {}} />);
    expect(screen.getByTitle(/not in the plugin's declared schema/i)).toBeTruthy();
  });

  test('no warning when value matches a declared field', () => {
    render(<FieldPicker fields={fields} value="{{body.action}}" onChange={() => {}} />);
    expect(screen.queryByTitle(/not in the plugin's declared schema/i)).toBeNull();
  });

  test('no warning when value is empty', () => {
    render(<FieldPicker fields={fields} value="" onChange={() => {}} />);
    expect(screen.queryByTitle(/not in the plugin's declared schema/i)).toBeNull();
  });

  test('no warning when fields array is empty (Generic plugin)', () => {
    render(<FieldPicker fields={[]} value="{{body.x}}" onChange={() => {}} />);
    expect(screen.queryByTitle(/not in the plugin's declared schema/i)).toBeNull();
  });
});
