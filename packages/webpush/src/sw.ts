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

export function handlePush(event: PushEvent): void {
  let data: PushPayload = {};
  try {
    data = (event.data?.json() as PushPayload) ?? {};
  } catch {
    data = {};
  }
  // Silent (data-only) push — set the OS app-badge, render no notification.
  if (data.silent) {
    const count = data.app_badge ?? data.badge ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = (self as any).navigator as
      | { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
      | undefined;
    event.waitUntil(Promise.resolve(count > 0 ? nav?.setAppBadge?.(count) : nav?.clearAppBadge?.()));
    return;
  }
  const n = data.notification ?? data;
  const title = n.title || 'Notifikation';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = (self as any).registration as ServiceWorkerRegistration;
  event.waitUntil(
    reg.showNotification(title, {
      body: n.body || '',
      icon: data.icon || DEFAULT_ICON,
      badge: DEFAULT_ICON,
      tag: data.tag,
      data: { navigate: n.navigate },
    }),
  );
}

export function handleNotificationClick(event: NotificationEvent): void {
  event.notification.close();
  const navigate = (event.notification.data as { navigate?: string } | undefined)?.navigate;
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
