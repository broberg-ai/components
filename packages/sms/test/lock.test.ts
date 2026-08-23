// F076.9 — the send-side duplicate lock.
//
// Christian asked the question this file answers: «Har vi en "lås/spærre" for at
// en kunde ikke kommer til at sende den samme besked flere gange til den samme
// modtager?» The answer was no, and the cost of no is a customer billed twice and
// a recipient reading the same SMS twice.
//
// Every test that claims something was NOT sent proves it by counting calls to
// the provider — the thing that spends the money — never by comparing returned
// objects. A lock that returns a tidy verdict while the gateway is called twice
// has failed at the only thing it is for.
//
// And the false-positive half is not optional. A lock that blocks EVERYTHING
// satisfies "the duplicate was not sent" perfectly and is worse than no lock, so
// it gets its own named block below.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSms,
  createDuplicateGuard,
  MemorySmsEventStore,
  SmsUnknownError,
  type SmsEventStore,
  type SmsProvider,
  type SmsResult,
} from '../src/index';

afterEach(() => vi.useRealTimers());

/** A provider that counts what it was actually asked to send. */
function spyProvider(behaviour?: () => Promise<{ id?: string }>) {
  const sent: Array<{ to: string; text: string; from: string }> = [];
  const provider: SmsProvider = {
    name: 'spy',
    async send(m) {
      sent.push(m);
      if (behaviour) return behaviour();
      return { id: `msg_${sent.length}` };
    },
  };
  return { provider, sent };
}

const client = (extra: Record<string, unknown> = {}) => {
  const { provider, sent } = spyProvider(extra.behaviour as (() => Promise<{ id?: string }>) | undefined);
  delete extra.behaviour;
  return { sms: createSms({ provider, from: 'Moovyy', live: true, ...extra }), sent };
};

describe('AC#1 — the same message to the same person is sent ONCE', () => {
  it('a double-clicked send calls the gateway once, not twice', async () => {
    const { sms, sent } = client();
    await sms.send({ to: '+4522680880', text: 'Din kode er 1234' });
    await sms.send({ to: '+4522680880', text: 'Din kode er 1234' });
    await sms.send({ to: '+4522680880', text: 'Din kode er 1234' });
    expect(sent).toHaveLength(1); // THE GATEWAY. The thing that costs money.
  });

  it('TWO SIMULTANEOUS sends — the actual double-click — still reach the gateway once', async () => {
    // Sequential deduping is the easy half. This is the one a naive
    // check-then-send fails: both calls in flight before either has recorded
    // anything. The in-memory store claims atomically, so one wins.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { provider, sent } = spyProvider(async () => {
      await gate;
      return { id: 'msg_1' };
    });
    const sms = createSms({ provider, from: 'Moovyy', live: true });

    const both = Promise.all([
      sms.send({ to: '+4522680880', text: 'Hej' }),
      sms.send({ to: '+4522680880', text: 'Hej' }),
    ]);
    release?.();
    const [a, b] = await both;

    expect(sent).toHaveLength(1);
    expect([a.outcome, b.outcome].sort()).toEqual(['sent', 'skipped']);
  });

  it('the suppressed call is not an error — the caller has nothing to fix', async () => {
    const { sms } = client();
    await sms.send({ to: '+4522680880', text: 'Hej' });
    const res = await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

describe('AC#2 — a duplicate is distinguishable from every other kind of non-send', () => {
  const reasonOf = (r: SmsResult) => r.skippedReason;

  it('all four skip reasons are different VALUES a caller can branch on', async () => {
    const dup = client();
    await dup.sms.send({ to: '+4522680880', text: 'Hej' });

    const results: Record<string, SmsResult> = {
      duplicate: await dup.sms.send({ to: '+4522680880', text: 'Hej' }),
      'not-allowlisted': await client({ live: false }).sms.send({ to: '+4522680880', text: 'Hej' }),
      disabled: await client({ disabled: true }).sms.send({ to: '+4522680880', text: 'Hej' }),
      'no-provider': await createSms({ from: 'Moovyy', live: true }).send({ to: '+4522680880', text: 'Hej' }),
    };

    for (const [expected, res] of Object.entries(results)) {
      expect(reasonOf(res)).toBe(expected);
      expect(res.outcome).toBe('skipped');
    }
    // The discriminating half: four calls, four DIFFERENT reasons.
    expect(new Set(Object.values(results).map(reasonOf)).size).toBe(4);
  });

  it('a duplicate is not `sent` and not `refused` — retrying it would be the bug', async () => {
    const { sms } = client();
    await sms.send({ to: '+4522680880', text: 'Hej' });
    const res = await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(res.outcome).toBe('skipped');
    expect(res.outcome).not.toBe('sent');
    expect(res.outcome).not.toBe('refused');
  });

  it('the cost is still reported, so you can see what the lock saved you', async () => {
    const { sms } = client();
    const text = 'a'.repeat(200);
    await sms.send({ to: '+4522680880', text });
    const res = await sms.send({ to: '+4522680880', text });
    expect(res.estimate?.segments).toBe(2);
  });
});

describe('AC#3 — the suppressed call hands back the ORIGINAL message id', () => {
  it('so the caller keeps the handle it needs for delivery status', async () => {
    const { sms } = client();
    const first = await sms.send({ to: '+4522680880', text: 'Hej' });
    const second = await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(first.id).toBe('msg_1');
    expect(second.id).toBe('msg_1');
    expect(second.skippedReason).toBe('duplicate');
  });

  it('a provider that returns no id yields no id — nothing is invented', async () => {
    const { sms } = client({ behaviour: async () => ({}) });
    await sms.send({ to: '+4522680880', text: 'Hej' });
    const second = await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(second.skippedReason).toBe('duplicate');
    expect(second.id).toBeUndefined();
  });
});

describe('AC#4 — THE FALSE-POSITIVE GUARD: a lock that blocks everything is worse than none', () => {
  it('a DIFFERENT recipient still gets the message', async () => {
    const { sms, sent } = client();
    await sms.send({ to: '+4522680880', text: 'Hej' });
    await sms.send({ to: '+4512345678', text: 'Hej' });
    expect(sent).toHaveLength(2);
  });

  it('a DIFFERENT text still goes to the same recipient', async () => {
    const { sms, sent } = client();
    await sms.send({ to: '+4522680880', text: 'Din kode er 1234' });
    await sms.send({ to: '+4522680880', text: 'Din kode er 5678' });
    expect(sent).toHaveLength(2);
  });

  it('a DIFFERENT sender is a different message', async () => {
    const { sms, sent } = client();
    await sms.send({ to: '+4522680880', text: 'Hej' });
    await sms.send({ to: '+4522680880', text: 'Hej', from: 'Sanne' });
    expect(sent).toHaveLength(2);
  });

  it('THE SAME MESSAGE AFTER THE WINDOW HAS PASSED goes out — the lock expires', async () => {
    vi.useFakeTimers();
    const { sms, sent } = client({ duplicates: { window: 60_000 } });
    await sms.send({ to: '+4522680880', text: 'Hej' });
    vi.advanceTimersByTime(60_001);
    await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(sent).toHaveLength(2);
  });

  it('and INSIDE the window it does not — the pair is the test, not either half', async () => {
    vi.useFakeTimers();
    const { sms, sent } = client({ duplicates: { window: 60_000 } });
    await sms.send({ to: '+4522680880', text: 'Hej' });
    vi.advanceTimersByTime(59_000);
    await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(sent).toHaveLength(1);
  });

  it('A REFUSED SEND DOES NOT HOLD THE LOCK — a retry after a failure must work', async () => {
    // The gateway said no. Retrying is exactly what a caller should do, so the
    // lock steps aside. Without this the first bad send would block the fix.
    let attempt = 0;
    const { provider, sent } = spyProvider(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('spy: 422 bad sender');
      return { id: 'msg_ok' };
    });
    const sms = createSms({ provider, from: 'Moovyy', live: true });

    const first = await sms.send({ to: '+4522680880', text: 'Hej' });
    const second = await sms.send({ to: '+4522680880', text: 'Hej' });

    expect(first.outcome).toBe('refused');
    expect(second.outcome).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  it('AN UNKNOWN SEND DOES HOLD IT — F076.6 enforced, not merely documented', async () => {
    // A timed-out send may already have gone AND been billed. Here the lock is
    // what actually stops the retry, instead of a warning in an error string.
    const { provider, sent } = spyProvider(async () => {
      throw new SmsUnknownError('spy: no response within 15000ms');
    });
    const sms = createSms({ provider, from: 'Moovyy', live: true });

    const first = await sms.send({ to: '+4522680880', text: 'Hej' });
    const second = await sms.send({ to: '+4522680880', text: 'Hej' });

    expect(first.outcome).toBe('unknown');
    expect(second.outcome).toBe('skipped');
    expect(second.skippedReason).toBe('duplicate');
    expect(sent).toHaveLength(1);
  });
});

describe('AC#5 — idempotencyKey overrides the derived key in BOTH directions', () => {
  it('two IDENTICAL messages with different keys both go out', async () => {
    const { sms, sent } = client();
    await sms.send({ to: '+4522680880', text: 'Hej', idempotencyKey: 'order-1' });
    await sms.send({ to: '+4522680880', text: 'Hej', idempotencyKey: 'order-2' });
    expect(sent).toHaveLength(2);
  });

  it('two DIFFERENT messages with the same key collapse to one send', async () => {
    const { sms, sent } = client();
    await sms.send({ to: '+4522680880', text: 'Hej', idempotencyKey: 'job-77' });
    await sms.send({ to: '+4512345678', text: 'Noget helt andet', idempotencyKey: 'job-77' });
    expect(sent).toHaveLength(1);
  });

  it('the key REPLACES the derived one — a keyed send does not lock the unkeyed form', async () => {
    const { sms, sent } = client();
    await sms.send({ to: '+4522680880', text: 'Hej', idempotencyKey: 'order-1' });
    await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(sent).toHaveLength(2);
  });
});

describe('AC#6 — you are told what the lock actually guarantees', () => {
  it('the default is on, in-process, and says so', async () => {
    expect(createSms({ from: 'X', live: true }).duplicateGuard).toBe('process');
  });

  it('a store without setIfAbsent → "shared"', () => {
    const store: SmsEventStore = { get: () => null, set: () => {} };
    expect(createSms({ from: 'X', duplicates: { store } }).duplicateGuard).toBe('shared');
  });

  it('a store WITH setIfAbsent → "shared-atomic"', () => {
    const store: SmsEventStore = { get: () => null, set: () => {}, setIfAbsent: () => true };
    expect(createSms({ from: 'X', duplicates: { store } }).duplicateGuard).toBe('shared-atomic');
  });

  it('duplicates:false → "off", and the readback AGREES WITH BEHAVIOUR', async () => {
    // The readback is bound to what send() does, not to the config it came from.
    const { sms, sent } = client({ duplicates: false });
    expect(sms.duplicateGuard).toBe('off');
    await sms.send({ to: '+4522680880', text: 'Hej' });
    await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(sent).toHaveLength(2);
  });

  it('and the same check the other way: "process" really does block the second send', async () => {
    const { sms, sent } = client();
    expect(sms.duplicateGuard).toBe('process');
    await sms.send({ to: '+4522680880', text: 'Hej' });
    await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(sent).toHaveLength(1);
  });

  it('"process" means what it says — a second client does NOT share the lock', async () => {
    const a = client();
    const b = client();
    await a.sms.send({ to: '+4522680880', text: 'Hej' });
    await b.sms.send({ to: '+4522680880', text: 'Hej' });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1); // a second instance sends again. That is the limit.
  });

  it('YOUR store makes it shared — two clients on one store dedupe across both', async () => {
    const store = new MemorySmsEventStore();
    const a = client({ duplicates: { store } });
    const b = client({ duplicates: { store } });
    await a.sms.send({ to: '+4522680880', text: 'Hej' });
    await b.sms.send({ to: '+4522680880', text: 'Hej' });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
  });
});

describe('THE STORE NEVER HOLDS THE MESSAGE OR THE NUMBER', () => {
  it('the key is a hash — a phone number and an SMS body are personal data', async () => {
    // A key travels: to Redis, into logs, into a database dump. An SMS body
    // routinely carries a one-time code or an appointment time. So nothing
    // readable goes into one.
    const written: string[] = [];
    const store: SmsEventStore = {
      get: () => null,
      set: (k) => {
        written.push(k);
      },
    };
    const { provider } = spyProvider();
    await createSms({ provider, from: 'Moovyy', live: true, duplicates: { store } }).send({
      to: '+4522680880',
      text: 'Din kode er 1234',
    });

    expect(written.length).toBeGreaterThan(0);
    for (const key of written) {
      expect(key).not.toContain('22680880');
      expect(key).not.toContain('Din kode');
      expect(key).not.toContain('1234');
      expect(key).not.toContain('Moovyy');
      expect(key).toMatch(/^sms:lock:[0-9a-f]{64}$/);
    }
  });

  it('the hash still DISCRIMINATES — different messages get different keys', async () => {
    const guard = createDuplicateGuard({});
    const a = await guard.fingerprint({ from: 'X', to: '+4522680880', text: 'Hej' });
    const b = await guard.fingerprint({ from: 'X', to: '+4522680880', text: 'Hej!' });
    const c = await guard.fingerprint({ from: 'X', to: '+4512345678', text: 'Hej' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('and it is STABLE — the same message gives the same key every time', async () => {
    const guard = createDuplicateGuard({});
    const a = await guard.fingerprint({ from: 'X', to: '+4522680880', text: 'Hej' });
    const b = await guard.fingerprint({ from: 'X', to: '+4522680880', text: 'Hej' });
    expect(a).toBe(b);
  });
});

describe('the lock must never break a send', () => {
  it('a store that throws on write does not turn a delivered message into an error', async () => {
    // The SMS already went. Failing the caller here would make them retry a
    // message that was delivered — the exact thing this guard prevents.
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    const store: SmsEventStore = {
      get: () => null,
      set: () => {
        throw new Error('redis down');
      },
    };
    const { provider, sent } = spyProvider();
    const res = await createSms({ provider, from: 'Moovyy', live: true, duplicates: { store } }).send({
      to: '+4522680880',
      text: 'Hej',
    });
    expect(res.outcome).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('A STORE OUTAGE DEGRADES TO THE OLD BEHAVIOUR, LOUDLY — it does not block sending', async () => {
    // The consequence stated plainly: with the store down, BOTH identical sends
    // go out. That is exactly what this package did before the lock existed, and
    // it is the right failure direction — a guard that takes the SMS capability
    // down when Redis hiccups blocks the one-time codes people log in with.
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    const store: SmsEventStore = {
      get: () => {
        throw new Error('redis down');
      },
      set: () => {
        throw new Error('redis down');
      },
    };
    const { provider, sent } = spyProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: { store } });
    await sms.send({ to: '+4522680880', text: 'Hej' });
    await sms.send({ to: '+4522680880', text: 'Hej' });

    expect(sent).toHaveLength(2);
    const said = warn.mock.calls.flat().join(' ');
    expect(said).toContain('WITHOUT duplicate protection');
    // The discriminating half: it must not read as a successful suppression.
    expect(said).not.toContain('suppressed');
    warn.mockRestore();
  });

  it('A WRITE THAT FAILS *AFTER* THE MESSAGE WENT must not report it as refused', async () => {
    // Found by a mutation that SURVIVED: making settle() rethrow reddened
    // nothing, because the outage test above trips on claim() and never reaches
    // settle at all. This is the case that discriminates — the claim succeeds,
    // the SMS goes out, and only the bookkeeping write fails.
    //
    // Without settle's own catch, that throw is caught by send()'s try/catch and
    // becomes outcome:'refused' — a DELIVERED message reported as a failure, and
    // the caller retries it. The most expensive possible way to lose a write.
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    const store: SmsEventStore = {
      get: () => null,
      setIfAbsent: () => true, // the claim succeeds…
      set: () => {
        throw new Error('redis died mid-send'); // …and the record does not
      },
    };
    const { provider, sent } = spyProvider();
    const res = await createSms({ provider, from: 'Moovyy', live: true, duplicates: { store } }).send({
      to: '+4522680880',
      text: 'Hej',
    });

    expect(sent).toHaveLength(1); // it really did go
    expect(res.outcome).toBe('sent');
    expect(res.outcome).not.toBe('refused'); // the failure direction that costs money
    expect(res.id).toBe('msg_1');
    warn.mockRestore();
  });

  it('a store holding corrupt JSON is ignored, not fatal', async () => {
    const store: SmsEventStore = { get: () => '{not json', set: () => {} };
    const { provider, sent } = spyProvider();
    const res = await createSms({ provider, from: 'Moovyy', live: true, duplicates: { store } }).send({
      to: '+4522680880',
      text: 'Hej',
    });
    expect(res.outcome).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('the lock never fires on a send that was not going to happen anyway', async () => {
    // Dark mode reports 'not-allowlisted', not 'duplicate' — twice in a row.
    const { sms } = client({ live: false });
    const a = await sms.send({ to: '+4522680880', text: 'Hej' });
    const b = await sms.send({ to: '+4522680880', text: 'Hej' });
    expect(a.skippedReason).toBe('not-allowlisted');
    expect(b.skippedReason).toBe('not-allowlisted');
  });

  it('a bad number is refused before the lock is ever claimed', async () => {
    const store: SmsEventStore = {
      get: () => null,
      set: () => {
        throw new Error('the lock must not have been touched');
      },
    };
    const { provider } = spyProvider();
    const res = await createSms({ provider, from: 'Moovyy', live: true, duplicates: { store } }).send({
      to: '123',
      text: 'Hej',
    });
    expect(res.outcome).toBe('refused');
  });
});
