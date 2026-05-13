import { describe, expect, test } from 'bun:test';
import { GET } from './route';

describe('GET /api/webhook-plugins', () => {
  test('returns the loaded plugin list', async () => {
    const res = await GET(new Request('http://test/api/webhook-plugins'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.plugins)).toBe(true);
    expect(json.plugins.find((p: { id: string }) => p.id === 'generic')).toBeDefined();
  });
});
