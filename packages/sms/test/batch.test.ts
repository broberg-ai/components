// F076.12 — sending to many people at once.
//
// EVERY COUNT IN THIS FILE IS OF PROVIDER CALLS, not of returned objects. That
// is the AC and it is not pedantry: an implementation that aborts after the
// first failure can still return an array of the right length, full of results
// it never attempted. The array length agrees with a broken implementation; the
// call count does not.
//
// And the ordering test uses GATED promises rather than delays, so it can
// actually fail: the recipients finish in reverse, and an implementation that
// collects results as they arrive scrambles them silently — every id is real,
// just against the wrong number.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSms,
  estimateMany,
  estimate,
  createConsentRegistry,
  MemorySmsConsentStore,
  SmsUnknownError,
  gatewayRefusal,
  type BatchOutcome,
  type SmsProvider,
  type SmsSendInput,
} from '../src/index';

const N = (i: number) => `+45226808${String(i).padStart(2, '0')}`;
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

/** Fan-out provider: one call per recipient, id derived from the number. */
function singleProvider(fail: (to: string) => unknown = () => null) {
  const calls: string[] = [];
  const provider: SmsProvider = {
    name: 'single',
    async send({ to }) {
      calls.push(to);
      const boom = fail(to);
      if (boom) throw boom;
      return { id: `id${to}` };
    },
  };
  return { provider, calls };
}

/** Batch provider with a declared limit. Records the SHAPE of every call. */
function batchProvider(batchLimit = 250, answer?: (m: SmsSendInput, i: number) => BatchOutcome) {
  const batches: SmsSendInput[][] = [];
  const singles: string[] = [];
  const provider: SmsProvider = {
    name: 'bulk',
    batchLimit,
    async send({ to }) {
      singles.push(to);
      return { id: `single:${to}` };
    },
    async sendMany(messages) {
      batches.push(messages);
      return messages.map((m, i) => answer?.(m, i) ?? ({ ok: true, id: `id${m.to}` } as BatchOutcome));
    },
  };
  return { provider, batches, singles };
}

const client = (provider: SmsProvider, extra: Record<string, unknown> = {}) =>
  createSms({ provider, from: 'Moovyy', live: true, duplicates: false, ...extra });

describe('AC#1 — ONE RESULT PER RECIPIENT, in the order given', () => {
  it('five recipients produce five results, each matching ITS OWN number', async () => {
    const { provider, calls } = singleProvider();
    const res = await client(provider).sendMany([0, 1, 2, 3, 4].map((i) => ({ to: N(i), text: `nr ${i}` })));

    expect(res).toHaveLength(5);
    res.forEach((r, i) => expect(r.id).toBe(`id${N(i)}`));
    expect(calls).toHaveLength(5);
  });

  it('THE ORDER SURVIVES OUT-OF-ORDER COMPLETION — the discriminating case', async () => {
    // The five finish in REVERSE. An implementation that pushes results as they
    // arrive returns five real ids attributed to the wrong five people, and
    // every one of them looks valid.
    const gates: Array<() => void> = [];
    const provider: SmsProvider = {
      name: 'gated',
      send: ({ to }) => new Promise((resolve) => gates.push(() => resolve({ id: `id${to}` }))),
    };

    const running = client(provider).sendMany([0, 1, 2, 3, 4].map((i) => ({ to: N(i), text: 'x' })));
    await tick();
    expect(gates).toHaveLength(5); // all five in flight at the default concurrency
    for (const open of gates.reverse()) open();

    const res = await running;
    res.forEach((r, i) => expect(r.id).toBe(`id${N(i)}`));
  });

  it('a mix of sent, skipped and refused still fills EVERY slot', async () => {
    const { provider } = singleProvider();
    const res = await client(provider, { allowlist: [] }).sendMany([
      { to: N(1), text: 'ok' },
      { to: 'ikke-et-nummer', text: 'refused locally' },
      { to: N(2), text: 'ok' },
    ]);

    expect(res).toHaveLength(3);
    expect(res.every((r) => r !== undefined)).toBe(true);
    expect(res.map((r) => r.outcome)).toEqual(['sent', 'refused', 'sent']);
  });

  it('an empty batch is an empty array and costs nothing', async () => {
    const { provider, calls } = singleProvider();
    expect(await client(provider).sendMany([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('AC#2 — ONE FAILURE DOES NOT ABORT THE REST', () => {
  it('a bad recipient at position 3 of 5: THE PROVIDER IS STILL CALLED 5 TIMES', async () => {
    // Counted on provider calls, not on the returned length — a stop-on-first
    // implementation can still return five results it never attempted.
    const { provider, calls } = singleProvider((to) => (to === N(2) ? new Error('gateway said no') : null));
    const res = await client(provider).sendMany([0, 1, 2, 3, 4].map((i) => ({ to: N(i), text: 'x' })));

    expect(calls).toHaveLength(5);
    expect(res.map((r) => r.outcome)).toEqual(['sent', 'sent', 'refused', 'sent', 'sent']);
    expect(res[2].error).toContain('gateway said no');
  });

  it('the LAST recipient failing does not hide the ones before it', async () => {
    const { provider, calls } = singleProvider((to) => (to === N(4) ? new Error('nope') : null));
    const res = await client(provider).sendMany([0, 1, 2, 3, 4].map((i) => ({ to: N(i), text: 'x' })));
    expect(calls).toHaveLength(5);
    expect(res.filter((r) => r.outcome === 'sent')).toHaveLength(4);
  });

  it('on the BATCH path, one refused item leaves the other four sent', async () => {
    const { provider, batches } = batchProvider(250, (m) =>
      m.to === N(2) ? { ok: false, error: new Error('bad number') } : { ok: true, id: `id${m.to}` },
    );
    const res = await client(provider).sendMany([0, 1, 2, 3, 4].map((i) => ({ to: N(i), text: 'x' })));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(5); // all five were SUBMITTED
    expect(res.map((r) => r.outcome)).toEqual(['sent', 'sent', 'refused', 'sent', 'sent']);
  });
});

describe('AC#3 — the per-recipient gates all still run, per recipient', () => {
  const WAY_OUT = 'Afmeld: sms.broberg.dk/a/x7k2';

  it('CONSENT: one opted-out recipient is skipped and NEVER reaches the gateway', async () => {
    const store = new MemorySmsConsentStore();
    const consent = createConsentRegistry({ store, optOutText: WAY_OUT });
    for (const i of [0, 1, 2]) await consent.record({ phone: N(i), basis: 'Tilmeldt' });
    await consent.optOut(N(1));

    const { provider, calls } = singleProvider();
    const res = await client(provider, { consent }).sendMany(
      [0, 1, 2].map((i) => ({ to: N(i), text: `Tilbud! ${WAY_OUT}`, category: 'marketing' as const })),
    );

    // Two calls, not three — the gate ran per recipient, not once for the batch.
    expect(calls).toEqual([N(0), N(2)]);
    expect(res.map((r) => r.skippedReason)).toEqual([undefined, 'opted-out', undefined]);
  });

  it('a marketing batch with NO way out is refused for everyone, and nothing is billed', async () => {
    const consent = createConsentRegistry({ store: new MemorySmsConsentStore(), optOutText: WAY_OUT });
    const { provider, calls } = singleProvider();
    const res = await client(provider, { consent }).sendMany(
      [0, 1, 2].map((i) => ({ to: N(i), text: 'Tilbud!', category: 'marketing' as const })),
    );
    expect(calls).toHaveLength(0);
    expect(res.every((r) => r.outcome === 'refused')).toBe(true);
  });

  it('THE DUPLICATE LOCK CATCHES A REPEAT INSIDE ONE BATCH — the bulk-import case', async () => {
    // The same number twice in one uploaded list. Without a sequential gate pass
    // both claim the lock and both are billed.
    const { provider, calls } = singleProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true });
    const res = await sms.sendMany([
      { to: N(1), text: 'Samme besked' },
      { to: N(2), text: 'Anden besked' },
      { to: N(1), text: 'Samme besked' },
    ]);

    expect(calls).toEqual([N(1), N(2)]); // two, not three
    expect(res[2].skippedReason).toBe('duplicate');

    // AND NO id ON THIS ONE — measured, not an oversight. The first copy is
    // still IN FLIGHT when the second is gated, because every gate runs before
    // any dispatch, which is exactly what makes the in-batch catch possible.
    // The id is available only for a duplicate of an EARLIER, finished send.
    expect(res[2].id).toBeUndefined();
  });

  it('…AND ON A SHARED STORE WITH NO ATOMIC CLAIM, which is where the race is real', async () => {
    // The discriminating case, and it was missing: the in-memory store claims
    // atomically, so the test above stays green even if the gates run in
    // PARALLEL. A shared store with only get/set — the ordinary Redis/SQL
    // wrapper, guard mode 'shared' — does not. Two parallel claims both read
    // "not held", both write "in flight", and both messages are billed.
    const map = new Map<string, string>();
    const store = {
      async get(k: string) {
        await tick(); // a real store yields here; that yield IS the race
        return map.get(k) ?? null;
      },
      async set(k: string, v: string) {
        await tick();
        map.set(k, v);
      },
    };

    const { provider, calls } = singleProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: { store } });
    expect(sms.duplicateGuard).toBe('shared'); // NOT shared-atomic — that is the point

    const res = await sms.sendMany([
      { to: N(1), text: 'Samme besked' },
      { to: N(2), text: 'Anden besked' },
      { to: N(1), text: 'Samme besked' },
    ]);

    expect(calls).toEqual([N(1), N(2)]); // two, not three
    expect(res[2].skippedReason).toBe('duplicate');
  });

  it('a duplicate of an EARLIER, finished send DOES carry that message’s id', async () => {
    const { provider, calls } = singleProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true });
    const first = await sms.send({ to: N(1), text: 'Samme besked' });
    const res = await sms.sendMany([{ to: N(1), text: 'Samme besked' }]);

    expect(calls).toHaveLength(1);
    expect(res[0].skippedReason).toBe('duplicate');
    expect(res[0].id).toBe(first.id); // the handle of the one that DID go
  });

  it('the ALLOWLIST is applied per recipient, not to the batch', async () => {
    const { provider, calls } = singleProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: false, allowlist: [N(1)], duplicates: false });
    const res = await sms.sendMany([0, 1, 2].map((i) => ({ to: N(i), text: 'x' })));
    expect(calls).toEqual([N(1)]);
    expect(res.map((r) => r.skippedReason)).toEqual(['not-allowlisted', undefined, 'not-allowlisted']);
  });

  it('every result carries ITS OWN price, not the batch average', async () => {
    const { provider } = singleProvider();
    const res = await client(provider).sendMany([
      { to: N(1), text: 'kort' },
      { to: N(2), text: 'a'.repeat(200) },
      { to: N(3), text: 'pris på “dette” koster ekstra' },
    ]);
    expect(res[0].estimate?.segments).toBe(1);
    expect(res[1].estimate?.segments).toBe(2);
    expect(res[2].estimate?.encoding).toBe('ucs-2');
  });
});

describe('AC#4 — CHUNKING against the gateway’s own limit', () => {
  it('501 recipients against a limit of 250 is 3 calls of 250 / 250 / 1', async () => {
    const { provider, batches } = batchProvider(250);
    const res = await client(provider).sendMany(
      Array.from({ length: 501 }, (_, i) => ({ to: `+452200${String(i).padStart(4, '0')}`, text: 'x' })),
    );
    expect(batches.map((b) => b.length)).toEqual([250, 250, 1]);
    expect(res).toHaveLength(501);
    expect(res.every((r) => r.outcome === 'sent')).toBe(true);
  });

  it('1,001 RECIPIENTS AGAINST A LIMIT OF 1,000 IS SPLIT, NEVER REJECTED', async () => {
    // The caller asked to reach 1,001 people. The transport's ceiling is this
    // package's problem, not theirs.
    const { provider, batches } = batchProvider(1000);
    const res = await client(provider).sendMany(
      Array.from({ length: 1001 }, (_, i) => ({ to: `+452200${String(i).padStart(4, '0')}`, text: 'x' })),
    );
    expect(batches.map((b) => b.length)).toEqual([1000, 1]);
    expect(res).toHaveLength(1001);
    expect(res.filter((r) => r.outcome === 'sent')).toHaveLength(1001);
  });

  it('a batch EXACTLY at the limit is one call, not two', async () => {
    const { provider, batches } = batchProvider(250);
    await client(provider).sendMany(
      Array.from({ length: 250 }, (_, i) => ({ to: `+452200${String(i).padStart(4, '0')}`, text: 'x' })),
    );
    expect(batches.map((b) => b.length)).toEqual([250]);
  });

  it('chunkSize lowers the limit when the caller knows better', async () => {
    const { provider, batches } = batchProvider(1000);
    await client(provider).sendMany(
      Array.from({ length: 10 }, (_, i) => ({ to: N(i), text: 'x' })),
      { chunkSize: 4 },
    );
    expect(batches.map((b) => b.length)).toEqual([4, 4, 2]);
  });

  it('a provider with NO sendMany fans out — one call per recipient, and it says so', async () => {
    const { provider, calls } = singleProvider();
    const sms = client(provider);
    expect(sms.batch).toMatchObject({ mode: 'fan-out', size: 1 });
    await sms.sendMany(Array.from({ length: 7 }, (_, i) => ({ to: N(i), text: 'x' })));
    expect(calls).toHaveLength(7);
  });

  it('a batch-capable provider never falls back to the single endpoint', async () => {
    const { provider, batches, singles } = batchProvider(250);
    await client(provider).sendMany([0, 1, 2].map((i) => ({ to: N(i), text: 'x' })));
    expect(batches).toHaveLength(1);
    expect(singles).toHaveLength(0);
  });

  it('the plan is readable at boot, before anything is sent', async () => {
    const { provider } = batchProvider(250);
    expect(client(provider).batch).toEqual({ mode: 'gateway-batch', size: 250, concurrency: 5 });
  });
});

describe('AC#5 — the whole batch is priced BEFORE it is sent', () => {
  const texts = ['kort', 'a'.repeat(200), 'med “citat”', 'endnu en'];

  it('the batch total is EXACTLY the sum of the individual estimates', async () => {
    const total = estimateMany(texts);
    const sum = texts.reduce((acc, t) => acc + estimate(t).segments, 0);
    expect(total.segments).toBe(sum);
    expect(total.units).toBe(texts.reduce((acc, t) => acc + estimate(t).units, 0));
    expect(total.messages).toBe(4);
  });

  it('it counts the encodings, which is where the expensive surprise hides', async () => {
    const total = estimateMany(texts);
    expect(total.encodings).toEqual({ 'gsm-7': 3, 'ucs-2': 1 });
  });

  it('a warning names the INDEX of the message that caused it', async () => {
    const total = estimateMany(texts);
    expect(total.warnings.map((w) => w.index)).toContain(2);
    expect(total.warnings.find((w) => w.index === 2)?.warning).toContain('UCS-2');
  });

  it('it takes the same array you would pass to sendMany', async () => {
    const messages = texts.map((text, i) => ({ to: N(i), text }));
    expect(estimateMany(messages).segments).toBe(estimateMany(texts).segments);
  });

  it('the client exposes it, and the prediction matches what the send reports', async () => {
    const { provider } = singleProvider();
    const sms = client(provider);
    const messages = texts.map((text, i) => ({ to: N(i), text }));
    const predicted = sms.estimateMany(messages);
    const res = await sms.sendMany(messages);
    expect(res.reduce((acc, r) => acc + (r.estimate?.segments ?? 0), 0)).toBe(predicted.segments);
  });

  it('an empty batch costs nothing rather than throwing', () => {
    expect(estimateMany([])).toEqual({
      messages: 0,
      segments: 0,
      units: 0,
      encodings: { 'gsm-7': 0, 'ucs-2': 0 },
      warnings: [],
    });
  });
});

describe('AC#6 — a batch that fails at the HTTP level says WHO is unknown', () => {
  it('a timed-out chunk is `unknown` for everyone in it — and the OTHER chunk still sends', async () => {
    const batches: SmsSendInput[][] = [];
    const provider: SmsProvider = {
      name: 'flaky-bulk',
      async send() {
        return {};
      },
      async sendMany(messages) {
        batches.push(messages);
        if (batches.length === 1) throw new SmsUnknownError('flaky-bulk: no response within 15000ms');
        return messages.map((m) => ({ ok: true, id: `id${m.to}` }) as BatchOutcome);
      },
    };

    const res = await client(provider).sendMany(
      Array.from({ length: 4 }, (_, i) => ({ to: N(i), text: 'x' })),
      { chunkSize: 2, concurrency: 1 },
    );

    expect(res.map((r) => r.outcome)).toEqual(['unknown', 'unknown', 'sent', 'sent']);
    expect(res[0].error).toContain('no response');
  });

  it('a chunk REFUSED with a 4xx is `refused`, not `unknown` — they told us no', async () => {
    const provider: SmsProvider = {
      name: 'refuser',
      async send() {
        return {};
      },
      async sendMany() {
        throw gatewayRefusal(401, 'refuser 401 bad key');
      },
    };
    const res = await client(provider).sendMany([0, 1].map((i) => ({ to: N(i), text: 'x' })));
    expect(res.map((r) => r.outcome)).toEqual(['refused', 'refused']);
  });

  it('FEWER ANSWERS THAN RECIPIENTS: the missing ones are `unknown`, never dropped', async () => {
    // The dangerous shape. Silently truncating leaves the caller with no record
    // that those people exist, and they may well have been sent.
    const provider: SmsProvider = {
      name: 'short',
      async send() {
        return {};
      },
      async sendMany(messages) {
        return messages.slice(0, 1).map((m) => ({ ok: true, id: `id${m.to}` }) as BatchOutcome);
      },
    };
    const res = await client(provider).sendMany([0, 1, 2].map((i) => ({ to: N(i), text: 'x' })));

    expect(res).toHaveLength(3);
    expect(res.map((r) => r.outcome)).toEqual(['sent', 'unknown', 'unknown']);
    expect(res[1].error).toContain('1 result(s) for 3 recipient(s)');
  });

  it('AN UNKNOWN IS NEVER RETRIED, in bulk exactly as alone', async () => {
    let attempts = 0;
    const provider: SmsProvider = {
      name: 'timeout-bulk',
      async send() {
        return {};
      },
      async sendMany() {
        attempts += 1;
        throw new SmsUnknownError('timeout-bulk: no response within 15000ms');
      },
    };
    const res = await createSms({
      provider,
      from: 'Moovyy',
      live: true,
      duplicates: false,
      retry: { attempts: 5, delaysMs: [0] },
    }).sendMany([0, 1].map((i) => ({ to: N(i), text: 'x' })));

    expect(attempts).toBe(1); // 1,000 recipients would have been re-sent
    expect(res.every((r) => r.outcome === 'unknown')).toBe(true);
  });

  it('a retryable 5xx IS retried for the chunk as a whole', async () => {
    let attempts = 0;
    const provider: SmsProvider = {
      name: 'wobbly',
      async send() {
        return {};
      },
      async sendMany(messages) {
        attempts += 1;
        if (attempts === 1) throw gatewayRefusal(503, 'wobbly 503');
        return messages.map((m) => ({ ok: true, id: `id${m.to}` }) as BatchOutcome);
      },
    };
    const res = await createSms({
      provider,
      from: 'Moovyy',
      live: true,
      duplicates: false,
      retry: { attempts: 2, delaysMs: [0, 0] },
    }).sendMany([0, 1].map((i) => ({ to: N(i), text: 'x' })));

    expect(attempts).toBe(2);
    expect(res.every((r) => r.outcome === 'sent')).toBe(true);
  });
});

describe('the duplicate lock settles correctly for a whole batch', () => {
  it('an UNKNOWN holds the lock, so a re-run does not re-send it', async () => {
    const provider: SmsProvider = {
      name: 'unknowable',
      async send() {
        throw new SmsUnknownError('unknowable: no response within 15000ms');
      },
    };
    const sms = createSms({ provider, from: 'Moovyy', live: true });
    const first = await sms.sendMany([{ to: N(1), text: 'Din kode er 1234' }]);
    expect(first[0].outcome).toBe('unknown');

    const second = await sms.sendMany([{ to: N(1), text: 'Din kode er 1234' }]);
    expect(second[0].skippedReason).toBe('duplicate');
  });

  it('a REFUSAL voids it, so a re-run is allowed to try again', async () => {
    let calls = 0;
    const provider: SmsProvider = {
      name: 'refuser',
      async send() {
        calls += 1;
        throw new Error('refuser: temporary no');
      },
    };
    const sms = createSms({ provider, from: 'Moovyy', live: true });
    await sms.sendMany([{ to: N(1), text: 'Hej' }]);
    const second = await sms.sendMany([{ to: N(1), text: 'Hej' }]);

    expect(calls).toBe(2);
    expect(second[0].skippedReason).toBeUndefined();
  });
});

describe('concurrency is bounded, so a big send does not open 5,000 sockets', () => {
  it('never more than `concurrency` calls are in flight at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider: SmsProvider = {
      name: 'watcher',
      async send() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        return {};
      },
    };
    await client(provider).sendMany(
      Array.from({ length: 20 }, (_, i) => ({ to: `+452200${String(i).padStart(4, '0')}`, text: 'x' })),
      { concurrency: 3 },
    );
    expect(peak).toBe(3);
  });
});
