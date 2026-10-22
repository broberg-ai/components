import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildPayload } from '../src/index';
import { createNotificationClickHandler, createPushHandler, handleNotificationClick, handlePush } from '../src/sw';

/**
 * F067.10 — buttons on a notification («Markér som læst», «Arkivér»), ordered
 * by Christian for the WebHouse mail client. Platforms without buttons must see
 * no difference, and the 10 existing consumers must see none either.
 */

type Waited = Promise<unknown> | undefined;

function fakePush(payload: unknown): { event: PushEvent; waited: () => Waited } {
  let waited: Waited;
  const event = { data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => { waited = p; } } as unknown as PushEvent;
  return { event, waited: () => waited };
}

function installSelf(extra: Record<string, unknown> = {}) {
  const showNotification = vi.fn((_t: string, _o: unknown) => Promise.resolve());
  (globalThis as Record<string, unknown>).self = { navigator: {}, registration: { showNotification }, ...extra };
  return showNotification;
}

function fakeClick(action: string, data: unknown, tag = 'mail-123') {
  let waited: Waited;
  const close = vi.fn();
  const event = { action, notification: { close, data, tag }, waitUntil: (p: Promise<unknown>) => { waited = p; } } as unknown as NotificationEvent;
  return { event, close, waited: () => waited };
}

function installClients() {
  const openWindow = vi.fn(() => Promise.resolve());
  const matchAll = vi.fn(() => Promise.resolve([]));
  (globalThis as Record<string, unknown>).self = { clients: { matchAll, openWindow } };
  return { openWindow, matchAll };
}

const ACTIONS = [
  { action: 'read', title: 'Markér som læst' },
  { action: 'archive', title: 'Arkivér' },
];

describe('the sender carries buttons only in the classic half', () => {
  it('actions + data appear in the classic fields, NEVER in the declarative Safari payload', () => {
    const p = JSON.parse(buildPayload({ title: 'Ny mail', body: 'Fra Sanne', tag: 'mail-123', actions: ACTIONS, data: { mailId: 123 } }));
    expect(p.actions).toEqual(ACTIONS);
    expect(p.data).toEqual({ mailId: 123 });
    expect(Object.keys(p.notification).sort()).toEqual(['body', 'title']);
  });

  it('negative control: without actions/data the payload is byte-identical to 0.5.0', () => {
    const m = { title: 'Ny mail', body: 'Fra Sanne', navigate: '/inbox', tag: 't', badge: 3 };
    const v050 = JSON.stringify({
      web_push: 8030,
      notification: { title: m.title, body: m.body, navigate: m.navigate, app_badge: 3 },
      title: m.title, body: m.body, navigate: m.navigate, badge: m.badge, icon: undefined, tag: m.tag,
    });
    expect(buildPayload(m)).toBe(v050);
  });
});

describe('the service worker shows the buttons', () => {
  it('showNotification gets exactly the actions, and the sender data rides along', async () => {
    const show = installSelf();
    const { event, waited } = fakePush({ title: 'Ny mail', body: 'Fra Sanne', tag: 'mail-123', actions: ACTIONS, data: { mailId: 123 } });
    handlePush(event);
    await waited();
    expect(show.mock.calls[0]![1]).toEqual({
      body: 'Fra Sanne',
      tag: 'mail-123',
      actions: ACTIONS,
      data: { navigate: '/', data: { mailId: 123 } },
    });
  });

  it('negative control: no actions → options exactly as in 0.5.0 (no actions key, data only navigate)', async () => {
    const show = installSelf();
    const { event, waited } = fakePush({ title: 'x', body: 'y', tag: 't' });
    handlePush(event);
    await waited();
    expect(show.mock.calls[0]![1]).toEqual({ body: 'y', tag: 't', data: { navigate: '/' } });
  });

  it('more buttons than the browser shows are cut to Notification.maxActions — and it says so', async () => {
    const show = installSelf({ Notification: { maxActions: 1 } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { event, waited } = fakePush({ title: 'x', actions: ACTIONS });
    createPushHandler()(event);
    await waited();
    expect((show.mock.calls[0]![1] as { actions: unknown }).actions).toEqual([ACTIONS[0]]);
    expect(warn.mock.calls[0]![0]).toContain('dropped: archive');
    warn.mockRestore();
  });
});

describe('a button tap reaches the app — and opens nothing', () => {
  it('event.action "read" calls onAction with action, tag and data; no window is opened or focused', async () => {
    const { openWindow, matchAll } = installClients();
    const seen: unknown[] = [];
    const click = createNotificationClickHandler({ onAction: async ({ action, tag, data }) => { seen.push({ action, tag, data }); } });
    const { event, close, waited } = fakeClick('read', { navigate: '/', data: { mailId: 123 } });
    click(event);
    await waited();
    expect(seen).toEqual([{ action: 'read', tag: 'mail-123', data: { mailId: 123 } }]);
    expect(close).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    expect(matchAll).not.toHaveBeenCalled();
  });

  it('a tap on the notification itself (action "") opens the app exactly as before — onAction not called', async () => {
    const { openWindow } = installClients();
    const onAction = vi.fn();
    const { event, waited } = fakeClick('', { navigate: '/inbox/123' });
    createNotificationClickHandler({ onAction })(event);
    await waited();
    expect(onAction).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('/inbox/123');
  });

  it('without onAction a button tap still does something: it opens the app (never a dead tap)', async () => {
    const { openWindow } = installClients();
    const { event, waited } = fakeClick('read', { navigate: '/inbox/123' });
    createNotificationClickHandler()(event);
    await waited();
    expect(openWindow).toHaveBeenCalledWith('/inbox/123');
  });

  it('a failing onAction is not swallowed — the promise handed to waitUntil rejects', async () => {
    installClients();
    const { event, waited } = fakeClick('read', {});
    createNotificationClickHandler({ onAction: () => Promise.reject(new Error('server said 500')) })(event);
    await expect(waited()).rejects.toThrow('server said 500');
  });

  it('handleNotificationClick (what consumers wire today) is unchanged: a button tap opens the app', async () => {
    const { openWindow } = installClients();
    const { event, waited } = fakeClick('read', { navigate: '/x' });
    handleNotificationClick(event);
    await waited();
    expect(openWindow).toHaveBeenCalledWith('/x');
  });
});

describe('dist/sw.global.js — configure({ onAction }) reaches the ONE click listener', () => {
  const built = () => readFileSync(new URL('../dist/sw.global.js', import.meta.url), 'utf8');
  function load() {
    const captured: Record<string, (e: unknown) => void> = {};
    const listeners: string[] = [];
    const openWindow = vi.fn(() => Promise.resolve());
    const fakeSelf: Record<string, unknown> = {
      addEventListener: (t: string, fn: (e: unknown) => void) => { listeners.push(t); captured[t] = fn; },
      clients: { matchAll: () => Promise.resolve([]), openWindow },
    };
    new Function('self', built())(fakeSelf);
    return { captured, listeners, openWindow, api: fakeSelf.BrobergWebPush as { configure: (o: unknown) => void } };
  }

  it('a button tap goes to onAction after configure(), and still only one click listener exists', async () => {
    const { captured, listeners, openWindow, api } = load();
    const seen: unknown[] = [];
    api.configure({ onAction: ({ action, data }: { action: string; data: unknown }) => { seen.push({ action, data }); } });
    const { event, waited } = fakeClick('archive', { navigate: '/', data: { mailId: 7 } });
    captured.notificationclick!(event);
    await waited();
    expect(seen).toEqual([{ action: 'archive', data: { mailId: 7 } }]);
    expect(openWindow).not.toHaveBeenCalled();
    expect(listeners.filter((t) => t === 'notificationclick')).toHaveLength(1);
  });

  it('negative control: without configure the global click listener opens the app as in 0.5.0', async () => {
    const { captured, openWindow } = load();
    const { event, waited } = fakeClick('archive', { navigate: '/x' });
    captured.notificationclick!(event);
    await waited();
    expect(openWindow).toHaveBeenCalledWith('/x');
  });
});
