// F067.8 — a notification tap that loses its destination. The post that
// carries the payload must happen BEFORE anything that can fail.
import { describe, expect, it, vi } from 'vitest';
import { createNotificationClickHandler, handleNotificationClick, type NavigateFailure } from '../src/sw';

type Client = { postMessage: ReturnType<typeof vi.fn>; focus?: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> };

function tap(clients: Client[], navigate = '/kort/9', opts: { openWindow?: () => Promise<unknown>; handler?: (e: NotificationEvent) => void } = {}) {
  const log: string[] = [];
  const openWindow = vi.fn(opts.openWindow ?? (() => Promise.resolve()));
  (globalThis as Record<string, unknown>).self = {
    clients: { matchAll: () => Promise.resolve(clients), openWindow },
  };
  let waited: Promise<unknown> = Promise.resolve();
  (opts.handler ?? handleNotificationClick)({
    notification: { close: vi.fn(), data: { navigate } },
    waitUntil: (p: Promise<unknown>) => { waited = p; },
  } as unknown as NotificationEvent);
  return { waited: () => waited, openWindow, log };
}
const MSG = { type: 'webpush:navigate', navigate: '/kort/9' };

describe('F067.8 — every window is told, before anything that can fail', () => {
  it('TWO clients, the FIRST rejects focus() → BOTH get the destination (trail\'s fixture, strict equality)', async () => {
    const a: Client = { postMessage: vi.fn(), focus: () => Promise.reject(new Error('no user activation')), navigate: vi.fn(() => Promise.resolve()) };
    const b: Client = { postMessage: vi.fn(), focus: () => Promise.resolve(), navigate: vi.fn(() => Promise.resolve()) };
    const { waited } = tap([a, b]);
    await waited();
    expect(a.postMessage.mock.calls).toStrictEqual([[MSG]]);
    expect(b.postMessage.mock.calls).toStrictEqual([[MSG]]);
  });

  it('THE THIRD DOOR: the first focus() NEVER resolves → both windows were still told', async () => {
    const a: Client = { postMessage: vi.fn(), focus: () => new Promise(() => {}), navigate: vi.fn() };
    const b: Client = { postMessage: vi.fn(), focus: () => Promise.resolve() };
    tap([a, b]);
    await new Promise((r) => setTimeout(r, 20)); // the waitUntil never settles — and does not need to
    expect(a.postMessage.mock.calls).toStrictEqual([[MSG]]);
    expect(b.postMessage.mock.calls).toStrictEqual([[MSG]]);
  });

  it('the message goes out BEFORE any focus() or navigate() is called', async () => {
    const order: string[] = [];
    const mk = (n: string): Client => ({
      postMessage: vi.fn(() => { order.push(`post ${n}`); }),
      focus: () => { order.push(`focus ${n}`); return Promise.resolve(); },
      navigate: () => { order.push(`navigate ${n}`); return Promise.resolve(); },
    });
    const { waited } = tap([mk('a'), mk('b')]);
    await waited();
    expect(order).toStrictEqual(['post a', 'post b', 'focus a', 'navigate a']);
  });

  it('one client whose postMessage throws does not stop the next', async () => {
    const a: Client = { postMessage: vi.fn(() => { throw new Error('detached'); }), focus: () => Promise.resolve(), navigate: vi.fn(() => Promise.resolve()) };
    const b: Client = { postMessage: vi.fn() };
    const { waited } = tap([a, b]);
    await waited();
    expect(b.postMessage.mock.calls).toStrictEqual([[MSG]]);
  });
});

describe('F067.8 — the fallback still runs for a consumer that does NOT listen (additive)', () => {
  it('navigate() where available', async () => {
    const nav = vi.fn(() => Promise.resolve());
    const { waited, openWindow } = tap([{ postMessage: vi.fn(), focus: () => Promise.resolve(), navigate: nav }]);
    await waited();
    expect(nav).toHaveBeenCalledWith('/kort/9');
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('openWindow() when there is no client at all', async () => {
    const { waited, openWindow } = tap([]);
    await waited();
    expect(openWindow).toHaveBeenCalledWith('/kort/9');
  });
});

describe('F067.8 — THE SILENCE IS GONE: "routed" and "gave up" are no longer the same outcome', () => {
  const withHook = () => {
    const failures: NavigateFailure[] = [];
    return { failures, handler: createNotificationClickHandler({ onNavigateFailure: (e) => { failures.push(e); } }) };
  };

  it('iOS: a client WITHOUT navigate() → navigate_unsupported', async () => {
    const { failures, handler } = withHook();
    const { waited } = tap([{ postMessage: vi.fn(), focus: () => Promise.resolve() }], '/kort/9', { handler });
    await waited();
    expect(failures).toStrictEqual([{ reason: 'navigate_unsupported', navigate: '/kort/9' }]);
  });

  it('a navigate() that REJECTS → navigate_rejected, with the error', async () => {
    const { failures, handler } = withHook();
    const boom = new Error('cross-origin');
    const { waited } = tap([{ postMessage: vi.fn(), focus: () => Promise.resolve(), navigate: () => Promise.reject(boom) }], '/kort/9', { handler });
    await waited();
    expect(failures).toStrictEqual([{ reason: 'navigate_rejected', navigate: '/kort/9', error: boom }]);
  });

  it('no window and openWindow() fails → open_window_failed', async () => {
    const { failures, handler } = withHook();
    const boom = new Error('not allowed');
    const { waited } = tap([], '/kort/9', { handler, openWindow: () => Promise.reject(boom) });
    await waited();
    expect(failures).toStrictEqual([{ reason: 'open_window_failed', navigate: '/kort/9', error: boom }]);
  });

  it('NEGATIVE CONTROL: a navigate() that works reports nothing', async () => {
    const { failures, handler } = withHook();
    const { waited } = tap([{ postMessage: vi.fn(), focus: () => Promise.resolve(), navigate: () => Promise.resolve() }], '/kort/9', { handler });
    await waited();
    expect(failures).toStrictEqual([]);
  });

  it('a hook that throws never breaks the tap', async () => {
    const handler = createNotificationClickHandler({ onNavigateFailure: () => { throw new Error('logger down'); } });
    const { waited } = tap([{ postMessage: vi.fn(), focus: () => Promise.resolve() }], '/kort/9', { handler });
    await expect(waited()).resolves.toBeUndefined();
  });
});
