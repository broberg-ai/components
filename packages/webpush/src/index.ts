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
  SendFailure,
  SendFailureKind,
  SenderStatus,
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
 * Which of the three actionable shapes a failure has.
 *
 * UNRECOGNISED CODES FALL TO `transient` DELIBERATELY, and the trade is worth
 * stating: an unknown permanent fault will be retried for a while, which costs
 * some wasted calls. The opposite default would silently stop retrying
 * something that would have worked. `statusCode` is always carried, so a caller
 * who needs more than the three buckets can still read the number.
 */
function classifyFailure(code: number | undefined): SendFailureKind {
  if (code === 401 || code === 403) return 'auth';
  if (code === 400 || code === 413) return 'payload';
  // 429 and 5xx are explicitly retryable; so is a transport failure, which has
  // no status at all and is the commonest kind (DNS, TLS, offline).
  return 'transient';
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

  // Boot-time readback (F067.5). Asked for by torrent-search-api, who wanted to
  // gate at startup rather than discover a broken config on the first
  // notification — the same reason @broberg/mail grew `mode`.
  //
  // Validated with web-push's OWN getVapidHeaders rather than rules of my own:
  // it checks subject, publicKey and privateKey exactly as a real send will, so
  // the readback cannot disagree with the thing it predicts. setVapidDetails
  // would validate too, but it mutates the shared web-push singleton, and a
  // package has no business changing global state to answer a question.
  const missing = !vapid.subject || !vapid.publicKey || !vapid.privateKey;
  let status: SenderStatus = missing ? 'no-keys' : 'ready';
  let statusReason: string | null = missing
    ? 'VAPID subject, publicKey or privateKey is empty'
    : null;
  if (!missing) {
    try {
      webpush.getVapidHeaders(
        'https://example.com',
        vapid.subject,
        vapid.publicKey,
        vapid.privateKey,
        'aes128gcm',
      );
    } catch (err) {
      status = 'invalid-keys';
      statusReason = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Fan a pre-built payload out to every subscription. Never throws — a per-
   * subscription failure is isolated; 404/410 ("gone") endpoints come back in
   * `dead` for the caller to prune. Safe to `void` from inside a request handler.
   */
  async function fanOut(subs: PushSubscriptionJSON[], payload: string): Promise<SendResult> {
    const dead: string[] = [];
    const failed: SendFailure[] = [];
    let sent = 0;

    // A bad VAPID config fails EVERY subscription, permanently. Reported as
    // `auth` and without touching the network — web-push would otherwise raise
    // it as an ordinary error with no status code, which classified as
    // `transient` and told the caller to RETRY the one thing retrying can never
    // fix. Measured before this line existed: missing keys came back
    // kind:'transient', reason:'No subject set in vapidDetails.subject.'
    if (status !== 'ready') {
      const failures = subs.map((s) => ({
        endpoint: s.endpoint,
        statusCode: null,
        kind: 'auth' as const,
        reason: statusReason ?? 'push sender is not configured',
      }));
      return { sent: 0, dead: [], failed: failures, allFailed: failures.length > 0 };
    }
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, {
            vapidDetails,
          });
          sent += 1;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            dead.push(s.endpoint);
            return;
          }
          // Everything else USED to be swallowed here (F067.5). It never threw —
          // that part was right and stays — but it also left no trace, so a
          // total delivery failure and an empty subscriber list returned the
          // same object. Isolating a failure is not the same as hiding it.
          failed.push({
            endpoint: s.endpoint,
            statusCode: code ?? null,
            kind: classifyFailure(code),
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
    // Something was attempted, nothing got through, and nothing was merely
    // gone. An empty send is not an outage, and a batch of 410s is churn.
    return { sent, dead, failed, allFailed: failed.length > 0 && sent === 0 && dead.length === 0 };
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

  return {
    send,
    sendSilent,
    buildPayload,
    buildSilentPayload,
    publicKey: vapid.publicKey,
    /** Can this sender actually deliver? Check it at BOOT:
     *    if (isProd && sender.status !== 'ready') throw new Error(sender.statusReason!); */
    status,
    /** web-push's own words for why, or null when status is 'ready'. */
    statusReason,
  };
}

export type PushSender = ReturnType<typeof createPushSender>;
