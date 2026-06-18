// @broberg/webpush — server entry. A storage-agnostic Web Push sender.
//
// The package deliberately does NOT touch your database. You fetch the
// subscriptions (and gate on the user's prefs); you persist history; you prune
// the dead endpoints this returns. The package owns exactly one hard part:
// shaping a declarative + classic payload and fanning it out over VAPID without
// ever throwing into your request path.

import webpush from 'web-push';
import type { VapidConfig, PushSubscriptionJSON, PushMessage, SendResult } from './types';

export type { VapidConfig, PushSubscriptionJSON, PushMessage, SendResult } from './types';

/** Generate a VAPID keypair once; store the private key as a secret. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}

/**
 * Build the wire payload for one message. Emits BOTH a declarative Web Push
 * object (`web_push: 8030` — Safari 18.4+ renders it with no service worker)
 * AND flat fields a classic `push` service-worker handler reads. Either path
 * renders the same notification.
 */
export function buildPayload(m: PushMessage): string {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: m.title,
      body: m.body,
      navigate: m.navigate,
      ...(typeof m.badge === 'number' ? { app_badge: m.badge } : {}),
    },
    // classic-SW fallback fields (see @broberg/webpush/sw)
    title: m.title,
    body: m.body,
    navigate: m.navigate,
    badge: m.badge,
    icon: m.icon,
    tag: m.tag,
  });
}

/**
 * Create a sender bound to your VAPID config. Returns `.send()` plus the public
 * key (hand it to the browser for subscribe()).
 */
export function createPushSender(vapid: VapidConfig) {
  const vapidDetails = {
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };

  /**
   * Fan a message out to every subscription. Never throws — a per-subscription
   * failure is isolated; 404/410 ("gone") endpoints come back in `dead` for the
   * caller to prune. Safe to `void` from inside a request handler.
   */
  async function send(subs: PushSubscriptionJSON[], message: PushMessage): Promise<SendResult> {
    const payload = buildPayload(message);
    const dead: string[] = [];
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, {
            vapidDetails,
          });
          sent += 1;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.endpoint);
          // any other error is swallowed — push must never break the caller
        }
      }),
    );
    return { sent, dead };
  }

  return { send, buildPayload, publicKey: vapid.publicKey };
}

export type PushSender = ReturnType<typeof createPushSender>;
