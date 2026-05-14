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
    createdAt: 0, updatedAt: 0,
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
