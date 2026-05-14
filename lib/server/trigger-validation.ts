import type { WebhookPlugin, WebhookTrigger } from '../shared/trigger';

export type TriggerValidationResult =
  | { ok: true }
  | { ok: false; reason: 'secret-required' };

/** Pure check: given a trigger draft and its plugin, decide whether the
 *  trigger is consistent with the plugin's verification requirements.
 *  Currently the only rule: if the plugin declares a `signature` block,
 *  the trigger must have a `secret` OR `verifyOptional === true`. */
export function validateTriggerAgainstPlugin(
  trigger: Pick<WebhookTrigger, 'secret' | 'verifyOptional'>,
  plugin: WebhookPlugin,
): TriggerValidationResult {
  if (plugin.signature && !trigger.secret && trigger.verifyOptional !== true) {
    return { ok: false, reason: 'secret-required' };
  }
  return { ok: true };
}
