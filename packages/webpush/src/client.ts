// @broberg/webpush/client — browser-side helpers. Zero runtime deps, no
// framework. Wrap these in your own Settings UI / enable-button (the package
// stays brand-agnostic; you own the styling + the POST to your server).

import type { PushSubscriptionJSON } from './types';

export type { PushSubscriptionJSON } from './types';

/** VAPID public key (base64url) → the Uint8Array applicationServerKey wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when this browser can do Web Push at all. */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

/** iOS gates Web Push behind home-screen install — detect that case for a guide. */
export function isIOSStandalone(): { ios: boolean; standalone: boolean } {
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);
  return { ios, standalone };
}

/**
 * Subscribe to push and return the JSON to POST to your server. Must be called
 * from a user gesture, AFTER Notification.requestPermission() === 'granted'.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  return sub.toJSON() as PushSubscriptionJSON;
}

/** The active subscription, if any (so a Settings UI can show on/off state). */
export async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Unsubscribe locally; returns the endpoint to tell your server to forget. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await getSubscription();
  if (!sub) return null;
  const { endpoint } = sub;
  await sub.unsubscribe();
  return endpoint;
}

/** Set or clear the OS app-badge. Call on app load + focus, and after the user
 *  clears the underlying signal. No-op where the Badging API is absent. */
export function syncBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) void nav.setAppBadge?.(count);
  else void nav.clearAppBadge?.();
}
