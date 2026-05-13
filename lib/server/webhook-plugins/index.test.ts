import { describe, expect, test } from 'bun:test';
import { pluginIndex } from './index';

describe('pluginIndex singleton', () => {
  test('lookup returns the built-in Generic plugin', async () => {
    const g = await pluginIndex.lookup('generic');
    expect(g?.id).toBe('generic');
  });

  test('list contains Generic', async () => {
    const all = await pluginIndex.list();
    expect(all.find((p) => p.id === 'generic')).toBeDefined();
  });

  test('lookup returns undefined for unknown id', async () => {
    expect(await pluginIndex.lookup('absent')).toBeUndefined();
  });
});
