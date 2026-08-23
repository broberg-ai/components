// F076.3 — the inMobile adapter.
//
// Third gateway, third hiding place for a failed send. inMobile answers 200 OK
// with a real messageId and buries "that number is not valid" in a boolean two
// levels down, where nothing at the top level disagrees with it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSms, inmobile } from '../src/index';

type Capture = { url: string; init: any; body: any };
function stubFetch(status: number, body: string) {
  const calls: Capture[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(body, { status });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const client = (extra: Record<string, unknown> = {}, from = 'Broberg', live = true) =>
  createSms({ provider: inmobile({ apiKey: 'k', ...extra }), from, live });

const ok = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    results: [{
      messageId: '8fe266b2-56e9-4b5f-938f-cc5e22530721',
      smsCount: 1,
      encoding: 'gsm7',
      from: 'Broberg',
      numberDetails: { countryCode: '45', phoneNumber: '22680880', msisdn: '4522680880', rawMsisdn: '4522680880', isValidMsisdn: true },
      ...over,
    }],
  });

describe('the request matches their v4 spec', () => {
  it('POSTs a messages ARRAY to /v4/sms/outgoing', async () => {
    const c = stubFetch(200, ok());
    await client().send({ to: '+4522680880', text: 'Hej' });
    expect(c[0].url).toBe('https://api.inmobile.com/v4/sms/outgoing');
    expect(Array.isArray(c[0].body.messages)).toBe(true);
    expect(c[0].body.messages).toHaveLength(1);
  });

  it('BASIC auth with the key as the PASSWORD — the username is ignored by them', async () => {
    const c = stubFetch(200, ok());
    await client().send({ to: '+4522680880', text: 'Hej' });
    const header = c[0].init.headers.Authorization as string;
    expect(header.startsWith('Basic ')).toBe(true);
    expect(atob(header.slice(6))).toBe('api:k'); // key in the password position
  });

  it('to is a STRING msisdn with the country code and no plus', async () => {
    const c = stubFetch(200, ok());
    await client().send({ to: '+45 22 68 08 80', text: 'Hej' });
    expect(c[0].body.messages[0].to).toBe('4522680880');
    expect(typeof c[0].body.messages[0].to).toBe('string');
  });

  it('declares the encoding rather than using their "auto"', async () => {
    const g = stubFetch(200, ok());
    await client().send({ to: '+4522680880', text: 'Blåbærgrød på Ærø' });
    expect(g[0].body.messages[0].encoding).toBe('gsm7');
    vi.unstubAllGlobals();
    const u = stubFetch(200, ok({ encoding: 'ucs2' }));
    await client().send({ to: '+4522680880', text: 'Hej \u{1F600}' });
    expect(u[0].body.messages[0].encoding).toBe('ucs2');
  });

  it('optional fields are omitted unless configured', async () => {
    const bare = stubFetch(200, ok());
    await client().send({ to: '+4522680880', text: 'Hej' });
    expect(Object.keys(bare[0].body.messages[0]).sort()).toEqual(['countryHint', 'encoding', 'from', 'text', 'to']);
    vi.unstubAllGlobals();
    const full = stubFetch(200, ok());
    await client({ statusCallbackUrl: 'https://x.dk/dlr', respectBlacklist: true, validityPeriodInSeconds: 3600 })
      .send({ to: '+4522680880', text: 'Hej' });
    expect(full[0].body.messages[0]).toMatchObject({
      statusCallbackUrl: 'https://x.dk/dlr', respectBlacklist: true, validityPeriodInSeconds: 3600,
    });
  });
});

describe('A 200 WITH A MESSAGE ID THAT WILL NEVER ARRIVE', () => {
  it('happy path returns the messageId', async () => {
    stubFetch(200, ok());
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(true);
    expect(res.id).toBe('8fe266b2-56e9-4b5f-938f-cc5e22530721');
  });

  it('THE TRAP: isValidMsisdn:false on a 200 must NOT report success', async () => {
    // Everything else in this response is happy: HTTP 200, a real messageId, a
    // smsCount. The only dissent is a boolean two levels down.
    stubFetch(200, ok({ numberDetails: { rawMsisdn: '4500000000', isValidMsisdn: false } }));
    const res = await client().send({ to: '+4500000000', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('isValidMsisdn=false');
    expect(res.error).toContain('NOT a message that will arrive');
  });

  it('isValidMsisdn:true is not confused with the false case', async () => {
    // Negative control: without it, "always fail on numberDetails" would satisfy
    // the test above.
    stubFetch(200, ok());
    expect((await client().send({ to: '+4522680880', text: 'Hej' })).ok).toBe(true);
  });

  it('a 200 with no messageId fails rather than returning a blank id', async () => {
    stubFetch(200, JSON.stringify({ results: [{ smsCount: 1, numberDetails: { isValidMsisdn: true } }] }));
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no messageId');
  });

  it('an empty results array fails', async () => {
    stubFetch(200, JSON.stringify({ results: [] }));
    expect((await client().send({ to: '+4522680880', text: 'Hej' })).ok).toBe(false);
  });
});

describe('their charge count is checked against ours', () => {
  it('a DISAGREEMENT about the bill is surfaced, not swallowed', async () => {
    // Two independent implementations of the same GSM-7 rules. If they differ,
    // one of us is wrong about money and the caller should hear it here rather
    // than on an invoice.
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    stubFetch(200, ok({ smsCount: 3 }));
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(true); // it still sent; this is information, not a failure
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('charge for 3');
    expect(String(warn.mock.calls[0][0])).toContain('predicted 1');
    warn.mockRestore();
  });

  it('AGREEMENT is silent — an alarm that always fires is one nobody reads', async () => {
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    stubFetch(200, ok({ smsCount: 1 }));
    await client().send({ to: '+4522680880', text: 'Hej' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('failures that must not look like successes', () => {
  it('401 names where the key actually goes', async () => {
    stubFetch(401, JSON.stringify({ errorMessage: 'Unauthorized' }));
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.error).toContain('Basic-auth PASSWORD');
  });

  it('400 carries their details array, which is where the real reason is', async () => {
    stubFetch(400, JSON.stringify({ errorMessage: 'Bad request', details: ['from is too long', 'to is invalid'] }));
    const res = await client().send({ to: '+4522680880', text: 'Hej' });
    expect(res.error).toContain('from is too long');
    expect(res.error).toContain('to is invalid');
  });

  it('a timeout is NOT reported as "did not send"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { const e = new Error('x'); e.name = 'TimeoutError'; throw e; }));
    const res = await client({ timeoutMs: 5 }).send({ to: '+4522680880', text: 'Hej' });
    expect(res.error).toContain('MAY OR MAY NOT HAVE BEEN SENT');
  });
});

describe('inMobile allows 14 sender digits, not the 15 the other two allow', () => {
  it('15 digits is refused HERE — they would silently TRUNCATE it', async () => {
    const c = stubFetch(200, ok());
    const res = await client({}, '451234567890').send({ to: '+4522680880', text: 'Hej' });
    expect('451234567890').toHaveLength(12);
    expect(res.ok).toBe(true); // 12 is fine
    vi.unstubAllGlobals();

    const c2 = stubFetch(200, ok());
    const res2 = await client({}, '451234567890123').send({ to: '+4522680880', text: 'Hej' });
    expect('451234567890123').toHaveLength(15); // fine on GatewayAPI and sms.dk
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain('3–14');
    expect(c2).toHaveLength(0);
  });

  it('the shared 11-character TEXT limit applies here too', async () => {
    const c = stubFetch(200, ok());
    const res = await client({}, 'MoovyyRides!').send({ to: '+4522680880', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('inmobile: sender');
    expect(c).toHaveLength(0);
  });
});
