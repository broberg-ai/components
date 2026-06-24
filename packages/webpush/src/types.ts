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

export type SendResult = {
  /** How many subscriptions accepted the push. */
  sent: number;
  /** Endpoints that returned 404/410 (gone) — the caller should prune these. */
  dead: string[];
};
