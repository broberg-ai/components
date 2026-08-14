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

/** How long resolveRegistration waits for a worker that is still starting. */
export const REGISTRATION_TIMEOUT_MS = 3_000;

/**
 * The ONE way this module asks "is there a service-worker registration?".
 *
 * It exists because there used to be two, and they disagreed: `subscribeToPush`
 * awaited `navigator.serviceWorker.ready` (which WAITS) while `getSubscription`
 * called `getRegistration()` (which answers IMMEDIATELY, and with `undefined`
 * while the worker is still starting). On a cold start that made a subscribed
 * user's Settings UI show "not subscribed" — xrt81's owner saw his push toggle
 * off, switched it on again, and they went hunting for a bug in the subscribe
 * flow that did not exist. A wrong NO sends the debugging somewhere else.
 *
 * It also silently broke unsubscribe, which nobody had noticed: that path calls
 * getSubscription, so an unsubscribe during a cold start no-opped, returned
 * null, and the server was never told to forget the endpoint. The toggle went
 * off; the pushes kept coming.
 *
 * THE OBVIOUS FIX WOULD HAVE BEEN WORSE. `.ready` never resolves when no worker
 * is registered at all, so switching everything to it trades a wrong answer for
 * NO answer — an unbounded hang, which is strictly worse than `null` and is the
 * exact failure class this package keeps being bitten by. So: race `.ready`
 * against a bound, fall back to a direct lookup, and return null rather than
 * wait forever.
 */
export async function resolveRegistration(
  timeoutMs: number = REGISTRATION_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const sw = navigator.serviceWorker;

  const timedOut = Symbol('timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const winner = await Promise.race([
      sw.ready,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), timeoutMs);
      }),
    ]);
    if (winner !== timedOut) return winner;
  } catch {
    // `ready` rejecting is not a reason to give up — a direct lookup may still
    // find one.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  try {
    return (await sw.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to push and return the JSON to POST to your server. Must be called
 * from a user gesture, AFTER Notification.requestPermission() === 'granted'.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  const reg = await resolveRegistration();
  if (!reg) throw new Error('no service worker registration — register one before subscribing');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  return sub.toJSON() as PushSubscriptionJSON;
}

/** The active subscription, if any (so a Settings UI can show on/off state). */
export async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await resolveRegistration();
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
