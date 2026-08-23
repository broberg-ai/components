// F076.11 — retry, but only what is safe to retry.
//
// The most important test in this file asserts that something does NOT happen:
// a send whose answer never arrived is tried ONCE. Retrying it double-sends,
// double-charges, and on a one-time code delivers two different codes of which
// only one works — which is why retry could not be built until F076.6 made an
// unknown distinguishable from a refusal.
//
// Every count here is of PROVIDER calls, never of returned objects. And the
// classifier is asserted on a BRAND, not on message text, because
// `err.message.includes('429')` agrees with any message containing those three
// characters — the exact mistake F076.6 refused to make.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSms,
  SmsRetryableError,
  SmsUnknownError,
  isRetryableSendError,
  parseRetryAfter,
  resolveRetry,
  gatewayRefusal,
  type SmsProvider,
} from '../src/index';

const NUMBER = '+4522680880';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A provider that counts attempts and can fail the first N of them. */
function flakyProvider(failures: unknown[]) {
  const attempts: number[] = [];
  const provider: SmsProvider = {
    name: 'flaky',
    async send() {
      attempts.push(attempts.length + 1);
      const err = failures[attempts.length - 1];
      if (err) throw err;
      return { id: `msg_${attempts.length}` };
    },
  };
  return { provider, attempts };
}

const client = (provider: SmsProvider, retry: unknown = { attempts: 2, delaysMs: [0, 0] }) =>
  createSms({ provider, from: 'Moovyy', live: true, duplicates: false, retry: retry as never });

describe('THE ONE THAT MATTERS — an unknown is NEVER retried', () => {
  it('a send whose answer never arrived is tried exactly ONCE', async () => {
    // It may already be on its way to a handset and already billed. A retry here
    // is the single most expensive thing this package could do.
    const { provider, attempts } = flakyProvider([new SmsUnknownError('flaky: no response within 15000ms')]);
    const res = await client(provider).send({ to: NUMBER, text: 'Din kode er 1234' });

    expect(attempts).toHaveLength(1);
    expect(res.outcome).toBe('unknown');
  });

  it('…even when retry is configured with many attempts', async () => {
    const { provider, attempts } = flakyProvider([
      new SmsUnknownError('a'),
      new SmsUnknownError('b'),
      new SmsUnknownError('c'),
    ]);
    await client(provider, { attempts: 10, delaysMs: [0] }).send({ to: NUMBER, text: 'Hej' });
    expect(attempts).toHaveLength(1);
  });
});

describe('a 429 or 5xx IS retried, and succeeds on a later attempt', () => {
  it.each([429, 500, 502, 503])('%i is retried and the send ends up `sent`', async (status) => {
    const { provider, attempts } = flakyProvider([gatewayRefusal(status, `gw ${status}`)]);
    const res = await client(provider).send({ to: NUMBER, text: 'Hej' });

    expect(attempts).toHaveLength(2); // one failure, one success
    expect(res.outcome).toBe('sent');
    expect(res.id).toBe('msg_2');
  });

  it('gives up after the configured attempts and reports the LAST error', async () => {
    const boom = [gatewayRefusal(503, 'gw 503 first'), gatewayRefusal(503, 'gw 503 second'), gatewayRefusal(503, 'gw 503 third')];
    const { provider, attempts } = flakyProvider(boom);
    const res = await client(provider, { attempts: 2, delaysMs: [0, 0] }).send({ to: NUMBER, text: 'Hej' });

    expect(attempts).toHaveLength(3); // the first try plus two retries
    expect(res.outcome).toBe('refused');
    expect(res.error).toContain('third');
  });
});

describe('a PERMANENT refusal is not retried — it fails the same way on attempt five', () => {
  it.each([400, 401, 403, 404, 422])('%i is tried exactly once', async (status) => {
    const { provider, attempts } = flakyProvider([gatewayRefusal(status, `gw ${status}`)]);
    const res = await client(provider).send({ to: NUMBER, text: 'Hej' });
    expect(attempts).toHaveLength(1);
    expect(res.outcome).toBe('refused');
  });

  it('a locally refused number never reaches the provider at all, retry or not', async () => {
    const { provider, attempts } = flakyProvider([]);
    const res = await client(provider).send({ to: '123', text: 'Hej' });
    expect(attempts).toHaveLength(0);
    expect(res.outcome).toBe('refused');
  });
});

describe('THE DECISION IS ON A BRAND, NEVER ON THE MESSAGE TEXT', () => {
  it('an ordinary Error whose text screams 429 is NOT retried', async () => {
    // If the classifier read the message, this would pass on a wrong
    // implementation. It is written to be able to fail.
    const { provider, attempts } = flakyProvider([new Error('gateway 429 Too Many Requests, please retry')]);
    await client(provider).send({ to: NUMBER, text: 'Hej' });
    expect(attempts).toHaveLength(1);
  });

  it('a BRANDED retryable error with a bland message IS retried', async () => {
    const { provider, attempts } = flakyProvider([new SmsRetryableError('fine')]);
    await client(provider).send({ to: NUMBER, text: 'Hej' });
    expect(attempts).toHaveLength(2);
  });

  it('a foreign copy of the class still reads as retryable — instanceof would not', () => {
    class ForeignCopy extends Error {
      readonly smsRetryable = true as const;
    }
    const err = new ForeignCopy('from another copy of this package');
    expect(err instanceof SmsRetryableError).toBe(false);
    expect(isRetryableSendError(err)).toBe(true);
  });

  it.each([
    ['a plain Error', new Error('429')],
    ['an SmsUnknownError', new SmsUnknownError('timeout')],
    ['a string', '429'],
    ['null', null],
    ['an object branded false', { smsRetryable: false }],
  ])('%s is not retryable', (_label, value) => {
    expect(isRetryableSendError(value)).toBe(false);
  });
});

describe('Retry-After is honoured, and a 0 falls back rather than hammering', () => {
  it.each([
    ['5 seconds', '5', 5000],
    ['a leading/trailing space', '  7 ', 7000],
  ])('%s → %ims', (_label, header, expected) => {
    expect(parseRetryAfter(header)).toBe(expected);
  });

  it.each([
    ['zero', '0'],
    ['empty', ''],
    ['nonsense', 'soon'],
    ['null', null],
    ['a date in the past', 'Sat, 01 Aug 2026 10:00:00 GMT'],
  ])('%s → undefined, so the backoff is used instead of retrying instantly', (_label, header) => {
    expect(parseRetryAfter(header as string | null, Date.parse('2026-08-23T12:00:00Z'))).toBeUndefined();
  });

  it('an HTTP DATE in the future is converted to a wait', () => {
    const now = Date.parse('2026-08-23T12:00:00Z');
    expect(parseRetryAfter('Sun, 23 Aug 2026 12:00:30 GMT', now)).toBe(30_000);
  });

  it('a 429 carrying Retry-After produces a branded error that knows the wait', () => {
    const err = gatewayRefusal(429, 'slow down', new Headers({ 'retry-after': '3' }));
    expect(isRetryableSendError(err)).toBe(true);
    expect((err as SmsRetryableError).retryAfterMs).toBe(3000);
  });

  it('THE GATEWAY’S WAIT IS ACTUALLY USED — measured on the clock, not just parsed', async () => {
    vi.useFakeTimers();
    const { provider, attempts } = flakyProvider([gatewayRefusal(429, 'slow down', new Headers({ 'retry-after': '3' }))]);
    const sending = client(provider, { attempts: 1, delaysMs: [10] }).send({ to: NUMBER, text: 'Hej' });

    await vi.advanceTimersByTimeAsync(10); // the BACKOFF would have been enough
    expect(attempts).toHaveLength(1); // …and it was not — the gateway asked for 3s

    await vi.advanceTimersByTimeAsync(3000);
    expect(attempts).toHaveLength(2);
    expect((await sending).outcome).toBe('sent');
  });

  it('an absurd Retry-After is CAPPED, so a request handler is not parked for ten minutes', async () => {
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    const { provider, attempts } = flakyProvider([
      gatewayRefusal(429, 'come back later', new Headers({ 'retry-after': '600' })),
    ]);
    const sending = client(provider, { attempts: 1, delaysMs: [0], maxRetryAfterMs: 1000 }).send({
      to: NUMBER,
      text: 'Hej',
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toHaveLength(2); // capped at 1s, not 600s
    await sending;
    expect(warn.mock.calls.flat().join(' ')).toContain('capping at');
  });
});

describe('the worst case is a NUMBER you can read at boot', () => {
  it('retryPolicy is null when retry is off — and off is the default', () => {
    const { provider } = flakyProvider([]);
    expect(createSms({ provider, from: 'X', live: true }).retryPolicy).toBeNull();
  });

  it.each([
    [{ attempts: 0 }, null],
    [undefined, null],
  ])('%o → %o', (cfg, expected) => {
    expect(resolveRetry(cfg as never)).toBe(expected);
  });

  it('`retry: true` takes the defaults and reports them', () => {
    const { provider } = flakyProvider([]);
    const policy = createSms({ provider, from: 'X', live: true, retry: true }).retryPolicy;
    expect(policy).toMatchObject({ attempts: 2, delaysMs: [500, 2000] });
  });

  it('worstCaseMs is a real number a caller can compare against their timeout', () => {
    const policy = resolveRetry({ attempts: 2, delaysMs: [500, 2000], maxRetryAfterMs: 1000 });
    // Each attempt can wait the LARGER of the backoff and the cap, because the
    // gateway can replace the backoff with its own Retry-After.
    expect(policy?.worstCaseMs).toBe(1000 + 2000);
  });

  it('a delays list shorter than the attempt count repeats its last value', () => {
    expect(resolveRetry({ attempts: 4, delaysMs: [100] })?.delaysMs).toEqual([100, 100, 100, 100]);
  });

  it('OFF BY DEFAULT means a 503 is not retried unless you asked', async () => {
    // The readback bound to behaviour, not to the config it came from.
    const { provider, attempts } = flakyProvider([gatewayRefusal(503, 'gw 503')]);
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: false });
    expect(sms.retryPolicy).toBeNull();
    await sms.send({ to: NUMBER, text: 'Hej' });
    expect(attempts).toHaveLength(1);
  });
});

describe('retry and the duplicate lock do not fight', () => {
  it('a retried send claims the lock ONCE and still sends', async () => {
    // The lock is claimed around all attempts, not per attempt — otherwise the
    // second attempt would be suppressed as a duplicate of the first.
    const { provider, attempts } = flakyProvider([gatewayRefusal(503, 'gw 503')]);
    const sms = createSms({
      provider,
      from: 'Moovyy',
      live: true,
      retry: { attempts: 2, delaysMs: [0, 0] },
    });
    const res = await sms.send({ to: NUMBER, text: 'Hej' });
    expect(attempts).toHaveLength(2);
    expect(res.outcome).toBe('sent');
  });

  it('and a genuine duplicate is still blocked afterwards', async () => {
    const { provider, attempts } = flakyProvider([gatewayRefusal(503, 'gw 503')]);
    const sms = createSms({ provider, from: 'Moovyy', live: true, retry: { attempts: 2, delaysMs: [0, 0] } });
    await sms.send({ to: NUMBER, text: 'Hej' });
    const second = await sms.send({ to: NUMBER, text: 'Hej' });
    expect(attempts).toHaveLength(2); // no third call
    expect(second.skippedReason).toBe('duplicate');
  });
});
