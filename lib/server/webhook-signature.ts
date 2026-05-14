import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PluginSignature } from '../shared/trigger';

export interface VerifyArgs {
  scheme: PluginSignature['scheme'];
  format: PluginSignature['format'];
  secret: string;
  bodyText: string;
  headerValue: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing-header' | 'malformed-header' | 'mismatch' | 'unsupported-scheme' };

const HEX_RE = /^[0-9a-f]+$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function verifySignature(args: VerifyArgs): VerifyResult {
  if (args.scheme !== 'hmac-sha256') {
    return { ok: false, reason: 'unsupported-scheme' };
  }
  if (args.headerValue === null || args.headerValue.length === 0) {
    return { ok: false, reason: 'missing-header' };
  }

  let received: Buffer;
  switch (args.format) {
    case 'sha256=<hex>': {
      if (!args.headerValue.startsWith('sha256=')) {
        return { ok: false, reason: 'malformed-header' };
      }
      const hex = args.headerValue.slice('sha256='.length);
      if (!HEX_RE.test(hex) || hex.length !== 64) {
        return { ok: false, reason: 'malformed-header' };
      }
      received = Buffer.from(hex, 'hex');
      break;
    }
    case 'hex': {
      if (!HEX_RE.test(args.headerValue) || args.headerValue.length !== 64) {
        return { ok: false, reason: 'malformed-header' };
      }
      received = Buffer.from(args.headerValue, 'hex');
      break;
    }
    case 'base64': {
      if (!BASE64_RE.test(args.headerValue)) {
        return { ok: false, reason: 'malformed-header' };
      }
      received = Buffer.from(args.headerValue, 'base64');
      if (received.length !== 32) {
        return { ok: false, reason: 'malformed-header' };
      }
      break;
    }
    default: {
      // Exhaustiveness — format is a union of literals.
      return { ok: false, reason: 'malformed-header' };
    }
  }

  const expected = createHmac('sha256', args.secret).update(args.bodyText).digest();

  if (expected.length !== received.length) {
    // Defensive: timingSafeEqual throws on length mismatch.
    return { ok: false, reason: 'mismatch' };
  }
  return timingSafeEqual(expected, received) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
