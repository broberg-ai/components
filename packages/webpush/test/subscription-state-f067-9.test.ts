// F067.9 — "could not find out" and "not subscribed" are no longer one value.
import { afterEach, describe, expect, it } from 'vitest';
import { getSubscription, getSubscriptionState, type SubscriptionState } from '../src/client';

const SUB = { endpoint: 'https://push.example/abc' } as unknown as PushSubscription;
const never = <T>() => new Promise<T>(() => {});
function nav(sw: { ready: Promise<unknown>; getRegistration: () => Promise<unknown> }) {
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw }, configurable: true, writable: true });
}
const reg = (getSub: () => Promise<PushSubscription | null>) => ({ pushManager: { getSubscription: getSub } });
afterEach(() => { delete (globalThis as Record<string, unknown>).navigator; });

describe('getSubscriptionState — three states, driven without a browser (F067.9)', () => {
  it('subscribed → { state: "subscribed", subscription }', async () => {
    nav({ ready: Promise.resolve(reg(async () => SUB)), getRegistration: async () => undefined });
    expect(await getSubscriptionState()).toStrictEqual({ state: 'subscribed', subscription: SUB });
  });

  it('NEGATIVE CONTROL: a registration with NO subscription → { state: "none" }, not unknown', async () => {
    nav({ ready: Promise.resolve(reg(async () => null)), getRegistration: async () => undefined });
    expect(await getSubscriptionState()).toStrictEqual({ state: 'none' });
  });

  it('THE DEADLINE: .ready never resolves AND getRegistration() is undefined → unknown, not none', async () => {
    nav({ ready: never(), getRegistration: async () => undefined });
    expect(await getSubscriptionState({ timeoutMs: 20 })).toStrictEqual({ state: 'unknown', reason: 'worker-not-ready' });
  });

  it('...and in that SAME state getSubscription() still answers null — the defect, kept for compatibility', async () => {
    nav({ ready: never(), getRegistration: async () => undefined });
    expect(await getSubscription()).toBeNull();
  }, 5000);

  it('a lookup that throws → unknown (lookup-failed), never none', async () => {
    nav({ ready: Promise.resolve(reg(async () => { throw new Error('denied'); })), getRegistration: async () => undefined });
    expect(await getSubscriptionState()).toStrictEqual({ state: 'unknown', reason: 'lookup-failed' });
  });

  it('a late worker found by the direct lookup is still read', async () => {
    nav({ ready: never(), getRegistration: async () => reg(async () => SUB) });
    expect(await getSubscriptionState({ timeoutMs: 20 })).toStrictEqual({ state: 'subscribed', subscription: SUB });
  });

  it('`unknown` IS NOT FALSY-EQUAL TO `none` — the seal on the whole card', async () => {
    nav({ ready: never(), getRegistration: async () => undefined });
    const unknown = await getSubscriptionState({ timeoutMs: 20 });
    nav({ ready: Promise.resolve(reg(async () => null)), getRegistration: async () => undefined });
    const none = await getSubscriptionState();
    expect(unknown.state).toBe('unknown');
    expect(none.state).toBe('none');
    expect(unknown).not.toStrictEqual(none);
  });

  it('getSubscription() is UNCHANGED: PushSubscription | null', async () => {
    nav({ ready: Promise.resolve(reg(async () => SUB)), getRegistration: async () => undefined });
    const s: PushSubscription | null = await getSubscription();
    expect(s).toBe(SUB);
  });
});

describe('type level — the old mistake does not compile, the right one does (same tsc run)', () => {
  it('using the result as a subscription or as nullable is refused; a switch on state is accepted', async () => {
    nav({ ready: Promise.resolve(reg(async () => SUB)), getRegistration: async () => undefined });
    const r: SubscriptionState = await getSubscriptionState();
    // @ts-expect-error the result is not PushSubscription | null
    const asNullable: PushSubscription | null = r;
    // @ts-expect-error there is no .endpoint without narrowing on state
    const endpoint: string = r.endpoint;
    // @ts-expect-error .subscription exists only once state === 'subscribed'
    const sub = r.subscription;
    // ACCEPTED: the correct use compiles in the same run
    let label: string;
    switch (r.state) {
      case 'subscribed': label = r.subscription.endpoint; break;
      case 'none': label = 'off'; break;
      case 'unknown': label = `could not tell (${r.reason})`; break;
    }
    expect([asNullable, endpoint, sub, label].length).toBe(4);
    expect(label).toBe('https://push.example/abc');
  });
});
