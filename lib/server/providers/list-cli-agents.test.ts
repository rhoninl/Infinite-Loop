import { describe, expect, it } from 'bun:test';
import { parseClaudeAgents } from './list-cli-agents';

describe('parseClaudeAgents', () => {
  it('parses the documented `claude agents` shape', () => {
    const sample = [
      '6 active agents',
      '',
      'User agents:',
      '  code-review-agent · opus',
      '  senior-review-agent · opus · user memory',
      '',
      'Built-in agents:',
      '  Explore · haiku',
      '  general-purpose · inherit',
      '  Plan · inherit',
      '  statusline-setup · sonnet',
      '',
    ].join('\n');
    const out = parseClaudeAgents(sample);
    expect(out).toEqual([
      { name: 'code-review-agent', model: 'opus', group: 'user' },
      { name: 'senior-review-agent', model: 'opus', group: 'user' },
      { name: 'Explore', model: 'haiku', group: 'builtin' },
      { name: 'general-purpose', model: 'inherit', group: 'builtin' },
      { name: 'Plan', model: 'inherit', group: 'builtin' },
      { name: 'statusline-setup', model: 'sonnet', group: 'builtin' },
    ]);
  });

  it('tolerates agents without a model column', () => {
    const sample = ['User agents:', '  bare-agent', ''].join('\n');
    const out = parseClaudeAgents(sample);
    expect(out).toEqual([
      { name: 'bare-agent', model: undefined, group: 'user' },
    ]);
  });

  it('ignores the leading summary line (no group, no indent)', () => {
    const sample = ['7 active agents', '', 'Built-in agents:', '  x · y'].join('\n');
    const out = parseClaudeAgents(sample);
    expect(out).toEqual([{ name: 'x', model: 'y', group: 'builtin' }]);
  });

  it('defaults uncategorized entries to builtin', () => {
    // Older versions may print agents without a heading.
    const sample = '  loner · sonnet\n';
    const out = parseClaudeAgents(sample);
    expect(out).toEqual([{ name: 'loner', model: 'sonnet', group: 'builtin' }]);
  });

  it('recognizes Project agents: as a separate group', () => {
    const sample = [
      '3 active agents',
      '',
      'Project agents:',
      '  shifu-helper · sonnet',
      '',
      'Built-in agents:',
      '  Explore · haiku',
    ].join('\n');
    const out = parseClaudeAgents(sample);
    expect(out).toEqual([
      { name: 'shifu-helper', model: 'sonnet', group: 'project' },
      { name: 'Explore', model: 'haiku', group: 'builtin' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseClaudeAgents('')).toEqual([]);
    expect(parseClaudeAgents('\n\n')).toEqual([]);
  });
});
