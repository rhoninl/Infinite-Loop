import { describe, expect, test } from 'bun:test';
import { buildWebhookScope } from './webhook-scope';

describe('buildWebhookScope', () => {
  test('lowercases header names', () => {
    const headers = new Headers({ 'X-Custom': 'value' });
    const scope = buildWebhookScope({ headers, url: 'http://x/', bodyText: '{}' });
    expect(scope.headers['x-custom']).toBe('value');
  });

  test('joins multi-value headers with comma', () => {
    const headers = new Headers();
    headers.append('x-multi', 'a');
    headers.append('x-multi', 'b');
    const scope = buildWebhookScope({ headers, url: 'http://x/', bodyText: '' });
    expect(scope.headers['x-multi']).toBe('a, b');
  });

  test('parses JSON body into nested scope', () => {
    const body = JSON.stringify({ ref: 'refs/heads/main', commits: [{ id: 'sha1' }] });
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/',
      bodyText: body,
    });
    expect(scope.body.ref).toBe('refs/heads/main');
    expect((scope.body.commits as Array<{ id: string }>)[0].id).toBe('sha1');
  });

  test('non-JSON body surfaces as body.raw', () => {
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/',
      bodyText: 'plain text',
    });
    expect(scope.body.raw).toBe('plain text');
  });

  test('query parameters parsed into scope.query', () => {
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/?from=github&since=2026-01-01',
      bodyText: '{}',
    });
    expect(scope.query.from).toBe('github');
    expect(scope.query.since).toBe('2026-01-01');
  });

  test('empty bodyText yields empty body record', () => {
    const scope = buildWebhookScope({
      headers: new Headers(),
      url: 'http://x/',
      bodyText: '',
    });
    expect(scope.body).toEqual({});
  });
});
