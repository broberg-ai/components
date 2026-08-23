// F076.4 — the sms.dk adapter.
//
// The load-bearing tests here are the ones about a SUCCESSFUL HTTP RESPONSE that
// means the message went nowhere. sms.dk answers 207 Multi-Status for a partial
// send, and `res.ok` is true for a 207 — so the obvious success test reports a
// message that was rejected as one that was sent.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSms, smsdk } from '../src/index';

type Capture = { url: string; init: any; body: Record<string, unknown> };

function stubFetch(status: number, body: string) {
  const calls: Capture[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init, body: JSON.parse(init.body) });
      return new Response(body, { status });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const client = (extra: Record<string, unknown> = {}, from = 'SMSDKDemo', live = true) =>
  createSms({ provider: smsdk({ apiKey: 'k', ...extra }), from, live });

// Their four documented shapes, verbatim from the Postman collection.
const OK_200 = JSON.stringify({
  status: 'success',
  messageCode: 5000,
  result: {
    totalCreditSum: 1.0,
    messageSize: 1,
    batchId: 'e9fd008b-7e81-0659-e4e3-ae5317b43ef2',
    report: { accepted: [{ receiver: 4522680880, country: 'Denmark', creditCost: 1.0 }], rejected: [] },
  },
});
const MIXED_207 = JSON.stringify({
  status: 'mixed',
  messageCode: 3000,
  result: {
    totalCreditSum: 0,
    messageSize: 1,
    batchId: 'e9fd008b-7e81-0659-e4e3-ae5317b43ef2',
    report: {
      accepted: [],
      rejected: [{ receiver: 4522680880, messageCode: 1015, message: 'Country code and phone number do not match.' }],
    },
  },
});
const ERR_SENDER_409 = JSON.stringify({
  status: 'error',
  messageCode: 1017,
  message: 'Parameter "senderName" is not a approved sender name.',
});
const ERR_ALL_REJECTED_409 = JSON.stringify({
  status: 'error',
  messageCode: 1059,
  message: 'See specific error in returned rejected array.',
  errorResult: {
    report: {
      accepted: [],
      rejected: [{ receiver: 4113344554, messageCode: 1015, message: 'Country code and phone number do not match.' }],
    },
  },
});

describe('the request matches their documented contract', () => {
  it('POSTs to /v1/sms/send with a Bearer token', async () => {
    const calls = stubFetch(200, OK_200);
    await client().send({ to: '+4522680880', text: 'Hej' });
    expect(calls[0].url).toBe('https://api.sms.dk/v1/sms/send');
    expect(calls[0].init.headers.Authorization).toBe('Bearer k');
    expect(calls[0].init.method).toBe('POST');
  });

  it('receiver is a bare integer, senderName carries the from', async () => {
    const calls = stubFetch(200, OK_200);
    await client().send({ to: '+45 22 68 08 80', text: 'Hej' });
    expect(calls[0].body).toMatchObject({ receiver: 4522680880, senderName: 'SMSDKDemo', message: 'Hej' });
    expect(typeof calls[0].body.receiver).toBe('number');
  });

  it('DECLARES the encoding instead of letting them guess — we already computed it to price the message', async () => {
    const gsm = stubFetch(200, OK_200);
    await client().send({ to: '+4522680880', text: 'Blåbærgrød på Ærø' });
    expect(gsm[0].body.format).toBe('gsm'); // Danish letters are GSM-7
    vi.unstubAllGlobals();

    const uni = stubFetch(200, OK_200);
    await client().send({ to: '+4522680880', text: 'Hej \u{1F600}' });
    expect(uni[0].body.format).toBe('unicode'); // their word for our ucs-2
  });

  it('optional fields are omitted unless configured', async () => {
    const bare = stubFetch(200, OK_200);
    await client().send({ to: '+4522680880', text: 'Hej' });
    expect(Object.keys(bare[0].body).sort()).toEqual(['encoding', 'format', 'message', 'receiver', 'senderName']);
    vi.unstubAllGlobals();

    const full = stubFetch(200, OK_200);
    await client({ dlrUrl: 'https://x.dk/dlr', userReference: 'ref-1' }).send({ to: '+4522680880', text: 'Hej' });
    expect(full[0].body).toMatchObject({ dlrUrl: 'https://x.dk/dlr', userReference: 'ref-1' });
  });
});

describe('A SUCCESSFUL HTTP RESPONSE THAT MEANS NOTHING WAS SENT', () => {
  it('200 with an accepted recipient → ok, carrying the batchId', async () => {
    stubFetch(200, OK_200);
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(true);
    expect(res.id).toBe('e9fd008b-7e81-0659-e4e3-ae5317b43ef2');
  });

  it('THE TRAP: 207 Multi-Status with our recipient REJECTED must NOT report success', async () => {
    // res.ok is TRUE for 207. An adapter testing res.ok — the obvious check, and
    // the right one for GatewayAPI — reports this message as sent. It was not.
    stubFetch(207, MIXED_207);
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('REJECTED this recipient');
    expect(res.error).toContain('Country code and phone number do not match');
    expect(res.error).toContain('1015'); // their per-recipient code, for support
  });

  it('the rejection reason comes from the per-recipient entry, not the top level', async () => {
    // Their top-level message is literally "See specific error in returned
    // rejected array" — a string that tells you to go and read somewhere else.
    stubFetch(409, ERR_ALL_REJECTED_409);
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Country code and phone number do not match');
    expect(res.error).not.toContain('See specific error in returned');
  });

  it('409 on an unapproved sender name names the fix — it is a web-interface step, not a code bug', async () => {
    stubFetch(409, ERR_SENDER_409);
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not a approved sender name');
    expect(res.error).toContain('approved in the sms.dk web interface');
  });

  it('an empty accepted array is a failure even when nothing says "rejected"', async () => {
    // Defence against a shape we have not seen: accepted:[] with no rejections
    // and no error. Nothing went out, so it must not read as ok.
    stubFetch(200, JSON.stringify({ status: 'success', messageCode: 5000, result: { report: { accepted: [], rejected: [] } } }));
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
  });
});

describe('failures that must not look like successes', () => {
  it('an HTML body points at the path, because their 404 serves a page', async () => {
    stubFetch(404, '<!doctype html><html><body>Not found</body></html>');
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not JSON');
    expect(res.error).toContain('wrong path');
  });

  it('a timeout is NOT reported as "did not send"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted'); e.name = 'TimeoutError'; throw e;
    }));
    const res = await client({ timeoutMs: 5 }).send({ to: '+4522680880', text: 'Hej' });
    expect(res.error).toContain('MAY OR MAY NOT HAVE BEEN SENT');
  });

  it('the shared sender-name rule applies here too — 12 characters is refused', async () => {
    const calls = stubFetch(200, OK_200);
    const res = await client({}, 'MoovyyRides!').send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('smsdk: sender');
    expect(res.error).toContain('3–11');
    expect(calls).toHaveLength(0);
  });

  it('an empty apiKey throws at construction', () => {
    expect(() => smsdk({ apiKey: '' })).toThrow(/no-key/);
  });
});

describe('the same core contract as every other provider', () => {
  it('ship-dark: a non-live client never reaches the network but still reports the cost', async () => {
    const calls = stubFetch(200, OK_200);
    const res = await client({}, 'SMSDKDemo', false).send({ to: '+4522680880', text: 'a'.repeat(200) });
    expect(calls).toHaveLength(0);
    expect(res.skipped).toBe(true);
    expect(res.estimate?.segments).toBe(2);
  });

  it('mode and provider read back', () => {
    const c = createSms({ provider: smsdk({ apiKey: 'k' }), from: 'SMSDKDemo' });
    expect(c.provider).toBe('smsdk');
    expect(c.mode).toBe('allowlist-only');
  });
});
