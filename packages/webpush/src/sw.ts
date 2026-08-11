// @broberg/webpush/sw — service-worker push handlers for the CLASSIC path
// (Chrome/Firefox, and iOS when the declarative payload isn't used). Wire them
// inside your own sw.js:
//
//   import { handlePush, handleNotificationClick } from '@broberg/webpush/sw';
//   self.addEventListener('push', handlePush);
//   self.addEventListener('notificationclick', handleNotificationClick);
//
// Declarative Web Push (Safari 18.4+) renders without ever entering the SW, so
// these only run on engines that deliver the push to the worker.

type PushPayload = {
  notification?: { title?: string; body?: string; navigate?: string };
  title?: string;
  body?: string;
  navigate?: string;
  icon?: string;
  tag?: string;
  /** Silent (data-only) push: set the OS badge, show NO banner. */
  silent?: boolean;
  app_badge?: number;
  badge?: number;
};

const DEFAULT_ICON = '/icon-192.png';

/** F067 — what a push handler may be configured with. Every one of these
 *  defaults to the SAFE-AND-ON value: a fix that ships behind a flag reaches
 *  only the people who read changelogs, which is the people who did not need
 *  it. (cardmem's argument, and the same one that made assertBrowserAvailable
 *  default-on in lens-engine F065.) */
export interface PushHandlerOptions {
  /** Title when the payload carries none. `handlePush` keeps 'Notifikation' for
   *  compatibility; a fleet package should not hard-code ONE language, so this
   *  is a parameter rather than a different constant. */
  defaultTitle?: string;
  /** Where a tap goes when the payload names no destination. Without it, a tap
   *  on a notification with no `navigate` opens nothing at all. */
  defaultNavigate?: string;
  /** Sync the OS badge on a VISIBLE push too, not only a silent one. Off, the
   *  number on the icon only moves when the message is read somewhere else. */
  badgeOnVisible?: boolean;
}

const DEFAULTS: Required<PushHandlerOptions> = {
  defaultTitle: 'Notifikation',
  defaultNavigate: '/',
  badgeOnVisible: true,
};

/** Set the OS badge, tolerating both a missing API and a rejecting one. */
function syncBadge(count: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = (self as any).navigator as
    | { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    | undefined;
  // The `?.` guards a MISSING API; it does nothing about a REJECTING one.
  // setAppBadge rejects on engines that expose it but refuse it (unsupported
  // display mode, permission), and a rejected promise handed to waitUntil
  // fails the push event — so a badge that cannot be set would discard the
  // whole delivery. Filed against this package by cardmem, whose hand-written
  // copy caught it with `.catch(() => {})` where the package did not.
  return Promise.resolve(count > 0 ? nav?.setAppBadge?.(count) : nav?.clearAppBadge?.()).catch(
    () => {},
  );
}

/**
 * Build a `push` listener with the defaults you want. `handlePush` is this with
 * nothing overridden, so nobody has to migrate to get the fixes.
 */
export function createPushHandler(options: PushHandlerOptions = {}): (event: PushEvent) => void {
  const o = { ...DEFAULTS, ...options };
  return function push(event: PushEvent): void {
    let data: PushPayload = {};
    try {
      data = (event.data?.json() as PushPayload) ?? {};
    } catch {
      data = {};
    }
    const badge = data.app_badge ?? data.badge;

    // Silent (data-only) push — set the OS app-badge, render no notification.
    if (data.silent) {
      event.waitUntil(syncBadge(badge ?? 0));
      return;
    }

    const n = data.notification ?? data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = (self as any).registration as ServiceWorkerRegistration;
    const show = reg.showNotification(n.title || o.defaultTitle, {
      body: n.body || '',
      icon: data.icon || DEFAULT_ICON,
      badge: DEFAULT_ICON,
      tag: data.tag,
      data: { navigate: n.navigate ?? o.defaultNavigate },
    });
    // A visible push carrying a count moves the icon NOW, rather than waiting
    // for a separate silent push after the message is read elsewhere. A payload
    // with no count is untouched — that is what keeps this backwards-safe.
    event.waitUntil(
      o.badgeOnVisible && badge !== undefined ? Promise.all([show, syncBadge(badge)]) : show,
    );
  };
}

/**
 * The listener most consumers wire directly. Identical to `createPushHandler()`
 * with nothing overridden — ONE implementation, because two copies of this
 * logic is exactly how the badge-rejection bug got in (the package had one
 * shape, a consumer copy had another, and neither side could see its own).
 */
export const handlePush: (event: PushEvent) => void = createPushHandler();

export function handleNotificationClick(event: NotificationEvent): void {
  event.notification.close();
  // F067: fall back rather than leave a tap doing nothing. Before this, a
  // notification whose payload carried no `navigate` opened NOTHING when the
  // app was closed — the user taps, and the phone does not react.
  const navigate = (event.notification.data as { navigate?: string } | undefined)?.navigate ?? '/';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientsApi = (self as any).clients as Clients;
  event.waitUntil(
    (async () => {
      const all = await clientsApi.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        const wc = c as WindowClient;
        if ('focus' in wc) {
          await wc.focus();
          if (navigate && 'navigate' in wc) {
            try {
              await wc.navigate(navigate);
            } catch {
              /* cross-origin or detached — ignore */
            }
          }
          return;
        }
      }
      if (navigate) await clientsApi.openWindow(navigate);
    })(),
  );
}
