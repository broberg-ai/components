import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPushHandler } from '../src/sw';
import { getSubscription, resolveRegistration, subscribeToPush, unsubscribeFromPush } from '../src/client';

/**
 * F067.3 + F067.4 — both filed by xrt81 from production, one costing a full day.
 *
 * F067.3: a notification whose icon URL resolves to an HTML document is not
 * rendered AT ALL on iOS/Safari, silently. The package guessed '/icon-192.png'
 * for both icon and badge, and the badge could not even be overridden.
 *
 * F067.4: subscribeToPush and getSubscription asked "is there a registration?"
 * two different ways, so a cold start reported a subscribed user as unsubscribed.
 */

type Waited = Promise<unknown> | undefined;

function fakePush(payload: unknown): { event: PushEvent; waited: () => Waited } {
  let waited: Waited;
  const event = {
    data: { json: () => payload },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  } as unknown as PushEvent;
  return { event, waited: () => waited };
}

function installSelf() {
  const showNotification = vi.fn(
    (_title: string, _opts?: Record<string, unknown>) => Promise.resolve(),
  );
  (globalThis as Record<string, unknown>).self = { navigator: {}, registration: { showNotification } };
  return showNotification;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).self;
  delete (globalThis as Record<string, unknown>).navigator;
});

describe('F067.3 — stop guessing an icon path', () => {
  it('with NO config and NO payload icon, neither key is passed at all', async () => {
    // RED against 0.2.1, which passed icon:'/icon-192.png' AND badge:'/icon-192.png'.
    // Absent, not empty: an empty string is a URL that resolves to the page
    // itself, which is the same HTML-document failure by another route.
    const show = installSelf();
    const { event } = fakePush({ title: 'Hej' });
    createPushHandler()(event);

    const opts = show.mock.calls[0]![1] ?? {};
    expect('icon' in opts).toBe(false);
    expect('badge' in opts).toBe(false);
  });

  it('badgeIcon is settable from the PAYLOAD — it could not be set at all before', async () => {
    const show = installSelf();
    const { event } = fakePush({ title: 'Hej', badgeIcon: '/icons/badge.png' });
    createPushHandler()(event);
    expect((show.mock.calls[0]![1] ?? {}).badge).toBe('/icons/badge.png');
  });

  it('badgeIcon and icon are settable from CONFIG', async () => {
    const show = installSelf();
    const { event } = fakePush({ title: 'Hej' });
    createPushHandler({ defaultIcon: '/icons/i.png', defaultBadgeIcon: '/icons/b.png' })(event);
    const opts = show.mock.calls[0]![1] ?? {};
    expect(opts.icon).toBe('/icons/i.png');
    expect(opts.badge).toBe('/icons/b.png');
  });

  it('payload beats config beats nothing — all three levels, so precedence cannot invert', async () => {
    const show = installSelf();
    const { event } = fakePush({ title: 'Hej', icon: '/from-payload.png' });
    createPushHandler({ defaultIcon: '/from-config.png' })(event);
    expect((show.mock.calls[0]![1] ?? {}).icon).toBe('/from-payload.png');
  });

  it('the numeric app-badge and the image badgeIcon do NOT collide', async () => {
    // `badge` in the payload has always meant the OS COUNT; the Notification
    // API's `badge` is an IMAGE. One payload carrying both must set each.
    const stub = { setAppBadge: vi.fn(() => Promise.resolve()), clearAppBadge: vi.fn(() => Promise.resolve()) };
    const showNotification = vi.fn(
      (_title: string, _opts?: Record<string, unknown>) => Promise.resolve(),
    );
    (globalThis as Record<string, unknown>).self = { navigator: stub, registration: { showNotification } };

    const { event, waited } = fakePush({ title: 'Hej', badge: 7, badgeIcon: '/icons/b.png' });
    createPushHandler()(event);
    await waited();

    expect((showNotification.mock.calls[0]![1] ?? {}).badge).toBe('/icons/b.png');
    expect(stub.setAppBadge).toHaveBeenCalledWith(7);
  });
});

/** A serviceWorker stub whose `ready` settles when we say so — or never. */
function installNavigator(opts: {
  readyAfterMs?: number | 'never';
  registrationNow?: unknown;
  subscription?: unknown;
}) {
  const sub = opts.subscription ?? null;
  const reg = {
    pushManager: {
      getSubscription: vi.fn(async () => sub),
      subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://push.test/x' }) })),
    },
  };
  const delay = opts.readyAfterMs === 'never' ? null : (opts.readyAfterMs ?? 0);
  const ready =
    delay === null
      ? new Promise<typeof reg>(() => {})
      : new Promise<typeof reg>((resolve) => setTimeout(() => resolve(reg), delay));
  (globalThis as Record<string, unknown>).navigator = {
    serviceWorker: { ready, getRegistration: vi.fn(async () => opts.registrationNow) },
  };
  return reg;
}

describe('F067.4 — one shared way to resolve the registration', () => {
  it('finds a registration that becomes available AFTER the call', async () => {
    // RED against 0.2.1: getSubscription used getRegistration(), which answers
    // undefined while the worker is still starting → a subscribed user shown as
    // unsubscribed on every cold start.
    installNavigator({ readyAfterMs: 30, registrationNow: undefined, subscription: { endpoint: 'e1' } });
    expect(await getSubscription()).toEqual({ endpoint: 'e1' });
  });

  it('returns null within the bound when NO worker is ever registered — it does not hang', async () => {
    // The trap in the obvious fix: `.ready` never resolves without a worker, so
    // switching blindly trades a wrong answer for no answer at all.
    installNavigator({ readyAfterMs: 'never', registrationNow: undefined });
    const t0 = Date.now();
    const reg = await resolveRegistration(50);
    expect(reg).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('an already-active registration resolves fast — no added latency on the common path', async () => {
    installNavigator({ readyAfterMs: 0, subscription: { endpoint: 'e1' } });
    const t0 = Date.now();
    await resolveRegistration(5_000);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('unsubscribe during a cold start returns the endpoint, so the server IS told', async () => {
    // The third consequence, which the report did not name: unsubscribeFromPush
    // goes through getSubscription, so it used to no-op and return null while
    // the worker was starting. The toggle went off; the pushes kept coming.
    const unsubscribe = vi.fn(async () => true);
    installNavigator({
      readyAfterMs: 30,
      registrationNow: undefined,
      subscription: { endpoint: 'https://push.test/abc', unsubscribe },
    });
    expect(await unsubscribeFromPush()).toBe('https://push.test/abc');
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('subscribeToPush throws a NAMED error instead of hanging when there is no worker', async () => {
    installNavigator({ readyAfterMs: 'never', registrationNow: undefined });
    await expect(subscribeToPush('BFakeKey')).rejects.toThrow(/no service worker registration/);
  });

  it('resolveRegistration survives a REJECTING ready by falling back to a direct lookup', async () => {
    const reg = { pushManager: { getSubscription: vi.fn(async () => null) } };
    (globalThis as Record<string, unknown>).navigator = {
      serviceWorker: {
        ready: Promise.reject(new Error('boom')),
        getRegistration: vi.fn(async () => reg),
      },
    };
    expect(await resolveRegistration(50)).toBe(reg);
  });
});
