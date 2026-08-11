import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePush, handleNotificationClick } from '../src/sw';

/**
 * The two functions that actually run on the phone had NO tests — the package's
 * six specs covered payload BUILDING only. That is why the badge-rejection bug
 * below survived a review and a release: nothing ever ran this code.
 *
 * Filed by cardmem, who hand-wrote a copy of these handlers (a service worker in
 * public/ is a static file and cannot import from node_modules) and whose copy
 * was MORE defensive than the package on exactly one point.
 */

type Waited = Promise<unknown> | undefined;

function fakePushEvent(payload: unknown): { event: PushEvent; waited: () => Waited } {
  let waited: Waited;
  const event = {
    data: { json: () => payload },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  } as unknown as PushEvent;
  return { event, waited: () => waited };
}

let showNotification: ReturnType<typeof vi.fn>;

/** The stubbed navigator we installed — DOM `Navigator` does not overlap it, so
 *  the cast lives here once rather than at every call-site. */
const stubNav = () =>
  (globalThis as unknown as { self: { navigator: Record<string, ReturnType<typeof vi.fn>> } }).self.navigator;

function installSelf(nav: Record<string, unknown>) {
  showNotification = vi.fn(() => Promise.resolve());
  (globalThis as Record<string, unknown>).self = {
    navigator: nav,
    registration: { showNotification },
  };
}

describe('handlePush — silent (data-only) badge push', () => {
  beforeEach(() => installSelf({ setAppBadge: vi.fn(() => Promise.resolve()), clearAppBadge: vi.fn(() => Promise.resolve()) }));

  it('sets the badge and shows NO banner', async () => {
    const { event, waited } = fakePushEvent({ silent: true, app_badge: 4 });
    handlePush(event);
    await waited();
    const nav = stubNav();
    expect(nav.setAppBadge).toHaveBeenCalledWith(4);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('count 0 CLEARS the badge rather than setting zero', async () => {
    const { event, waited } = fakePushEvent({ silent: true, app_badge: 0 });
    handlePush(event);
    await waited();
    const nav = stubNav();
    expect(nav.clearAppBadge).toHaveBeenCalled();
    expect(nav.setAppBadge).not.toHaveBeenCalled();
  });

  it('accepts the flat `badge` field as well as `app_badge`', async () => {
    const { event, waited } = fakePushEvent({ silent: true, badge: 7 });
    handlePush(event);
    await waited();
    const nav = stubNav();
    expect(nav.setAppBadge).toHaveBeenCalledWith(7);
  });
});

describe('a badge API that REJECTS must not fail the push event', () => {
  // THE BUG. `?.` guards a MISSING api; it does nothing about a rejecting one.
  // setAppBadge rejects on engines that expose it but refuse it (wrong display
  // mode, permission), and waitUntil receiving a rejected promise fails the
  // whole delivery — so an un-settable badge would discard the notification.
  it('setAppBadge rejecting leaves waitUntil resolved', async () => {
    installSelf({ setAppBadge: () => Promise.reject(new Error('not allowed')) });
    const { event, waited } = fakePushEvent({ silent: true, app_badge: 2 });
    handlePush(event);
    await expect(waited()).resolves.toBeUndefined();
  });

  it('clearAppBadge rejecting leaves waitUntil resolved', async () => {
    installSelf({ clearAppBadge: () => Promise.reject(new Error('not allowed')) });
    const { event, waited } = fakePushEvent({ silent: true, app_badge: 0 });
    handlePush(event);
    await expect(waited()).resolves.toBeUndefined();
  });

  it('an engine with NO badge API at all still resolves', async () => {
    installSelf({});
    const { event, waited } = fakePushEvent({ silent: true, app_badge: 3 });
    expect(() => handlePush(event)).not.toThrow();
    await expect(waited()).resolves.toBeUndefined();
  });
});

describe('handlePush — visible notification, both payload shapes', () => {
  beforeEach(() => installSelf({}));

  it('nested { notification: … } — what Safari sends declaratively', async () => {
    const { event, waited } = fakePushEvent({ notification: { title: 'Nyt møde', body: 'kl. 14', navigate: '/m/1' } });
    handlePush(event);
    await waited();
    expect(showNotification).toHaveBeenCalledWith('Nyt møde', expect.objectContaining({ body: 'kl. 14', data: { navigate: '/m/1' } }));
  });

  it('flat shape — what older classic clients send', async () => {
    const { event, waited } = fakePushEvent({ title: 'Besked', body: 'hej', navigate: '/b/2' });
    handlePush(event);
    await waited();
    expect(showNotification).toHaveBeenCalledWith('Besked', expect.objectContaining({ body: 'hej', data: { navigate: '/b/2' } }));
  });

  it('a malformed payload still notifies rather than throwing', async () => {
    let waited: Waited;
    const event = {
      data: { json: () => { throw new SyntaxError('not json'); } },
      waitUntil: (p: Promise<unknown>) => { waited = p; },
    } as unknown as PushEvent;
    expect(() => handlePush(event)).not.toThrow();
    await waited;
    expect(showNotification).toHaveBeenCalled();
  });
});

describe('handleNotificationClick', () => {
  it('focuses an existing window and navigates it', async () => {
    const focus = vi.fn(() => Promise.resolve());
    const navigate = vi.fn(() => Promise.resolve());
    const openWindow = vi.fn(() => Promise.resolve());
    (globalThis as Record<string, unknown>).self = {
      clients: { matchAll: () => Promise.resolve([{ focus, navigate }]), openWindow },
    };
    let waited: Waited;
    const close = vi.fn();
    handleNotificationClick({
      notification: { close, data: { navigate: '/kort/9' } },
      waitUntil: (p: Promise<unknown>) => { waited = p; },
    } as unknown as NotificationEvent);
    await waited;
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/kort/9');
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window when none is available', async () => {
    const openWindow = vi.fn(() => Promise.resolve());
    (globalThis as Record<string, unknown>).self = {
      clients: { matchAll: () => Promise.resolve([]), openWindow },
    };
    let waited: Waited;
    handleNotificationClick({
      notification: { close: vi.fn(), data: { navigate: '/kort/9' } },
      waitUntil: (p: Promise<unknown>) => { waited = p; },
    } as unknown as NotificationEvent);
    await waited;
    expect(openWindow).toHaveBeenCalledWith('/kort/9');
  });
});
