import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createPushHandler, handlePush, handleNotificationClick } from '../src/sw';

/**
 * F067 — the service-worker half, all the way out to a file an UNBUNDLED worker
 * can use, plus the three defaults cardmem and xrt81 were each working around.
 *
 * All three default ON, on cardmem's argument: a fix that ships behind a flag
 * reaches only the people who read changelogs, i.e. the people who did not need
 * it. Their risk analysis is measurable rather than rhetorical — the sender only
 * puts `app_badge` in a payload when the caller passes `badge`, so a consumer
 * sending no number is provably untouched. That claim gets its own test below,
 * because "provably" is the whole point.
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

function installSelf(nav: Record<string, unknown> = {}) {
  const showNotification = vi.fn(() => Promise.resolve());
  (globalThis as Record<string, unknown>).self = { navigator: nav, registration: { showNotification } };
  return showNotification;
}

const badgeStub = () => ({ setAppBadge: vi.fn(() => Promise.resolve()), clearAppBadge: vi.fn(() => Promise.resolve()) });
const nav = () => (globalThis as unknown as { self: { navigator: Record<string, ReturnType<typeof vi.fn>> } }).self.navigator;

describe('badgeOnVisible — default ON', () => {
  it('a VISIBLE push carrying app_badge sets the badge AND shows the banner', async () => {
    // RED against 0.1.2, where the badge was only ever touched on the silent path,
    // so the number on the icon did not move until the message was read elsewhere.
    const stub = badgeStub();
    const show = installSelf(stub);
    const { event, waited } = fakePush({ title: 'Ny besked', app_badge: 3 });
    handlePush(event);
    await waited();
    expect(nav().setAppBadge).toHaveBeenCalledWith(3);
    expect(show).toHaveBeenCalledWith('Ny besked', expect.objectContaining({ body: '' }));
  });

  it('THE UNTOUCHED CASE, proved not assumed: a visible push with NO badge field calls neither badge API', async () => {
    // This is cardmem's "consumers who send no number are unaffected" turned
    // from a risk assessment into a control. If default-ON ever reaches wider
    // than we think, this is the test that says so.
    const stub = badgeStub();
    installSelf(stub);
    const { event, waited } = fakePush({ title: 'Ingen tal her' });
    handlePush(event);
    await waited();
    expect(nav().setAppBadge).not.toHaveBeenCalled();
    expect(nav().clearAppBadge).not.toHaveBeenCalled();
  });

  it('badgeOnVisible: false restores the old behaviour for anyone who wants it', async () => {
    const stub = badgeStub();
    installSelf(stub);
    const { event, waited } = fakePush({ title: 'x', app_badge: 5 });
    createPushHandler({ badgeOnVisible: false })(event);
    await waited();
    expect(nav().setAppBadge).not.toHaveBeenCalled();
  });

  it('a rejecting badge on the VISIBLE path still does not fail the push event', async () => {
    installSelf({ setAppBadge: () => Promise.reject(new Error('nope')) });
    const { event, waited } = fakePush({ title: 'x', app_badge: 2 });
    handlePush(event);
    await expect(waited()).resolves.toBeDefined();
  });
});

describe('defaultNavigate — a tap must do something', () => {
  it('a payload with no navigate still stamps a destination on the notification', async () => {
    const show = installSelf();
    const { event, waited } = fakePush({ title: 'x' });
    handlePush(event);
    await waited();
    expect(show).toHaveBeenCalledWith('x', expect.objectContaining({ data: { navigate: '/' } }));
  });

  it('a click with no navigate and no open window opens "/" rather than nothing', async () => {
    const openWindow = vi.fn(() => Promise.resolve());
    (globalThis as Record<string, unknown>).self = { clients: { matchAll: () => Promise.resolve([]), openWindow } };
    let waited: Waited;
    handleNotificationClick({
      notification: { close: vi.fn(), data: {} },
      waitUntil: (p: Promise<unknown>) => { waited = p; },
    } as unknown as NotificationEvent);
    await waited;
    expect(openWindow).toHaveBeenCalledWith('/');
  });

  it('an explicit navigate still wins', async () => {
    const show = installSelf();
    const { event, waited } = fakePush({ title: 'x', navigate: '/kort/7' });
    handlePush(event);
    await waited();
    expect(show).toHaveBeenCalledWith('x', expect.objectContaining({ data: { navigate: '/kort/7' } }));
  });
});

describe('defaultTitle — a fleet package must not hard-code one language', () => {
  it('createPushHandler configures the title', async () => {
    const show = installSelf();
    const { event, waited } = fakePush({ body: 'ingen titel' });
    createPushHandler({ defaultTitle: 'Notification' })(event);
    await waited();
    expect(show).toHaveBeenCalledWith('Notification', expect.anything());
  });

  it('plain handlePush keeps the existing default, so nobody sees text change', async () => {
    const show = installSelf();
    const { event, waited } = fakePush({ body: 'ingen titel' });
    handlePush(event);
    await waited();
    expect(show).toHaveBeenCalledWith('Notifikation', expect.anything());
  });
});

describe('dist/sw.global.js — the file an unbundled service worker can use', () => {
  const built = () => readFileSync(new URL('../dist/sw.global.js', import.meta.url), 'utf8');

  it('carries no import and no export statement', () => {
    // The single thing that made dist/sw.js unusable from a static public/sw.js
    // was its trailing export. Asserted on the BUILT bytes, not on intent.
    const src = built();
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/^\s*export\s/m);
  });

  it('defines self.BrobergWebPush AND registers both listeners', () => {
    // Both halves, separately: a consumer may call the globals themselves, or
    // rely on the auto-attach. Asserting only one would leave the other free to
    // rot.
    const listeners: string[] = [];
    const fakeSelf: Record<string, unknown> = {
      addEventListener: (type: string) => listeners.push(type),
    };
    new Function('self', built())(fakeSelf);

    const api = fakeSelf.BrobergWebPush as Record<string, unknown>;
    expect(Object.keys(api).sort()).toEqual(['createPushHandler', 'handleNotificationClick', 'handlePush']);
    expect(typeof api.handlePush).toBe('function');
    expect(listeners.sort()).toEqual(['notificationclick', 'push']);
  });

  it('the handler inside the built file behaves like the source one', async () => {
    // Guards the real risk of a second build format: that it drifts from the
    // module everyone else imports.
    const stub = badgeStub();
    const show = installSelf(stub);
    const captured: Record<string, (e: unknown) => void> = {};
    const fakeSelf: Record<string, unknown> = {
      addEventListener: (t: string, fn: (e: unknown) => void) => { captured[t] = fn; },
      navigator: stub,
      registration: { showNotification: show },
    };
    new Function('self', built())(fakeSelf);

    let waited: Waited;
    captured.push!({
      data: { json: () => ({ title: 'fra global', app_badge: 9 }) },
      waitUntil: (p: Promise<unknown>) => { waited = p; },
    });
    await waited;
    expect(show).toHaveBeenCalledWith('fra global', expect.objectContaining({ data: { navigate: '/' } }));
    expect(stub.setAppBadge).toHaveBeenCalledWith(9);
  });
});
