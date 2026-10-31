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
  /**
   * The small monochrome image beside the notification (the Notification API's
   * `badge`). NOT the number — `badge` below is already the OS app-badge COUNT,
   * and the two would collide under one name.
   */
  badgeIcon?: string;
  tag?: string;
  /** Silent (data-only) push: set the OS badge, show NO banner. */
  silent?: boolean;
  app_badge?: number;
  badge?: number;
  /** F067.10 — notification buttons (classic path only). */
  actions?: { action: string; title: string }[];
  /** F067.10 — app data handed back to onAction. */
  data?: Record<string, unknown>;
};

/** F067.10 — what the app's service worker is told when a notification BUTTON is tapped. */
export interface NotificationActionEvent {
  /** The button's `action` id, e.g. "read". */
  action: string;
  /** The notification's tag, if it had one. */
  tag?: string;
  /** The `data` the sender attached (e.g. `{ mailId }`). */
  data?: Record<string, unknown>;
  /** The raw event, for anything else (event.notification, etc.). */
  event: NotificationEvent;
}

/** F067 — what a push handler may be configured with. Every one of these
 *  defaults to the SAFE-AND-ON value: a fix that ships behind a flag reaches
 *  only the people who read changelogs, which is the people who did not need
 *  it. (cardmem's argument, and the same one that made assertBrowserAvailable
 *  default-on in lens-engine F065.) */
/** F067.8 — why the fallback did not reach `navigate`. */
export interface NavigateFailure {
  reason: 'navigate_unsupported' | 'navigate_rejected' | 'open_window_failed';
  navigate: string;
  error?: unknown;
}

/** F067.8 — what every window client receives on a tap, before any fallback. */
export interface NavigateMessage {
  type: 'webpush:navigate';
  navigate: string;
}

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
  /**
   * Icon when the payload carries none. **No default** — see below.
   */
  defaultIcon?: string;
  /**
   * Small monochrome image when the payload carries none. **No default.**
   *
   * THIS PACKAGE USED TO GUESS '/icon-192.png' FOR BOTH, and the badge could
   * not even be overridden. xrt81 lost a full day to it: their icons live under
   * /icons/, so the guessed path hit their SPA's catch-all and returned
   * index.html — 200 OK, content-type text/html, 1587 bytes.
   *
   * **A notification whose icon URL resolves to an HTML document is not
   * rendered AT ALL on iOS/Safari, silently.** Chrome on a Mac renders it
   * without an icon, so their Mac "worked" all day while the iPhone showed
   * nothing — and every layer reported success, including Apple's 201. Their
   * own in-worker probe is what proved the push had ARRIVED (bytes:355) and was
   * simply not displayed.
   *
   * So the default is now to emit NO icon key at all rather than a path we hope
   * exists. The browser then uses its own — visibly imperfect, never invisible.
   * Guessing turned a cosmetic omission into total silent failure on the one
   * platform where push matters most.
   */
  defaultBadgeIcon?: string;
  /**
   * F067.10 — called when the user taps a notification BUTTON (not the
   * notification itself). Do the work here — mark as read, archive — and no
   * window is opened or focused. Its promise is kept alive with waitUntil; a
   * rejection is NOT swallowed, so it shows in the worker's console.
   * Without onAction, a button tap behaves like a tap on the notification
   * (opens/focuses the app) — a tap never does nothing.
   */
  onAction?: (e: NotificationActionEvent) => void | Promise<void>;
  /**
   * F067.8 — called when the package's own fallback could NOT take the user to
   * `navigate`: iOS has no WindowClient.navigate (`navigate_unsupported`), the
   * call rejected (`navigate_rejected`), or there was no window and openWindow
   * failed (`open_window_failed`). Before 0.7.0 all three were silent and
   * looked exactly like a success. An app that listens for the
   * `webpush:navigate` message has already been told — this says whether the
   * fallback also worked.
   */
  onNavigateFailure?: (e: NavigateFailure) => void;
}

const DEFAULTS: Required<Pick<PushHandlerOptions, 'defaultTitle' | 'defaultNavigate' | 'badgeOnVisible'>> = {
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

/** Keep what the browser can show; say so when buttons are dropped (never silently). */
function limitActions(actions: PushPayload['actions']): { action: string; title: string }[] {
  const list = (Array.isArray(actions) ? actions : []).filter(
    (a) => a && typeof a.action === 'string' && a.action !== '' && typeof a.title === 'string',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const max = (self as any).Notification?.maxActions as number | undefined;
  if (typeof max === 'number' && list.length > max) {
    console.warn(`[@broberg/webpush] ${list.length} notification buttons, this browser shows ${max} — dropped: ${list.slice(max).map((a) => a.action).join(', ')}`);
    return list.slice(0, max);
  }
  return list;
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
    // Payload wins over configuration, configuration wins over nothing — and
    // "nothing" means the KEY IS ABSENT, not an empty string. An empty string is
    // a URL that resolves to the page itself, which is the same HTML-document
    // failure by another route.
    const icon = data.icon || o.defaultIcon;
    const badgeIcon = data.badgeIcon || o.defaultBadgeIcon;
    const actions = limitActions(data.actions);
    const show = reg.showNotification(n.title || o.defaultTitle, {
      body: n.body || '',
      ...(icon ? { icon } : {}),
      ...(badgeIcon ? { badge: badgeIcon } : {}),
      tag: data.tag,
      // F067.10 — both keys absent unless the sender gave them, so a push
      // without buttons renders exactly as in 0.5.0.
      ...(actions.length ? { actions } : {}),
      data: { navigate: n.navigate ?? o.defaultNavigate, ...(data.data ? { data: data.data } : {}) },
    } as NotificationOptions);
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

/**
 * F067.10 — build a `notificationclick` listener. A tap on a BUTTON goes to
 * `onAction` and opens nothing; a tap on the notification itself (or a button
 * tap with no onAction) opens/focuses the app as before.
 */
export function createNotificationClickHandler(
  options: Pick<PushHandlerOptions, 'onAction' | 'onNavigateFailure'> = {},
): (event: NotificationEvent) => void {
  return function click(event: NotificationEvent): void {
    if (event.action && options.onAction) {
      event.notification.close();
      const d = event.notification.data as { data?: Record<string, unknown> } | undefined;
      event.waitUntil(
        Promise.resolve(
          options.onAction({ action: event.action, tag: event.notification.tag || undefined, data: d?.data, event }),
        ),
      );
      return;
    }
    openFromNotification(event, options.onNavigateFailure);
  };
}

/** The listener most consumers wire directly: `createNotificationClickHandler()` with no onAction. */
export function handleNotificationClick(event: NotificationEvent): void {
  openFromNotification(event);
}

function openFromNotification(event: NotificationEvent, onFailure?: (e: NavigateFailure) => void): void {
  event.notification.close();
  // F067: fall back rather than leave a tap doing nothing. Before this, a
  // notification whose payload carried no `navigate` opened NOTHING when the
  // app was closed — the user taps, and the phone does not react.
  const navigate = (event.notification.data as { navigate?: string } | undefined)?.navigate ?? '/';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientsApi = (self as any).clients as Clients;
  const fail = (e: NavigateFailure): void => {
    try {
      onFailure?.(e);
    } catch {
      // a reporting hook must never break the tap
    }
  };
  event.waitUntil(
    (async () => {
      const all = await clientsApi.matchAll({ type: 'window', includeUncontrolled: true });
      // F067.8 — THE POST THAT CARRIES THE PAYLOAD HAPPENS BEFORE ANYTHING THAT
      // CAN FAIL. Every window is told, before any focus()/navigate() is awaited:
      // a focus that rejects or never resolves, and the old `return` after the
      // first client, used to leave the rest unrouted. `matchAll` order is not
      // guaranteed anywhere, so "the first client" was never a stable choice.
      // An app with a router listens and routes itself — the only path that
      // works at all on iOS, where WindowClient.navigate does not exist.
      const message: NavigateMessage = { type: 'webpush:navigate', navigate };
      for (const c of all) {
        try {
          c.postMessage(message);
        } catch {
          // one dead client must not stop the others
        }
      }
      // The fallback for a consumer that does NOT listen — unchanged in what it
      // tries, but no longer silent when it cannot.
      for (const c of all) {
        const wc = c as WindowClient;
        if ('focus' in wc) {
          try {
            await wc.focus();
          } catch {
            // focus refused (no user activation, detached) — still try to route
          }
          if (!navigate) return;
          if (!('navigate' in wc) || typeof wc.navigate !== 'function') {
            fail({ reason: 'navigate_unsupported', navigate });
            return;
          }
          try {
            await wc.navigate(navigate);
          } catch (error) {
            fail({ reason: 'navigate_rejected', navigate, error });
          }
          return;
        }
      }
      if (navigate) {
        try {
          await clientsApi.openWindow(navigate);
        } catch (error) {
          fail({ reason: 'open_window_failed', navigate, error });
        }
      }
    })(),
  );
}
