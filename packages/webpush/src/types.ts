// @broberg/webpush — shared types. Imported by BOTH the server entry (index.ts)
// and the browser entry (client.ts), so this file pulls in NO runtime deps
// (importing web-push here would drag it into the browser bundle).

/** A browser push subscription, in the shape PushSubscription.toJSON() returns. */
export type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** VAPID application-server credentials. Generate once with generateVapidKeys(). */
export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: contact, per the Web Push spec. */
  subject: string;
};

/** A single notification to deliver. The app owns titles/bodies/links — the
 *  package only shapes + sends them. */
export type PushMessage = {
  title: string;
  body: string;
  /** URL opened when the user taps the notification. */
  navigate?: string;
  /** OS app-badge count to set (declarative Web Push `app_badge`). */
  badge?: number;
  /** Notification icon URL (defaults handled in the service-worker handler). */
  icon?: string;
  /** Coalescing tag — a newer notification with the same tag replaces the old. */
  tag?: string;
};

/** A data-only (SILENT) push: it sets the OS app-badge with NO banner. Used for
 *  cross-device read-sync — when a user clears a notification on one device, the
 *  other (closed) PWA devices count their badge down without showing anything.
 *  Deliberately carries no title/body and is NOT sent as declarative Web Push, so
 *  Safari 18.4+ does not auto-render it; the classic SW handler calls setAppBadge. */
export type SilentPushMessage = {
  /** The app-badge count to set (0 clears the badge). */
  badge: number;
  /** Optional coalescing tag. */
  tag?: string;
};

/** Why a send failed, in the only three shapes that call for different action.
 *
 *  Split rather than collapsed into a boolean because the responses are
 *  opposites: `auth` means stop retrying and fix the deploy, `payload` means
 *  stop retrying and fix the code, `transient` means try again later. A caller
 *  that cannot tell them apart either retries forever or alarms on a blip. */
export type SendFailureKind =
  /** 401/403 — the VAPID credentials are wrong. NOT partial and NOT transient:
   *  every push fails, and every future one will too, until the config changes. */
  | 'auth'
  /** 400/413 — the request or payload is malformed/too large. A code fix. */
  | 'payload'
  /** 429, 5xx, network, TLS, timeouts, and anything unrecognised. Retryable. */
  | 'transient';

/** One subscription's failure. Carries enough to act on rather than only a count. */
export type SendFailure = {
  endpoint: string;
  /** The HTTP status the push service gave, or `null` when there was no HTTP
   *  response at all — a transport failure (DNS/TLS/offline) or a configuration
   *  fault caught before the request, which are the commonest kinds.
   *
   *  ALWAYS PRESENT, never absent, and `null` rather than `undefined` on purpose
   *  (asked for by torrent-search-api): an absent key cannot be told apart from
   *  a package version that has no such field, and a stable row shape is what
   *  makes these loggable and diffable. `null` says *we know there was no
   *  status*. Do not write `f.statusCode >= 500` without checking it first. */
  statusCode: number | null;
  kind: SendFailureKind;
  /** The underlying error message, for logs. Never branch on this string —
   *  branch on `kind`. */
  reason: string;
};

export type SendResult = {
  /** How many subscriptions accepted the push. */
  sent: number;
  /** Endpoints that returned 404/410 (gone) — the caller should prune these.
   *  Ordinary churn, not a fault: a gone endpoint is a row to delete. */
  dead: string[];
  /** Sends that neither succeeded nor were gone (F067.5).
   *
   *  ALWAYS AN ARRAY — empty on a clean run and on an empty send, never
   *  `undefined`. That is a contract, not an artefact: a consumer may write
   *  `result.failed.length` without a `?? []` anywhere.
   *
   *  Before 0.4.0 these were swallowed entirely, so `{sent:0, dead:[]}` meant
   *  BOTH "nobody is subscribed" and "every single send failed" — measured
   *  byte-identical on 0.3.1. That mattered most where it hurt most: wrong VAPID
   *  keys report exactly what a quiet day reports, and a new PWA legitimately
   *  starts at zero subscribers, so the reading looks normal during precisely
   *  the window when the wiring is most likely to be wrong. */
  failed: SendFailure[];
};

/** Whether this sender can actually deliver, knowable at BOOT rather than on the
 *  first notification (F067.5, asked for by torrent-search-api).
 *
 *  Three states and not a boolean, because two of them mean opposite things:
 *  `no-keys` is what a deliberately dark-shipped environment looks like, while
 *  `invalid-keys` is always a bug. Collapsing them would make a misconfiguration
 *  indistinguishable from a feature you have not switched on yet — which is the
 *  same failure this whole story is about, moved to boot time. */
export type SenderStatus =
  /** VAPID subject + keys validated by web-push's own rules. */
  | 'ready'
  /** Nothing configured. Expected when push ships dark; alarm in production. */
  | 'no-keys'
  /** Configured, but web-push rejects it. Always a bug — every send will fail. */
  | 'invalid-keys';
