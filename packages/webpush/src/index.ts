// @broberg/webpush — server entry. A storage-agnostic Web Push sender.
//
// The package deliberately does NOT touch your database. You fetch the
// subscriptions (and gate on the user's prefs); you persist history; you prune
// the dead endpoints this returns. The package owns exactly one hard part:
// shaping a declarative + classic payload and fanning it out over VAPID without
// ever throwing into your request path.

import webpush from 'web-push';
import type {
  VapidConfig,
  PushSubscriptionJSON,
  PushMessage,
  SilentPushMessage,
  SendResult,
} from './types';

export type { VapidConfig, PushSubscriptionJSON, PushMessage, SilentPushMessage, SendResult } from './types';

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
 * Build the wire payload for a SILENT (data-only) push: NO `web_push` declarative
 * field and NO title/body, so Safari 18.4+ does not auto-render anything — only
 * `app_badge` (+ the classic `badge` field) and a `silent` flag the SW reads to
 * call setAppBadge instead of showNotification.
 */
export function buildSilentPayload(m: SilentPushMessage): string {
  return JSON.stringify({ silent: true, app_badge: m.badge, badge: m.badge, tag: m.tag });
}

/**
 * Create a sender bound to your VAPID config. Returns `.send()` / `.sendSilent()`
 * plus the public key (hand it to the browser for subscribe()).
 */
export function createPushSender(vapid: VapidConfig) {
  const vapidDetails = {
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };

  /**
   * Fan a pre-built payload out to every subscription. Never throws — a per-
   * subscription failure is isolated; 404/410 ("gone") endpoints come back in
   * `dead` for the caller to prune. Safe to `void` from inside a request handler.
   */
  async function fanOut(subs: PushSubscriptionJSON[], payload: string): Promise<SendResult> {
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

  /** Send a visible notification (declarative + classic) to every subscription. */
  const send = (subs: PushSubscriptionJSON[], message: PushMessage) =>
    fanOut(subs, buildPayload(message));

  /**
   * Send a SILENT, banner-less badge update — for cross-device read-sync (a
   * closed PWA on another device counts its OS badge down without showing
   * anything). Same never-throws fan-out + `dead` pruning as {@link send}.
   */
  const sendSilent = (subs: PushSubscriptionJSON[], message: SilentPushMessage) =>
    fanOut(subs, buildSilentPayload(message));

  return { send, sendSilent, buildPayload, buildSilentPayload, publicKey: vapid.publicKey };
}

export type PushSender = ReturnType<typeof createPushSender>;
