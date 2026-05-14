import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifySignature } from './webhook-signature';

const SECRET = 'shhh';
const BODY = '{"event":"task.created","taskId":42}';
const HEX = createHmac('sha256', SECRET).update(BODY).digest('hex');
const BASE64 = createHmac('sha256', SECRET).update(BODY).digest('base64');

describe('verifySignature', () => {
  test('valid sha256=<hex> → ok', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'sha256=<hex>',
      secret: SECRET,
      bodyText: BODY,
      headerValue: `sha256=${HEX}`,
    });
    expect(r.ok).toBe(true);
  });

  test('valid bare hex → ok', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'hex',
      secret: SECRET,
      bodyText: BODY,
      headerValue: HEX,
    });
    expect(r.ok).toBe(true);
  });

  test('valid base64 → ok', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'base64',
      secret: SECRET,
      bodyText: BODY,
      headerValue: BASE64,
    });
    expect(r.ok).toBe(true);
  });

  test('tampered body → mismatch', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'sha256=<hex>',
      secret: SECRET,
      bodyText: BODY + 'x',
      headerValue: `sha256=${HEX}`,
    });
    expect(r).toEqual({ ok: false, reason: 'mismatch' });
  });

  test('wrong secret → mismatch', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'sha256=<hex>',
      secret: 'wrong',
      bodyText: BODY,
      headerValue: `sha256=${HEX}`,
    });
    expect(r).toEqual({ ok: false, reason: 'mismatch' });
  });

  test('missing header → missing-header', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'sha256=<hex>',
      secret: SECRET,
      bodyText: BODY,
      headerValue: null,
    });
    expect(r).toEqual({ ok: false, reason: 'missing-header' });
  });

  test('format sha256=<hex> without prefix → malformed-header', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'sha256=<hex>',
      secret: SECRET,
      bodyText: BODY,
      headerValue: HEX, // no sha256= prefix
    });
    expect(r).toEqual({ ok: false, reason: 'malformed-header' });
  });

  test('format hex with non-hex chars → malformed-header', () => {
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'hex',
      secret: SECRET,
      bodyText: BODY,
      headerValue: 'not-hex!!',
    });
    expect(r).toEqual({ ok: false, reason: 'malformed-header' });
  });

  test('unsupported scheme → unsupported-scheme', () => {
    const r = verifySignature({
      // @ts-expect-error — testing runtime rejection of an invalid scheme
      scheme: 'md5',
      format: 'hex',
      secret: SECRET,
      bodyText: BODY,
      headerValue: HEX,
    });
    expect(r).toEqual({ ok: false, reason: 'unsupported-scheme' });
  });

  test('mismatched digest length does not throw', () => {
    // timingSafeEqual throws on length mismatch — the wrapper must catch it.
    const r = verifySignature({
      scheme: 'hmac-sha256',
      format: 'hex',
      secret: SECRET,
      bodyText: BODY,
      headerValue: 'abcd', // too short to be a sha256 hex
    });
    expect(r).toEqual({ ok: false, reason: 'malformed-header' });
  });
});
