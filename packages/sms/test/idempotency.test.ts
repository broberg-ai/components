// F076.7 — duplicates and out-of-order delivery events.
//
// The AC insists on something specific and it is worth repeating: a duplicate
// test must assert the SIDE EFFECT happened once, not that the function returned
// the same value twice. A dedupe that returns a consistent verdict while the
// consumer's push notification fires twice has failed at the only thing it was
// for. So every duplicate test here counts real work.
//
// And the ordering guard is asserted as an INVARIANT over every terminal/
// non-terminal pair, not as one hand-picked delivered→pending case. The rule is
// "a resolved state is never replaced by an unresolved one"; a single example
// proves one instance of it, and the loop proves the rule.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createDeliveryInbox,
  MemorySmsEventStore,
  isTerminal,
  parseGatewayApiWebhook,
  type DeliveryReport,
  type DeliveryState,
  type SmsEventStore,
} from '../src/index';

const TERMINAL: DeliveryState[] = ['delivered', 'failed', 'expired'];
const UNRESOLVED: DeliveryState[] = ['pending', 'unknown'];

const report = (over: Partial<DeliveryReport> = {}): DeliveryReport => ({
  provider: 'gatewayapi',
  id: 'm1',
  state: 'delivered',
  raw: 'DELIVERED',
  ...over,
});

/** A store that records every call, so "the package used MY store" is provable. */
function spyStore(
  withAtomic = false,
): { store: SmsEventStore; calls: string[]; map: Map<string, string> } {
  const map = new Map<string, string>();
  const calls: string[] = [];
  const store: SmsEventStore = {
    get(key) {
      calls.push(`get ${key}`);
      return map.get(key) ?? null;
    },
    set(key, value) {
      calls.push(`set ${key}`);
      map.set(key, value);
    },
  };
  if (withAtomic) {
    store.setIfAbsent = (key, value) => {
      calls.push(`setIfAbsent ${key}`);
      if (map.has(key)) return false;
      map.set(key, value);
      return true;
    };
  }
  return { store, calls, map };
}

afterEach(() => vi.useRealTimers());

describe('AC#1 — the same event twice does the work ONCE', () => {
  it('a byte-identical webhook replayed does not fire the side effect again', async () => {
    // Deliberately end-to-end: the real parser, the real payload shape, so this
    // proves the pipeline a consumer actually wires — not a hand-made report.
    const body = {
      event_type: 'message.status.sms',
      event: { msg_id: '01JNN696A9E0WS89FPYGT15NBX', status: 'DELIVERED', status_at: '2026-08-23T12:00:00Z' },
    };

    let pushesSent = 0;
    const inbox = createDeliveryInbox();

    const handle = async () => {
      for (const v of await inbox.accept(parseGatewayApiWebhook(body))) {
        if (v.fresh) pushesSent += 1; // THE SIDE EFFECT
      }
    };

    await handle();
    await handle(); // GatewayAPI's retry, byte for byte
    await handle(); // and again — their backoff runs for 24 hours

    expect(pushesSent).toBe(1);
  });

  it('NEGATIVE CONTROL: two DIFFERENT events both do work', async () => {
    // Without this, "the side effect fired once" would also be satisfied by a
    // dedupe that swallowed everything after the first event forever.
    let worked = 0;
    const inbox = createDeliveryInbox();
    for (const status of ['ENROUTE', 'DELIVERED']) {
      const body = { event_type: 'message.status.sms', event: { msg_id: 'm9', status } };
      for (const v of await inbox.accept(parseGatewayApiWebhook(body))) if (v.fresh) worked += 1;
    }
    expect(worked).toBe(2);
  });

  it('a duplicate is labelled `duplicate`, and reports the state that STANDS', async () => {
    const inbox = createDeliveryInbox();
    const r = report({ at: '2026-08-23T12:00:00Z' });
    expect((await inbox.accept(r))[0]).toMatchObject({ fresh: true, state: 'delivered' });
    expect((await inbox.accept(r))[0]).toMatchObject({ fresh: false, reason: 'duplicate', state: 'delivered' });
  });

  it('two messages are independent — deduping one does not mute the other', async () => {
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ id: 'a' }));
    const [v] = await inbox.accept(report({ id: 'b' }));
    expect(v.fresh).toBe(true);
  });
});

describe('AC#2 — a resolved state is NEVER replaced by an unresolved one', () => {
  // The invariant, over every pair. A single delivered→pending case would prove
  // one instance; the rule is about the whole relation.
  it.each(TERMINAL.flatMap((t) => UNRESOLVED.map((u) => [u, t] as const)))(
    'a late %s arriving after %s leaves the message resolved',
    async (late, terminal) => {
      let writes = 0;
      const inbox = createDeliveryInbox();

      const [first] = await inbox.accept(report({ state: terminal, raw: terminal, at: '2026-08-23T12:00:05Z' }));
      if (first.fresh) writes += 1;

      // The delayed event: it happened EARLIER and arrives LATER.
      const [second] = await inbox.accept(report({ state: late, raw: late, at: '2026-08-23T12:00:00Z' }));
      if (second.fresh) writes += 1;

      expect(second.fresh).toBe(false);
      expect(second.reason).toBe('superseded');
      expect(second.state).toBe(terminal);
      expect(second.state).not.toBe(late);
      expect(writes).toBe(1);
    },
  );

  it.each(UNRESOLVED.flatMap((u) => TERMINAL.map((t) => [u, t] as const)))(
    'NEGATIVE CONTROL: %s then %s DOES advance to %s',
    async (unresolved, terminal) => {
      // The mirror image. Without it, "never downgrade" is satisfied by a guard
      // that freezes the first state it ever sees and ignores everything after.
      const inbox = createDeliveryInbox();
      await inbox.accept(report({ state: unresolved, raw: unresolved, at: '2026-08-23T12:00:00Z' }));
      const [v] = await inbox.accept(report({ state: terminal, raw: terminal, at: '2026-08-23T12:00:05Z' }));
      expect(v.fresh).toBe(true);
      expect(v.state).toBe(terminal);
    },
  );

  it('an UNKNOWN status must not wipe out a delivered one — that is why unknown is not terminal', async () => {
    // A gateway sending one status word we have never met would otherwise turn a
    // message we know arrived into a message we know nothing about.
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ state: 'delivered', raw: 'DELIVERED' }));
    const [v] = await inbox.accept(report({ state: 'unknown', raw: 'SOMETHING_NEW' }));
    expect(v.fresh).toBe(false);
    expect(v.state).toBe('delivered');
  });

  it('isTerminal() answers the same question the guard asks', () => {
    for (const s of TERMINAL) expect(isTerminal(s)).toBe(true);
    for (const s of UNRESOLVED) expect(isTerminal(s)).toBe(false);
  });
});

describe('within one tier, the gateway’s own timestamps decide', () => {
  it('an older DELIVERED arriving after a newer FAILED does not overwrite it', async () => {
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ state: 'failed', raw: 'UNDELIVERABLE', at: '2026-08-23T12:00:10Z' }));
    const [v] = await inbox.accept(report({ state: 'delivered', raw: 'DELIVERED', at: '2026-08-23T12:00:00Z' }));
    expect(v.fresh).toBe(false);
    expect(v.state).toBe('failed');
  });

  it('a NEWER one in the same tier does overwrite', async () => {
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ state: 'delivered', raw: 'DELIVERED', at: '2026-08-23T12:00:00Z' }));
    const [v] = await inbox.accept(report({ state: 'failed', raw: 'UNDELIVERABLE', at: '2026-08-23T12:00:10Z' }));
    expect(v.fresh).toBe(true);
    expect(v.state).toBe('failed');
  });

  it('with NO timestamps, the newest arrival wins within a tier — we have nothing better', async () => {
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ state: 'pending', raw: 'ENROUTE' }));
    const [v] = await inbox.accept(report({ state: 'unknown', raw: 'MYSTERY' }));
    expect(v.fresh).toBe(true);
    expect(v.state).toBe('unknown');
  });

  it('a timestamp on only ONE side is not used to demote — half an ordering is no ordering', async () => {
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ state: 'pending', raw: 'ENROUTE', at: '2026-08-23T12:00:10Z' }));
    const [v] = await inbox.accept(report({ state: 'unknown', raw: 'MYSTERY' }));
    expect(v.fresh).toBe(true);
  });
});

describe('AC#3 + AC#5 — the package owns no database, and says what you are getting', () => {
  it('no store at all → guarantee "process"', () => {
    expect(createDeliveryInbox().guarantee).toBe('process');
  });

  it('a store WITHOUT setIfAbsent → guarantee "shared" — real, but not concurrency-safe', () => {
    expect(createDeliveryInbox({ store: spyStore(false).store }).guarantee).toBe('shared');
  });

  it('a store WITH setIfAbsent → guarantee "shared-atomic"', () => {
    expect(createDeliveryInbox({ store: spyStore(true).store }).guarantee).toBe('shared-atomic');
  });

  it('the default is NOT a no-op pretending to dedupe — it really does dedupe, in this process', async () => {
    // AC#3's exact words: documented behaviour, not an accidental no-op that
    // looks like deduping. So the honest label AND the real behaviour, together.
    const inbox = createDeliveryInbox();
    expect(inbox.guarantee).toBe('process');
    const r = report();
    expect((await inbox.accept(r))[0].fresh).toBe(true);
    expect((await inbox.accept(r))[0].fresh).toBe(false);
  });

  it('the guarantee is honest about the OTHER direction too — a second inbox does not share process memory', async () => {
    // This is what 'process' means, spelled out: two instances (a second worker,
    // a restart) each start empty and both act on the same event.
    const r = report();
    expect((await createDeliveryInbox().accept(r))[0].fresh).toBe(true);
    expect((await createDeliveryInbox().accept(r))[0].fresh).toBe(true);
  });

  it('YOUR store is the one that decides — two inboxes sharing it dedupe across both', async () => {
    // The proof that no state is hidden inside the package.
    const { store, calls } = spyStore(true);
    const r = report();
    expect((await createDeliveryInbox({ store }).accept(r))[0].fresh).toBe(true);
    expect((await createDeliveryInbox({ store }).accept(r))[0].fresh).toBe(false);
    expect(calls.some((c) => c.startsWith('setIfAbsent sms:event:'))).toBe(true);
    expect(calls.some((c) => c.startsWith('set sms:state:'))).toBe(true);
  });

  it('a store WITHOUT setIfAbsent still dedupes sequentially — it just cannot promise concurrency', async () => {
    const { store, calls } = spyStore(false);
    const inbox = createDeliveryInbox({ store });
    const r = report();
    expect((await inbox.accept(r))[0].fresh).toBe(true);
    expect((await inbox.accept(r))[0].fresh).toBe(false);
    expect(inbox.guarantee).toBe('shared');
    expect(calls.some((c) => c.startsWith('setIfAbsent'))).toBe(false);
  });

  it('an async store works — every call is awaited', async () => {
    const map = new Map<string, string>();
    const store: SmsEventStore = {
      async get(k) {
        await Promise.resolve();
        return map.get(k) ?? null;
      },
      async set(k, v) {
        await Promise.resolve();
        map.set(k, v);
      },
    };
    const inbox = createDeliveryInbox({ store });
    const r = report();
    expect((await inbox.accept(r))[0].fresh).toBe(true);
    expect((await inbox.accept(r))[0].fresh).toBe(false);
  });

  it('a `prefix` namespaces the keys, so one store can serve more than this', async () => {
    const { store, calls } = spyStore(true);
    await createDeliveryInbox({ store, prefix: 'tenant7' }).accept(report());
    expect(calls.some((c) => c.includes('tenant7:event:'))).toBe(true);
    expect(calls.some((c) => c.includes('sms:event:'))).toBe(false);
  });
});

describe('the event key', () => {
  it('two events differing ONLY in status word are distinct — the raw value is part of the identity', async () => {
    // ENROUTE and BUFFERED both map to `pending`. If the key ignored `raw`, the
    // second would look like a replay of the first and be silently dropped.
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ state: 'pending', raw: 'ENROUTE' }));
    const [v] = await inbox.accept(report({ state: 'pending', raw: 'BUFFERED' }));
    expect(v.fresh).toBe(true);
  });

  it('a custom eventKey takes over — use your gateway’s own event id when it gives you one', async () => {
    const inbox = createDeliveryInbox({ eventKey: (r) => `evt:${r.raw}` });
    // Same custom key, different everything else: still a replay.
    await inbox.accept(report({ id: 'a', raw: 'E1' }));
    const [v] = await inbox.accept(report({ id: 'b', raw: 'E1' }));
    expect(v.fresh).toBe(false);
    expect(v.reason).toBe('duplicate');
  });
});

describe('it must never throw — a webhook handler that throws earns a 24-hour retry storm', () => {
  it.each([
    ['an empty array', [] as DeliveryReport[]],
    ['a report with an empty id', [report({ id: '' })]],
    ['a report with an empty raw', [report({ raw: '' })]],
    ['a report with an unparseable timestamp', [report({ at: 'not a date' })]],
  ])('%s is handled', async (_label, input) => {
    await expect(createDeliveryInbox().accept(input)).resolves.toBeInstanceOf(Array);
  });

  it('a store that returns corrupt JSON is ignored, not fatal', async () => {
    const store: SmsEventStore = {
      get: (k) => (k.includes(':state:') ? '{not json' : null),
      set: () => {},
    };
    const [v] = await createDeliveryInbox({ store }).accept(report());
    expect(v.fresh).toBe(true);
  });

  it('a store holding a state value we do not recognise is ignored, not trusted', async () => {
    const store: SmsEventStore = {
      get: (k) => (k.includes(':state:') ? JSON.stringify({ state: 'teleported' }) : null),
      set: () => {},
    };
    const [v] = await createDeliveryInbox({ store }).accept(report({ state: 'pending', raw: 'ENROUTE' }));
    expect(v.fresh).toBe(true);
  });

  it('a batch is judged per report — one duplicate does not drop its neighbours', async () => {
    const inbox = createDeliveryInbox();
    await inbox.accept(report({ id: 'a' }));
    const out = await inbox.accept([report({ id: 'a' }), report({ id: 'b' }), report({ id: 'c' })]);
    expect(out.map((v) => v.fresh)).toEqual([false, true, true]);
  });
});

describe('MemorySmsEventStore — bounded, because it sits behind a public URL', () => {
  it('forgets an event once its TTL has passed, so a LATER genuine event is not mistaken for a replay', () => {
    vi.useFakeTimers();
    const store = new MemorySmsEventStore();
    store.set('k', 'v', 1000);
    expect(store.get('k')).toBe('v');
    vi.advanceTimersByTime(1001);
    expect(store.get('k')).toBeNull();
  });

  it('setIfAbsent is the claim — exactly one caller wins', () => {
    const store = new MemorySmsEventStore();
    expect(store.setIfAbsent('k', '1')).toBe(true);
    expect(store.setIfAbsent('k', '1')).toBe(false);
  });

  it('an expired key can be claimed again', () => {
    vi.useFakeTimers();
    const store = new MemorySmsEventStore();
    expect(store.setIfAbsent('k', '1', 1000)).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(store.setIfAbsent('k', '1', 1000)).toBe(true);
  });

  it('DOES NOT GROW WITHOUT LIMIT — a webhook endpoint would otherwise leak memory publicly', () => {
    const store = new MemorySmsEventStore({ max: 10 });
    for (let i = 0; i < 500; i += 1) store.set(`k${i}`, '1');
    expect(store.size).toBeLessThanOrEqual(10);
  });

  it('under pressure it drops the OLDEST, so the newest events stay deduped', () => {
    const store = new MemorySmsEventStore({ max: 3 });
    for (const k of ['a', 'b', 'c', 'd']) store.set(k, '1');
    expect(store.get('a')).toBeNull();
    expect(store.get('d')).toBe('1');
  });
});
