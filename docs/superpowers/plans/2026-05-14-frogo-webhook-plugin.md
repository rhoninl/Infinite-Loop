# Frogo Webhook Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Frogo webhook plugin to InfLoop, including a generic HMAC-SHA256 signature verification mechanism that any future plugin can opt into declaratively.

**Architecture:** A new `webhook-plugins/frogo.json` describes Frogo's events and signing scheme. The plugin schema gains an optional `signature` block; the `WebhookTrigger` gains optional `secret` + `verifyOptional` fields. A pure verification helper (`lib/server/webhook-signature.ts`) does the HMAC math. The webhook ingestion route enforces verification per the §3 gate matrix from the spec. The triggers POST/PUT routes reject misconfigured triggers at save time (defense in depth).

**Tech Stack:** TypeScript, Bun test runner (`bun:test`), Next.js 15 route handlers, `node:crypto` for HMAC.

**Spec:** `docs/superpowers/specs/2026-05-14-frogo-webhook-plugin-design.md`

**Convention notes (verified before writing this plan):**
- The existing `WebhookTrigger` already includes `workflowId`, `pluginId`, `eventType`, `createdAt`, `updatedAt` beyond what the spec sketched. New fields just add onto it.
- The existing triggers routes return `400 { error: 'invalid-trigger', reason: '...' }` for save-validation errors, not `422`. **This plan uses 400 to match existing convention** even though the spec sketched 422.
- Test runner imports come from `bun:test`. Tests live next to source as `*.test.ts`.
- The loader function is `validatePlugin` in `lib/server/webhook-plugins/loader.ts`; the singleton is `pluginIndex` in `lib/server/webhook-plugins/index.ts`. Header normalization happens at parse time inside `validatePlugin`.

---

## File map

**New files:**
- `webhook-plugins/frogo.json` — declarative plugin
- `lib/server/webhook-signature.ts` — pure HMAC verification helper
- `lib/server/webhook-signature.test.ts` — unit tests

**Modified files:**
- `lib/shared/trigger.ts` — add `PluginSignature` type, `WebhookPlugin.signature?`, `WebhookTrigger.secret?`, `WebhookTrigger.verifyOptional?`
- `lib/server/webhook-plugins/loader.ts` — validate `signature` block; lowercase `eventHeader` and `signature.header` at load time
- `lib/server/webhook-plugins/loader.test.ts` — extend with signature-block tests
- `app/api/webhook/[triggerId]/route.ts` — insert verification gate
- `app/api/webhook/[triggerId]/route.test.ts` — extend with verification cases
- `app/api/triggers/route.ts` — call save-time validator before `saveTrigger` on POST
- `app/api/triggers/[id]/route.ts` — same on PUT
- `app/api/triggers/route.test.ts` — extend with misconfig cases (POST)
- `app/api/triggers/[id]/route.test.ts` — extend with misconfig cases (PUT)

A small helper module `lib/server/trigger-validation.ts` (+ test) hosts the shared save-time check so POST and PUT don't duplicate it.

---

## Task 1: Extend `WebhookPlugin` and `WebhookTrigger` types

Pure type-only change. No tests; verified via `bun run typecheck`. Lays foundation for every following task.

**Files:**
- Modify: `lib/shared/trigger.ts`

- [ ] **Step 1: Add `PluginSignature` type and `signature` field to `WebhookPlugin`**

Open `lib/shared/trigger.ts`. After the existing `PluginEvent` interface and before `WebhookPlugin`, add:

```ts
export interface PluginSignature {
  /** Header carrying the signature. Normalized to lowercase by validatePlugin
   *  at load time, so route-side lookups can use the lowercased key. */
  header: string;
  /** Verification scheme. v1 supports `hmac-sha256` only. */
  scheme: 'hmac-sha256';
  /** How to parse the header value to extract the digest. v1 covers schemes
   *  that HMAC the raw request body. Stripe-style (HMAC of constructed
   *  payload) is intentionally not supported and would need a schema-
   *  incompatible extension. */
  format: 'sha256=<hex>' | 'hex' | 'base64';
}
```

Then in `WebhookPlugin`, add the optional field — keep the existing fields exactly as they are:

```ts
export interface WebhookPlugin {
  id: string;
  displayName: string;
  icon?: string;
  eventHeader?: string;
  events: PluginEvent[];
  // NEW:
  signature?: PluginSignature;
}
```

- [ ] **Step 2: Add `secret` and `verifyOptional` to `WebhookTrigger`**

Locate `WebhookTrigger` (around L13). Append the two new fields to the existing interface — do not remove anything:

```ts
export interface WebhookTrigger {
  // ...all existing fields unchanged: id, name, enabled, workflowId,
  //    pluginId, eventType, match, inputs, createdAt, updatedAt, lastFiredAt...

  /** Shared secret for signature verification. Required when the trigger's
   *  plugin declares a `signature` block, unless verifyOptional === true. */
  secret?: string;

  /** Explicit opt-out from signature verification even when the plugin
   *  declares a `signature` block. Intended for local development against
   *  a Frogo instance with no subscription secret. When true, the route
   *  accepts the request without checking the signature header and logs a
   *  one-line warning. */
  verifyOptional?: boolean;
}
```

- [ ] **Step 3: Typecheck passes**

Run: `bun run typecheck`
Expected: no errors (the new fields are optional; nothing else changes).

- [ ] **Step 4: Commit**

```bash
git add lib/shared/trigger.ts
git commit -m "feat(triggers): add optional signature schema + per-trigger secret types"
```

---

## Task 2: HMAC verification helper (TDD)

Pure module, no I/O, no logging. Easy to test in isolation. Returns a tagged-union result so the caller can map granular reasons to logs while keeping the wire response uniform.

**Files:**
- Create: `lib/server/webhook-signature.ts`
- Test: `lib/server/webhook-signature.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/server/webhook-signature.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/server/webhook-signature.test.ts`
Expected: FAIL — `Cannot find module './webhook-signature'` (or similar).

- [ ] **Step 3: Implement the helper**

Create `lib/server/webhook-signature.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/server/webhook-signature.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/webhook-signature.ts lib/server/webhook-signature.test.ts
git commit -m "feat(webhook): pure HMAC-SHA256 verification helper"
```

---

## Task 3: Loader — validate `signature` block, lowercase headers

The loader gains validation of the optional signature block and normalizes both `eventHeader` and `signature.header` to lowercase at parse time.

**Files:**
- Modify: `lib/server/webhook-plugins/loader.ts`
- Modify: `lib/server/webhook-plugins/loader.test.ts`

- [ ] **Step 1: Add the failing tests to `loader.test.ts`**

Append the following test cases inside the existing `describe('loadPlugins', () => { ... })` block:

```ts
  test('loads a plugin with a valid signature block and lowercases the header', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'X-Frogo-Event',
      signature: {
        header: 'X-Frogo-Signature',
        scheme: 'hmac-sha256',
        format: 'sha256=<hex>',
      },
      events: [
        {
          type: 'task.created',
          displayName: 'Task created',
          fields: [{ path: 'body.event', type: 'string' }],
        },
      ],
    });
    const plugins = await loadPlugins(tmpDir);
    const f = plugins.find((p) => p.id === 'frogo');
    expect(f).toBeDefined();
    expect(f?.eventHeader).toBe('x-frogo-event');
    expect(f?.signature?.header).toBe('x-frogo-signature');
    expect(f?.signature?.scheme).toBe('hmac-sha256');
    expect(f?.signature?.format).toBe('sha256=<hex>');
  });

  test('rejects a plugin with an unsupported signature scheme', async () => {
    await writePlugin('bad-scheme', {
      id: 'badscheme',
      displayName: 'Bad',
      eventHeader: 'x-e',
      signature: { header: 'x-sig', scheme: 'md5', format: 'hex' },
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'badscheme')).toBeUndefined();
  });

  test('rejects a plugin with an unknown signature format', async () => {
    await writePlugin('bad-format', {
      id: 'badformat',
      displayName: 'Bad',
      eventHeader: 'x-e',
      signature: { header: 'x-sig', scheme: 'hmac-sha256', format: 'pem' },
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'badformat')).toBeUndefined();
  });

  test('rejects a plugin where signature is present but header is missing', async () => {
    await writePlugin('no-header', {
      id: 'noheader',
      displayName: 'Bad',
      eventHeader: 'x-e',
      signature: { scheme: 'hmac-sha256', format: 'hex' },
      events: [{ type: 'x', displayName: 'X', fields: [] }],
    });
    const plugins = await loadPlugins(tmpDir);
    expect(plugins.find((p) => p.id === 'noheader')).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/server/webhook-plugins/loader.test.ts`
Expected: the four new tests FAIL (the lowercase-header test fails on `eventHeader`/`signature.header` assertions; the rejection tests fail because the bad plugins currently load).

- [ ] **Step 3: Update `loader.ts` to validate signatures and lowercase headers**

In `lib/server/webhook-plugins/loader.ts`, add a new validator and call it from `validatePlugin`. Also normalize headers.

Add this helper above `validatePlugin`:

```ts
const SIG_FORMATS: PluginSignature['format'][] = ['sha256=<hex>', 'hex', 'base64'];

function validatePluginSignature(v: unknown, file: string): PluginSignature {
  if (!v || typeof v !== 'object') {
    throw new Error(`${file}: signature must be an object`);
  }
  const s = v as Record<string, unknown>;
  if (!isStringNonEmpty(s.header)) {
    throw new Error(`${file}: signature.header must be non-empty string`);
  }
  if (s.scheme !== 'hmac-sha256') {
    throw new Error(`${file}: signature.scheme must be "hmac-sha256"`);
  }
  if (typeof s.format !== 'string' || !SIG_FORMATS.includes(s.format as PluginSignature['format'])) {
    throw new Error(`${file}: signature.format must be one of ${SIG_FORMATS.join(', ')}`);
  }
  return {
    header: s.header.toLowerCase(),
    scheme: 'hmac-sha256',
    format: s.format as PluginSignature['format'],
  };
}
```

Update the import at the top of the file:

```ts
import type {
  PluginEvent,
  PluginField,
  PluginFieldType,
  PluginSignature,
  WebhookPlugin,
} from '../../shared/trigger';
```

In `validatePlugin`, after the existing `eventHeader` validation, lowercase it and validate `signature`. The final return block becomes:

```ts
  return {
    id: p.id,
    displayName: p.displayName,
    icon: typeof p.icon === 'string' ? p.icon : undefined,
    eventHeader: typeof p.eventHeader === 'string'
      ? p.eventHeader.toLowerCase()
      : undefined,
    events,
    signature: p.signature !== undefined
      ? validatePluginSignature(p.signature, file)
      : undefined,
  };
```

- [ ] **Step 4: Run all loader tests to verify they pass**

Run: `bun test lib/server/webhook-plugins/loader.test.ts`
Expected: all tests PASS (including the four new ones and the existing ones — the existing test that writes `eventHeader: 'x-github-event'` is already lowercase, so it keeps passing).

- [ ] **Step 5: Commit**

```bash
git add lib/server/webhook-plugins/loader.ts lib/server/webhook-plugins/loader.test.ts
git commit -m "feat(webhook-plugins): validate optional signature block; lowercase headers at load"
```

---

## Task 4: Webhook ingestion route — verification gate

Wire the verification gate into `POST /api/webhook/[triggerId]` per the spec §3 matrix:
- No `plugin.signature` → skip
- `plugin.signature` + `trigger.secret` set → verify; 401 on non-ok
- `plugin.signature` + no secret + `verifyOptional === true` → skip with warning log
- `plugin.signature` + no secret + no opt-out → 500 `trigger-misconfigured`

**Files:**
- Modify: `app/api/webhook/[triggerId]/route.ts`
- Modify: `app/api/webhook/[triggerId]/route.test.ts`

- [ ] **Step 1: Add the failing tests**

Append inside the existing `describe('POST /api/webhook/[triggerId]', () => { ... })` block. Use the test helpers (`mkReq`, `writeWorkflow`, `saveTrigger`) that are already at the top of the file.

```ts
  test('verifies signature: valid sha256=<hex> → 202', async () => {
    const { createHmac } = await import('node:crypto');
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'x-frogo-event',
      signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
      events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
    });
    pluginIndex.invalidate();
    await writeWorkflow('wf-frogo');
    await saveTrigger({
      id: goodId, name: 't', enabled: true,
      workflowId: 'wf-frogo', pluginId: 'frogo', eventType: 'task.created',
      match: [], inputs: {}, secret: 'shhh',
    });

    const body = JSON.stringify({ event: 'task.created', taskId: 1 });
    const sig = 'sha256=' + createHmac('sha256', 'shhh').update(body).digest('hex');
    const res = await POST(
      mkReq(goodId, body, { 'x-frogo-event': 'task.created', 'x-frogo-signature': sig }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(202);
  });

  test('verifies signature: bad signature → 401 bad-signature', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'x-frogo-event',
      signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
      events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
    });
    pluginIndex.invalidate();
    await writeWorkflow('wf-frogo');
    await saveTrigger({
      id: goodId, name: 't', enabled: true,
      workflowId: 'wf-frogo', pluginId: 'frogo', eventType: 'task.created',
      match: [], inputs: {}, secret: 'shhh',
    });

    const body = JSON.stringify({ event: 'task.created', taskId: 1 });
    const res = await POST(
      mkReq(goodId, body, {
        'x-frogo-event': 'task.created',
        'x-frogo-signature': 'sha256=' + 'a'.repeat(64),
      }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'bad-signature' });
  });

  test('verifies signature: missing header → 401 bad-signature', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'x-frogo-event',
      signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
      events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
    });
    pluginIndex.invalidate();
    await writeWorkflow('wf-frogo');
    await saveTrigger({
      id: goodId, name: 't', enabled: true,
      workflowId: 'wf-frogo', pluginId: 'frogo', eventType: 'task.created',
      match: [], inputs: {}, secret: 'shhh',
    });

    const res = await POST(
      mkReq(goodId, { event: 'task.created' }, { 'x-frogo-event': 'task.created' }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(401);
  });

  test('verifyOptional=true on signed-plugin trigger → 202 without verification', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'x-frogo-event',
      signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
      events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
    });
    pluginIndex.invalidate();
    await writeWorkflow('wf-frogo');
    await saveTrigger({
      id: goodId, name: 't', enabled: true,
      workflowId: 'wf-frogo', pluginId: 'frogo', eventType: 'task.created',
      match: [], inputs: {}, verifyOptional: true,
    });

    const res = await POST(
      mkReq(goodId, { event: 'task.created' }, { 'x-frogo-event': 'task.created' }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(202);
  });

  test('signed plugin + no secret + no verifyOptional → 500 trigger-misconfigured', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'x-frogo-event',
      signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
      events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
    });
    pluginIndex.invalidate();
    await writeWorkflow('wf-frogo');
    // Save bypasses route-level validation since trigger-store has no plugin
    // knowledge; this case tests the route-level backstop.
    await saveTrigger({
      id: goodId, name: 't', enabled: true,
      workflowId: 'wf-frogo', pluginId: 'frogo', eventType: 'task.created',
      match: [], inputs: {},
    });

    const res = await POST(
      mkReq(goodId, { event: 'task.created' }, { 'x-frogo-event': 'task.created' }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'trigger-misconfigured' });
  });

  test('plugin without signature block → no verification applied', async () => {
    // generic builtin has no signature block → trigger with stale secret should not be rejected
    await writeWorkflow('wf-a');
    await saveTrigger({
      id: goodId, name: 't', enabled: true,
      workflowId: 'wf-a', pluginId: 'generic',
      match: [], inputs: {}, secret: 'leftover',
    });
    const res = await POST(
      mkReq(goodId, { event: 'whatever' }),
      { params: Promise.resolve({ triggerId: goodId }) },
    );
    expect(res.status).toBe(202);
  });
```

A helper that writes a plugin to the on-disk plugin dir is needed; the existing test file does not have one. Add it near the top of the file, right after the existing `writeWorkflow` helper:

```ts
const tmpPluginDir = path.join(os.tmpdir(), `infinite-loop-webhook-plugins-${process.pid}`);

async function writePlugin(name: string, body: unknown) {
  await fs.writeFile(path.join(tmpPluginDir, `${name}.json`), JSON.stringify(body), 'utf8');
}
```

And extend `beforeEach`/`afterEach` to manage `tmpPluginDir` and set `INFLOOP_WEBHOOK_PLUGINS_DIR`. Update them like this (the additions are marked):

```ts
beforeEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.rm(tmpPluginDir, { recursive: true, force: true });   // NEW
  await fs.mkdir(tmpWfDir, { recursive: true });
  await fs.mkdir(tmpTrDir, { recursive: true });
  await fs.mkdir(tmpPluginDir, { recursive: true });             // NEW
  process.env.INFLOOP_WORKFLOWS_DIR = tmpWfDir;
  process.env.INFLOOP_TRIGGERS_DIR = tmpTrDir;
  process.env.INFLOOP_WEBHOOK_PLUGINS_DIR = tmpPluginDir;        // NEW
  triggerIndex.invalidate();
  pluginIndex.invalidate();
  triggerQueue.clear();
});

afterEach(async () => {
  await fs.rm(tmpWfDir, { recursive: true, force: true });
  await fs.rm(tmpTrDir, { recursive: true, force: true });
  await fs.rm(tmpPluginDir, { recursive: true, force: true });   // NEW
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `bun test app/api/webhook/\[triggerId\]/route.test.ts`
Expected: the 6 new tests FAIL. The "valid signature" and "verifyOptional" tests likely return 202 already (route hasn't been changed yet, so verification is effectively skipped — these are the regressions to watch). The "bad signature", "missing header", and "misconfigured" tests will fail because the route returns 202 instead of 401 / 500.

(If "valid signature" + "verifyOptional" pass at this stage, that's actually expected — the failing ones are the security-critical 401/500 cases. Either way, proceed to Step 3.)

- [ ] **Step 3: Wire the verification gate into the route**

Edit `app/api/webhook/[triggerId]/route.ts`. After the existing `bodyText` read and `MAX_BODY_BYTES` check (around L67), and before `buildWebhookScope`, insert the verification gate:

```ts
  // NEW — verification gate (spec §3 matrix)
  if (plugin.signature) {
    if (hit.trigger.secret) {
      const verdict = verifySignature({
        scheme: plugin.signature.scheme,
        format: plugin.signature.format,
        secret: hit.trigger.secret,
        bodyText,
        headerValue: req.headers.get(plugin.signature.header),
      });
      if (!verdict.ok) {
        console.error(
          `[webhook] signature verification failed for trigger ${hit.trigger.id}: ${verdict.reason}`,
        );
        return NextResponse.json({ error: 'bad-signature' }, { status: 401 });
      }
    } else if (hit.trigger.verifyOptional === true) {
      console.warn(
        `[webhook] verifyOptional=true on trigger ${hit.trigger.id} — accepting unsigned request`,
      );
    } else {
      console.error(
        `[webhook] trigger ${hit.trigger.id} requires a secret (plugin "${plugin.id}" declares signing) and has neither secret nor verifyOptional set`,
      );
      return NextResponse.json({ error: 'trigger-misconfigured' }, { status: 500 });
    }
  }
```

Add the import at the top of the file (alongside the existing `evaluatePredicate`, `resolve as resolveTemplate`, etc.):

```ts
import { verifySignature } from '@/lib/server/webhook-signature';
```

- [ ] **Step 4: Run all route tests to verify they pass**

Run: `bun test app/api/webhook/\[triggerId\]/route.test.ts`
Expected: all tests PASS — the new ones and the unchanged ones (the existing tests use `pluginId: 'generic'`, which has no signature block, so they go through the no-op path).

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook/\[triggerId\]/route.ts app/api/webhook/\[triggerId\]/route.test.ts
git commit -m "feat(webhook): enforce HMAC signature verification gate per spec §3 matrix"
```

---

## Task 5: Trigger save-time validation (defense in depth)

Add a pure validator and call it from POST `/api/triggers` and PUT `/api/triggers/[id]` before `saveTrigger`. Match the existing error shape — `400 { error: 'invalid-trigger', reason: 'secret-required' }`.

**Files:**
- Create: `lib/server/trigger-validation.ts`
- Create: `lib/server/trigger-validation.test.ts`
- Modify: `app/api/triggers/route.ts`
- Modify: `app/api/triggers/[id]/route.ts`
- Modify: `app/api/triggers/route.test.ts`
- Modify: `app/api/triggers/[id]/route.test.ts`

- [ ] **Step 1: Write the failing unit tests for the validator**

Create `lib/server/trigger-validation.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { validateTriggerAgainstPlugin } from './trigger-validation';
import type { WebhookPlugin, WebhookTrigger } from '../shared/trigger';

const signedPlugin: WebhookPlugin = {
  id: 'frogo',
  displayName: 'Frogo',
  eventHeader: 'x-frogo-event',
  signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
  events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
};
const unsignedPlugin: WebhookPlugin = {
  id: 'generic',
  displayName: 'Generic',
  events: [{ type: 'any', displayName: 'Any POST', fields: [] }],
};

function mk(t: Partial<WebhookTrigger>): WebhookTrigger {
  return {
    id: 'id', name: 'n', enabled: true,
    workflowId: 'wf', pluginId: 'frogo',
    match: [], inputs: {},
    ...t,
  } as WebhookTrigger;
}

describe('validateTriggerAgainstPlugin', () => {
  test('signed plugin + secret → ok', () => {
    const r = validateTriggerAgainstPlugin(mk({ secret: 's' }), signedPlugin);
    expect(r).toEqual({ ok: true });
  });

  test('signed plugin + verifyOptional → ok', () => {
    const r = validateTriggerAgainstPlugin(mk({ verifyOptional: true }), signedPlugin);
    expect(r).toEqual({ ok: true });
  });

  test('signed plugin + no secret + no opt-out → secret-required', () => {
    const r = validateTriggerAgainstPlugin(mk({}), signedPlugin);
    expect(r).toEqual({ ok: false, reason: 'secret-required' });
  });

  test('unsigned plugin → always ok', () => {
    const r = validateTriggerAgainstPlugin(
      mk({ pluginId: 'generic' }),
      unsignedPlugin,
    );
    expect(r).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/server/trigger-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `lib/server/trigger-validation.ts`:

```ts
import type { WebhookPlugin, WebhookTrigger } from '../shared/trigger';

export type TriggerValidationResult =
  | { ok: true }
  | { ok: false; reason: 'secret-required' };

/** Pure check: given a trigger draft and its plugin, decide whether the
 *  trigger is consistent with the plugin's verification requirements.
 *  Currently the only rule: if the plugin declares a `signature` block,
 *  the trigger must have a `secret` OR `verifyOptional === true`. */
export function validateTriggerAgainstPlugin(
  trigger: WebhookTrigger,
  plugin: WebhookPlugin,
): TriggerValidationResult {
  if (plugin.signature && !trigger.secret && trigger.verifyOptional !== true) {
    return { ok: false, reason: 'secret-required' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `bun test lib/server/trigger-validation.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Wire the validator into POST `/api/triggers`**

Edit `app/api/triggers/route.ts`. The new `secret` and `verifyOptional` fields need to flow through the request body into the draft, and the plugin must be looked up to run the validator. Replace the existing `POST` handler with:

```ts
export async function POST(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const payload = body as Partial<WebhookTrigger>;
  const id = generateId();
  const draft: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> = {
    id,
    name: typeof payload.name === 'string' ? payload.name : '',
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : true,
    workflowId: typeof payload.workflowId === 'string' ? payload.workflowId : '',
    pluginId: typeof payload.pluginId === 'string' ? payload.pluginId : '',
    eventType: typeof payload.eventType === 'string' ? payload.eventType : undefined,
    match: Array.isArray(payload.match) ? payload.match : [],
    inputs: payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)
      ? (payload.inputs as Record<string, string>)
      : {},
    secret: typeof payload.secret === 'string' ? payload.secret : undefined,
    verifyOptional: payload.verifyOptional === true ? true : undefined,
  };

  // NEW — save-time plugin-consistency check
  const plugin = await pluginIndex.lookup(draft.pluginId);
  if (plugin) {
    const v = validateTriggerAgainstPlugin(draft as WebhookTrigger, plugin);
    if (!v.ok) {
      return NextResponse.json(
        { error: 'invalid-trigger', reason: v.reason },
        { status: 400 },
      );
    }
  }

  try {
    const saved = await saveTrigger(draft);
    return NextResponse.json({ trigger: saved }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid-trigger', reason: (err as Error).message },
      { status: 400 },
    );
  }
}
```

And add the imports at the top of the file:

```ts
import { pluginIndex } from '@/lib/server/webhook-plugins';
import { validateTriggerAgainstPlugin } from '@/lib/server/trigger-validation';
```

- [ ] **Step 6: Wire the validator into PUT `/api/triggers/[id]`**

Edit `app/api/triggers/[id]/route.ts`. Inside the `try` block, before `saveTrigger`, after the `draft` is constructed, add the same lookup-and-validate block. Also extend the draft to include `secret` and `verifyOptional` (same two lines as in POST).

```ts
    const draft: Omit<WebhookTrigger, 'createdAt' | 'updatedAt'> = {
      id,
      name: typeof payload.name === 'string' ? payload.name : '',
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : true,
      workflowId: typeof payload.workflowId === 'string' ? payload.workflowId : '',
      pluginId: typeof payload.pluginId === 'string' ? payload.pluginId : '',
      eventType: typeof payload.eventType === 'string' ? payload.eventType : undefined,
      match: Array.isArray(payload.match) ? payload.match : [],
      inputs: payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)
        ? (payload.inputs as Record<string, string>)
        : {},
      secret: typeof payload.secret === 'string' ? payload.secret : undefined,
      verifyOptional: payload.verifyOptional === true ? true : undefined,
    };

    // NEW — save-time plugin-consistency check
    const plugin = await pluginIndex.lookup(draft.pluginId);
    if (plugin) {
      const v = validateTriggerAgainstPlugin(draft as WebhookTrigger, plugin);
      if (!v.ok) {
        return NextResponse.json(
          { error: 'invalid-trigger', reason: v.reason },
          { status: 400 },
        );
      }
    }

    const saved = await saveTrigger(draft);
```

Same imports at the top:

```ts
import { pluginIndex } from '@/lib/server/webhook-plugins';
import { validateTriggerAgainstPlugin } from '@/lib/server/trigger-validation';
```

- [ ] **Step 7: Add route-level tests for misconfig rejection**

Add to `app/api/triggers/route.test.ts` (POST). The test file likely already has helpers for plugin dir setup; if not, mirror the additions from Task 4 Step 1 (a `tmpPluginDir`, `writePlugin`, beforeEach extensions). Add:

```ts
  test('400 invalid-trigger when signed plugin trigger has no secret and no verifyOptional', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'x-frogo-event',
      signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
      events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
    });
    pluginIndex.invalidate();
    const res = await POST(
      new Request('http://test/api/triggers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 't', enabled: true, workflowId: 'wf', pluginId: 'frogo',
          eventType: 'task.created', match: [], inputs: {},
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid-trigger', reason: 'secret-required' });
  });

  test('201 when signed plugin trigger has verifyOptional=true', async () => {
    await writePlugin('frogo', {
      id: 'frogo',
      displayName: 'Frogo',
      eventHeader: 'x-frogo-event',
      signature: { header: 'x-frogo-signature', scheme: 'hmac-sha256', format: 'sha256=<hex>' },
      events: [{ type: 'task.created', displayName: 'Task created', fields: [] }],
    });
    pluginIndex.invalidate();
    const res = await POST(
      new Request('http://test/api/triggers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 't', enabled: true, workflowId: 'wf', pluginId: 'frogo',
          eventType: 'task.created', match: [], inputs: {}, verifyOptional: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
  });
```

Add an analogous pair to `app/api/triggers/[id]/route.test.ts` (PUT) using the same plugin dir setup. Use `PUT` import and an existing trigger id created via `saveTrigger` first, mirroring this file's existing test pattern.

- [ ] **Step 8: Run all touched test files**

Run:
```bash
bun test \
  lib/server/trigger-validation.test.ts \
  app/api/triggers/route.test.ts \
  app/api/triggers/\[id\]/route.test.ts
```
Expected: all PASS, including pre-existing tests in the route files.

- [ ] **Step 9: Commit**

```bash
git add lib/server/trigger-validation.ts lib/server/trigger-validation.test.ts \
        app/api/triggers/route.ts app/api/triggers/route.test.ts \
        app/api/triggers/\[id\]/route.ts app/api/triggers/\[id\]/route.test.ts
git commit -m "feat(triggers): reject misconfigured triggers at save (secret required when plugin signs)"
```

---

## Task 6: Ship `webhook-plugins/frogo.json`

Drop the declarative plugin file in. Add a small integration test that loads it through `loadPlugins` (no mocks) to catch JSON typos.

**Files:**
- Create: `webhook-plugins/frogo.json`
- Modify: `lib/server/webhook-plugins/loader.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append to `loader.test.ts`:

```ts
describe('loadPlugins — real frogo.json from repo', () => {
  test('the shipped webhook-plugins/frogo.json loads cleanly', async () => {
    const repoPluginsDir = path.resolve(__dirname, '..', '..', '..', 'webhook-plugins');
    const plugins = await loadPlugins(repoPluginsDir);
    const frogo = plugins.find((p) => p.id === 'frogo');
    expect(frogo).toBeDefined();
    expect(frogo?.signature?.header).toBe('x-frogo-signature');
    expect(frogo?.signature?.scheme).toBe('hmac-sha256');
    expect(frogo?.signature?.format).toBe('sha256=<hex>');
    expect(frogo?.events.find((e) => e.type === 'task.created')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'task.updated')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'task.deleted')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'task.commented')).toBeDefined();
    expect(frogo?.events.find((e) => e.type === 'ping')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test lib/server/webhook-plugins/loader.test.ts`
Expected: the new integration test FAILS because `webhook-plugins/frogo.json` does not exist yet.

- [ ] **Step 3: Create `webhook-plugins/frogo.json`**

Write the file with the full content from spec §6:

```json
{
  "id": "frogo",
  "displayName": "Frogo",
  "icon": "frogo",
  "eventHeader": "x-frogo-event",
  "signature": {
    "header": "x-frogo-signature",
    "scheme": "hmac-sha256",
    "format": "sha256=<hex>"
  },
  "events": [
    {
      "type": "task.created",
      "displayName": "Task created",
      "fields": [
        { "path": "body.event",                 "type": "string" },
        { "path": "body.taskId",                "type": "number" },
        { "path": "body.timestamp",             "type": "string" },
        { "path": "body.payload.task.id",       "type": "number" },
        { "path": "body.payload.task.title",    "type": "string" },
        { "path": "body.payload.task.body",     "type": "string" },
        { "path": "body.payload.task.status",   "type": "string" },
        { "path": "body.payload.task.parentId", "type": "number" },
        { "path": "body.payload.task.createdBy","type": "string" }
      ],
      "examplePayload": {
        "event": "task.created",
        "taskId": 42,
        "timestamp": "2026-05-13T12:00:00Z",
        "payload": {
          "task": {
            "id": 42,
            "title": "Triage incoming bug report",
            "body": "Repro on staging…",
            "status": "todo",
            "parentId": null,
            "createdBy": "alice"
          }
        }
      }
    },
    {
      "type": "task.updated",
      "displayName": "Task updated",
      "fields": [
        { "path": "body.event",                  "type": "string" },
        { "path": "body.taskId",                 "type": "number" },
        { "path": "body.payload.task.id",        "type": "number" },
        { "path": "body.payload.task.title",     "type": "string" },
        { "path": "body.payload.task.status",    "type": "string" },
        { "path": "body.payload.task.assignees", "type": "array"  }
      ],
      "examplePayload": {
        "event": "task.updated",
        "taskId": 42,
        "timestamp": "2026-05-13T12:01:00Z",
        "payload": {
          "task": { "id": 42, "title": "Triage incoming bug report", "status": "in_progress", "assignees": ["bob"] }
        }
      }
    },
    {
      "type": "task.deleted",
      "displayName": "Task deleted",
      "fields": [
        { "path": "body.event",           "type": "string" },
        { "path": "body.taskId",          "type": "number" },
        { "path": "body.payload.task.id", "type": "number" }
      ],
      "examplePayload": {
        "event": "task.deleted",
        "taskId": 42,
        "timestamp": "2026-05-13T12:05:00Z",
        "payload": { "task": { "id": 42, "title": "Triage incoming bug report" } }
      }
    },
    {
      "type": "task.commented",
      "displayName": "Task commented",
      "fields": [
        { "path": "body.event",                  "type": "string" },
        { "path": "body.taskId",                 "type": "number" },
        { "path": "body.payload.task.id",        "type": "number" },
        { "path": "body.payload.comment.id",     "type": "number" },
        { "path": "body.payload.comment.body",   "type": "string" },
        { "path": "body.payload.comment.author", "type": "string" }
      ],
      "examplePayload": {
        "event": "task.commented",
        "taskId": 42,
        "timestamp": "2026-05-13T12:10:00Z",
        "payload": {
          "task": { "id": 42, "title": "Triage incoming bug report" },
          "comment": { "id": 7, "body": "Found root cause in cache layer.", "author": "alice" }
        }
      }
    },
    {
      "type": "ping",
      "displayName": "Ping (test)",
      "fields": [
        { "path": "body.event",           "type": "string" },
        { "path": "body.payload.message", "type": "string" }
      ],
      "examplePayload": {
        "event": "ping",
        "taskId": null,
        "timestamp": "2026-05-13T12:00:00Z",
        "payload": { "message": "Webhook test from Frogo" }
      }
    }
  ]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/server/webhook-plugins/loader.test.ts`
Expected: all tests PASS, including the new `loads cleanly` integration test.

- [ ] **Step 5: Full test suite + typecheck**

Run:
```bash
bun run typecheck && bun test
```
Expected: typecheck clean; full test suite green.

- [ ] **Step 6: Commit**

```bash
git add webhook-plugins/frogo.json lib/server/webhook-plugins/loader.test.ts
git commit -m "feat(webhook-plugins): ship frogo.json declarative plugin"
```

---

## Task 7: Manual end-to-end verification (Result Check)

No code changes. This is the spec's manual validation plan, codified as a checklist so the implementer doesn't ship without running it.

- [ ] **Step 1: Stand up Frogo**

In a separate terminal:
```bash
cd /Users/liyuqi/project/CodeCase/frogo
docker compose up -d
```
Confirm Frogo is reachable at `http://localhost:3030` (or whatever the repo's default is — check `frogo/README.md` if unsure).

- [ ] **Step 2: Stand up InfLoop**

```bash
cd /Users/liyuqi/project/CodeCase/Infinite-Loop
bun run dev
```
Confirm InfLoop is reachable at `http://localhost:3000`.

- [ ] **Step 3: Author a Frogo-keyed webhook trigger in InfLoop**

In a workflow JSON file under `Infinite-Loop/workflows/`, add a trigger:
```json
"triggers": [{
  "id": "...generate via crypto.randomBytes(16).toString('base64url')...",
  "name": "Frogo task created",
  "enabled": true,
  "pluginId": "frogo",
  "eventType": "task.created",
  "match": [],
  "inputs": { "title": "{{body.payload.task.title}}" },
  "secret": "matching-secret-set-on-both-sides"
}]
```

Restart InfLoop so the trigger index picks it up (or hit the workflow-save endpoint).

- [ ] **Step 4: Register a matching Frogo subscription**

In Frogo's `/admin/webhooks` UI: create a subscription targeting `http://host.docker.internal:3000/api/webhook/<triggerId>` with the same secret. (`host.docker.internal` is correct on macOS Docker; adjust per platform.)

- [ ] **Step 5: Fire a real event**

In Frogo, create a task. Confirm:
- Frogo's delivery log shows a successful 202 from InfLoop.
- InfLoop's run queue / dashboard shows a new run started with the templated title.

- [ ] **Step 6: Negative case — bad signature**

Edit the InfLoop trigger JSON to change the secret to a wrong value. Restart / invalidate. Create another task in Frogo. Confirm:
- Frogo's delivery log shows `401`.
- InfLoop logs `[webhook] signature verification failed for trigger <id>: mismatch`.

- [ ] **Step 7: Negative case — misconfigured trigger**

Remove the `secret` field entirely from the trigger JSON (don't set `verifyOptional`). Restart / invalidate. Try to fire from Frogo (with any secret on the Frogo side). Confirm:
- Frogo's delivery log shows `500`.
- InfLoop logs the `trigger ... requires a secret ... and has neither secret nor verifyOptional set` error.

- [ ] **Step 8: verifyOptional smoke**

Set `verifyOptional: true` and no `secret`. Fire from Frogo. Confirm:
- 202 response.
- InfLoop logs `verifyOptional=true on trigger <id> — accepting unsigned request`.
- Workflow run starts as before.

If all eight steps pass, mark task complete.

---

## Self-review

**Spec coverage:**
- §1 Plugin schema extension → Task 1 (types) + Task 3 (loader validation + lowercase).
- §2 Per-trigger secret + verifyOptional → Task 1 (types) + Task 5 (save-time wire-up).
- §3 Gate matrix → Task 4 (route), Task 5 (save-time defense in depth).
- §4 Verification helper → Task 2.
- §5 Route change → Task 4.
- §6 `frogo.json` → Task 6.
- Validation plan unit/integration tests → Task 2 + Task 3 + Task 4 + Task 5 + Task 6 (full suite at end of Task 6).
- Manual plan → Task 7.

**Placeholder scan:** No TBD / TODO / "implement later" / "add appropriate error handling" / "similar to Task N". Every code step shows the actual code.

**Type consistency:**
- `PluginSignature` defined once in Task 1; imported by Task 2 (helper), Task 3 (loader), Task 5 (validator), Task 4 (route via existing types).
- `verifySignature` signature defined in Task 2; called in Task 4 with the matching named args.
- `validateTriggerAgainstPlugin` defined in Task 5 Step 3; called by both POST (Step 5) and PUT (Step 6) with the same arg shape.
- Error wire shapes — `{ error: 'bad-signature' }` (401), `{ error: 'trigger-misconfigured' }` (500), `{ error: 'invalid-trigger', reason: 'secret-required' }` (400) — used consistently between routes and tests.
- Header values lowercased in both the loader (Task 3) and the test fixtures (Task 4 writes `'x-frogo-event'` already lowercase).

**Spec deviation worth flagging:** save-time validation returns `400`, not the `422` sketched in spec §3, to match the existing triggers-route convention (`saveTrigger` errors come out as 400 with the same envelope). The spec's intent — refusing to persist misconfigured triggers — is preserved; only the status code differs.
