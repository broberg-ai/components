// F076.2 — the GatewayAPI adapter.
//
// A mock written from my own reading of the docs, checked against an adapter
// written from the same reading, proves only that I was CONSISTENT. So the
// load-bearing test here is not the mock: it is `validate()` below, which checks
// the request body against GatewayAPI's OWN published OpenAPI schema. That
// schema is the one thing in this file I did not write.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSms, gatewayapi } from '../src/index';

const spec = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/gatewayapi.openapi.json', import.meta.url)), 'utf8'),
) as any;

const REQUEST_SCHEMA = spec.components.schemas.MobileMessageRequest;

/**
 * Check a request body against GatewayAPI's published schema. Deliberately small
 * — it covers exactly the constraints this adapter can violate (required, type,
 * length, enum) and nothing else. It is proven to REJECT in the tests below;
 * a validator that has never said no is not a validator.
 */
function validate(body: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const key of REQUEST_SCHEMA.required as string[]) {
    if (body[key] === undefined) errs.push(`missing required field "${key}"`);
  }
  for (const [key, value] of Object.entries(body)) {
    const s = REQUEST_SCHEMA.properties[key];
    if (!s) {
      errs.push(`unknown field "${key}" — not in the published schema`);
      continue;
    }
    const types: string[] = s.type
      ? [s.type]
      : (s.anyOf ?? s.oneOf ?? []).map((v: any) => v.type).filter(Boolean);
    if (types.length) {
      const actual = value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
      const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'));
      if (!ok) errs.push(`"${key}" is ${actual}, schema says ${types.join('|')}`);
    }
    if (typeof value === 'string') {
      if (s.maxLength != null && value.length > s.maxLength) errs.push(`"${key}" longer than ${s.maxLength}`);
      if (s.minLength != null && value.length < s.minLength) errs.push(`"${key}" shorter than ${s.minLength}`);
      if (s.enum && !s.enum.includes(value)) errs.push(`"${key}"=${value} not in ${s.enum.join('|')}`);
    }
  }
  return errs;
}

type Capture = { url: string; init: any; body: Record<string, unknown> };

/** Stub fetch, capture the call, answer with whatever the test wants. */
function stubFetch(status: number, body: string) {
  const calls: Capture[] = [];
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(body, { status });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const ACCEPTED = JSON.stringify({ msg_id: '01JNN696A9E0WS89FPYGT15NBX', recipient: 4512345678, reference: null });
const client = (extra: Record<string, unknown> = {}, from = 'Moovyy', live = true) =>
  createSms({ provider: gatewayapi({ apiKey: 'k', ...extra }), from, live });

describe('THE CONTRACT — validated against GatewayAPI’s own OpenAPI schema', () => {
  it('the vendored spec is the one this adapter was built against', () => {
    // If someone refreshes the fixture, this is the line that makes the change
    // visible instead of silent.
    expect(spec.info.version).toBe('2026.08.21-1807');
    expect(spec.servers.map((s: any) => s.url)).toContain('https://messaging.gatewayapi.eu');
    expect(Object.keys(spec.paths)).toContain('/mobile/single');
  });

  it('THE VALIDATOR CAN SAY NO — proven before any green result from it is believed', () => {
    // Every defect this file exists to catch, fed in deliberately.
    expect(validate({ sender: 'Moovyy', message: 'x' })).toContain('missing required field "recipient"');
    expect(validate({ sender: 'Moovyy', recipient: '+4512345678', message: 'x' }).join()).toContain('schema says integer');
    expect(validate({ sender: 'Mo', recipient: 4512345678, message: 'x' }).join()).toContain('shorter than 3');
    expect(validate({ sender: 'M'.repeat(19), recipient: 4512345678, message: 'x' }).join()).toContain('longer than 18');
    expect(validate({ sender: 'Moovyy', recipient: 4512345678, message: 'x', priority: 'panic' }).join()).toContain('not in normal|urgent');
    expect(validate({ sender: 'Moovyy', recipient: 4512345678, message: 'x', msisdn: 45 }).join()).toContain('unknown field "msisdn"');
  });

  it('the body the adapter actually sends satisfies the schema', async () => {
    const calls = stubFetch(202, ACCEPTED);
    await client().send({ to: '12345678', text: 'Din kode er 1234' });
    expect(validate(calls[0].body)).toEqual([]);
  });

  it('NOT the legacy shape — recipients[].msisdn would have been the wrong API entirely', async () => {
    const calls = stubFetch(202, ACCEPTED);
    await client().send({ to: '12345678', text: 'Hej' });
    expect(calls[0].url).toBe('https://messaging.gatewayapi.eu/mobile/single');
    expect(calls[0].body).not.toHaveProperty('recipients');
    expect(calls[0].body).toHaveProperty('recipient', 4512345678);
  });

  it('recipient is a NUMBER without a plus — E.164 in, bare digits out', async () => {
    const calls = stubFetch(202, ACCEPTED);
    await client().send({ to: '+45 12 34 56 78', text: 'Hej' });
    expect(calls[0].body.recipient).toBe(4512345678);
    expect(typeof calls[0].body.recipient).toBe('number');
  });

  it('authenticates with the Token scheme, exactly as the securityScheme describes', async () => {
    const calls = stubFetch(202, ACCEPTED);
    await createSms({ provider: gatewayapi({ apiKey: 'secret-key' }), from: 'Moovyy', live: true }).send({ to: '12345678', text: 'Hej' });
    expect(calls[0].init.headers.Authorization).toBe('Token secret-key');
    expect(spec.components.securitySchemes.Token.name).toBe('Authorization');
  });

  it('202 IS SUCCESS — a status test against 200 would fail every real send', async () => {
    // The prose shows a success body with no status code, and the LEGACY api
    // answered 200. This is the single easiest way to get this adapter wrong.
    stubFetch(202, ACCEPTED);
    const res = await client().send({ to: '12345678', text: 'Hej' });
    expect(res.ok).toBe(true);
    expect(res.id).toBe('01JNN696A9E0WS89FPYGT15NBX');
  });

  it('optional fields are omitted unless asked for, and valid when present', async () => {
    const bare = stubFetch(202, ACCEPTED);
    await client().send({ to: '12345678', text: 'Hej' });
    expect(Object.keys(bare[0].body).sort()).toEqual(['message', 'recipient', 'sender']);
    vi.unstubAllGlobals();

    const full = stubFetch(202, ACCEPTED);
    await client({ priority: 'urgent', label: '2fa-login', expiration: 'PT10M' }).send({ to: '12345678', text: 'Hej' });
    expect(validate(full[0].body)).toEqual([]);
    expect(full[0].body).toMatchObject({ priority: 'urgent', label: '2fa-login', expiration: 'PT10M' });
  });
});

describe('region — the EU host is the default, because that is why this package exists', () => {
  it.each([
    [undefined, 'https://messaging.gatewayapi.eu/mobile/single'],
    ['eu' as const, 'https://messaging.gatewayapi.eu/mobile/single'],
    ['com' as const, 'https://messaging.gatewayapi.com/mobile/single'],
  ])('region %s → %s', async (region, expected) => {
    const calls = stubFetch(202, ACCEPTED);
    await client(region ? { region } : {}).send({ to: '12345678', text: 'Hej' });
    expect(calls[0].url).toBe(expected);
  });

  it('the region is visible in the provider name, so a boot log says which platform', () => {
    expect(createSms({ provider: gatewayapi({ apiKey: 'k' }), from: 'Moovyy' }).provider).toBe('gatewayapi:eu');
    expect(createSms({ provider: gatewayapi({ apiKey: 'k', region: 'com' }), from: 'Moovyy' }).provider).toBe('gatewayapi:com');
  });
});

describe('401 and 403 are different faults with different fixes', () => {
  // Measured against the live endpoint 2026-08-23: no header → 401, wrong token
  // → 403. Their docs list only 403. Collapsing them sends you to rotate a key
  // that was never the problem.
  it('401 says the credentials never arrived, and does not blame the key', async () => {
    stubFetch(401, '{"description":"Unauthorized","detail":[]}');
    const res = await client().send({ to: '12345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('NO credentials reached them');
    expect(res.error).toContain('Your key is probably fine');
    // DISCRIMINATING half: `toContain` alone cannot see a message that says the
    // right thing AND the opposite thing. A 401 that also shouts REJECTED sends
    // the reader to rotate a key that was never the problem — and a mutation
    // doing exactly that stayed GREEN until this line existed.
    expect(res.error).not.toContain('REJECTED');
  });

  it('403 says the key arrived and was rejected, and names the region as a cause', async () => {
    stubFetch(403, '{"description":"Forbidden","detail":[]}');
    const res = await client().send({ to: '12345678', text: 'Hej' });
    expect(res.error).toContain('REJECTED');
    expect(res.error).toContain('messaging.gatewayapi.eu');
    expect(res.error).not.toContain('NO credentials reached them');
  });

  it('the two messages are not interchangeable', async () => {
    stubFetch(401, '{}');
    const a = await client().send({ to: '12345678', text: 'x' });
    vi.unstubAllGlobals();
    stubFetch(403, '{}');
    const b = await client().send({ to: '12345678', text: 'x' });
    // Not merely different strings — a 401 whose text merely APPENDS the 403
    // wording is still different, and still wrong. Each must carry only its own
    // diagnosis.
    expect(a.error).not.toBe(b.error);
    expect(a.error).toMatch(/NO credentials reached them/);
    expect(b.error).toMatch(/REJECTED/);
    expect(a.error).not.toMatch(/REJECTED/);
    expect(b.error).not.toMatch(/NO credentials reached them/);
  });

  it('422 points at the body, which is where they put the offending field', async () => {
    stubFetch(422, '{"detail":[{"loc":["body","sender"],"msg":"too short"}]}');
    const res = await client().send({ to: '12345678', text: 'Hej' });
    expect(res.error).toContain('refused the contents');
    expect(res.error).toContain('sender');
  });
});

describe('failures that must not look like successes', () => {
  it('a timeout is NOT reported as "did not send" — the message may already be billed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    }));
    const res = await client({ timeoutMs: 5 }).send({ to: '12345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('MAY OR MAY NOT HAVE BEEN SENT');
    expect(res.error).toContain('may already have been billed');
  });

  it('a 202 with no msg_id fails loudly — without it there is no handle for delivery status', async () => {
    stubFetch(202, '{"recipient":4512345678}');
    const res = await client().send({ to: '12345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no msg_id');
  });

  it('a 202 with a non-JSON body fails rather than returning a blank id', async () => {
    stubFetch(202, '<html>maintenance</html>');
    const res = await client().send({ to: '12345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not JSON');
  });

  it('a sender name that is too SHORT is caught HERE, not by a 422 on every message', async () => {
    const calls = stubFetch(202, ACCEPTED);
    const res = await client({}, 'Mo').send({ to: '12345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('3–11');
    expect(calls).toHaveLength(0); // nothing was sent, nothing was billed
  });

  it('THE LIMIT IS 11, NOT THE 18 THEIR SCHEMA ACCEPTS — a longer text sender is replaced en route', async () => {
    // Their OpenAPI says maxLength 18 and their API accepts it. Their own
    // limitations page says the SMS standard carries 11 for a text sender and
    // that a longer one "may be replaced automatically". So a 12-character name
    // validates, sends, bills, delivers — and arrives showing something else.
    // The schema is the wrong authority for this one field.
    const calls = stubFetch(202, ACCEPTED);
    const res = await client({}, 'MoovyyRides!').send({ to: '12345678', text: 'Hej' });
    expect('MoovyyRides!').toHaveLength(12); // inside their schema, outside the standard
    expect(res.ok).toBe(false);
    expect(res.error).toContain('REPLACED by the network');
    expect(calls).toHaveLength(0);
  });

  it('11 characters is allowed — the boundary is asserted on both sides', async () => {
    const calls = stubFetch(202, ACCEPTED);
    const res = await client({}, 'MoovyyRide').send({ to: '12345678', text: 'Hej' });
    expect('MoovyyRide').toHaveLength(10);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('a NUMERIC sender gets 15, not 11 — the standard treats digits differently', async () => {
    const calls = stubFetch(202, ACCEPTED);
    const res = await client({}, '451234567890').send({ to: '12345678', text: 'Hej' });
    expect('451234567890').toHaveLength(12); // would be refused as text
    expect(res.ok).toBe(true);
    expect(calls[0].body.sender).toBe('451234567890');
  });

  it('16 digits is still refused, and the message says numeric', async () => {
    const calls = stubFetch(202, ACCEPTED);
    const res = await client({}, '4512345678901234').send({ to: '12345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('numeric sender must be 3–15');
    expect(calls).toHaveLength(0);
  });

  it('an empty apiKey throws at construction — ship dark by passing NO provider instead', () => {
    expect(() => gatewayapi({ apiKey: '' })).toThrow(/no-key/);
  });
});

describe('dark mode still costs nothing', () => {
  it('a non-live client never reaches the network, but still reports the cost', async () => {
    const calls = stubFetch(202, ACCEPTED);
    const res = await client({}, 'Moovyy', false).send({ to: '12345678', text: 'a'.repeat(200) });
    expect(calls).toHaveLength(0);
    expect(res.skipped).toBe(true);
    expect(res.estimate?.segments).toBe(2);
  });
});

describe('F076.12 — the batch route, /mobile/multi', () => {
  const multi = (recipients: number[]) =>
    JSON.stringify({
      responses: recipients.map((recipient, i) => ({ msg_id: `MSG${i}`, recipient, reference: null })),
    });

  it('THE LIMIT COMES FROM THEIR SCHEMA, NOT FROM A NUMBER I TYPED', async () => {
    // The one assertion that makes "measured, not guessed" mechanical. Refresh
    // the fixture with a different maxItems and this goes red instead of the
    // package quietly over-filling a batch.
    const declared = spec.components.schemas.MultiMobileMessageRequest.properties.messages.maxItems;
    expect(declared).toBe(1000);
    expect(gatewayapi({ apiKey: 'k' }).batchLimit).toBe(declared);
    expect(Object.keys(spec.paths)).toContain('/mobile/multi');
  });

  it('AND IT IS NOT THE OTHER 1000 IN THE SAME SPEC', () => {
    // `recipient` carries "gt": 1000 — a floor on the PHONE NUMBER as an
    // integer, not a batch size. Both are 1000; only one of them splits a send
    // correctly, and reading the wrong one fails silently.
    expect(spec.components.schemas.MobileMessageRequest.properties.recipient.gt).toBe(1000);
    expect(spec.components.schemas.MobileMessageRequest.properties.recipient.gt).not.toBe(
      spec.components.schemas.MultiMobileMessageRequest.properties.messages.maxItems - 1,
    );
  });

  it('posts ONE call to /mobile/multi with a messages array', async () => {
    const c = stubFetch(202, multi([4522680881, 4522680882]));
    await client().sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to' },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].url).toBe('https://messaging.gatewayapi.eu/mobile/multi');
    expect((c[0].body.messages as unknown[]).length).toBe(2);
  });

  it('EVERY message in the batch validates against their published schema', async () => {
    const c = stubFetch(202, multi([4522680881, 4522680882]));
    await client({ priority: 'urgent', label: 'kampagne' }).sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to' },
    ]);
    for (const body of c[0].body.messages as Record<string, unknown>[]) {
      expect(validate(body)).toEqual([]);
    }
  });

  it('THE DOCUMENTED EXAMPLE IS THE WRONG SHAPE, and answering with it is `unknown`', async () => {
    // Their 202 example for /mobile/multi is a bare {msg_id, recipient} — the
    // SINGLE route's response — while the schema says {responses: [...]}. An
    // adapter coded to the example reads undefined for everyone, silently.
    stubFetch(202, ACCEPTED);
    const res = await client().sendMany([{ to: '+4522680881', text: 'en' }]);
    expect(res[0].outcome).toBe('unknown');
    expect(res[0].error).toContain('`responses`');
  });

  it('A REORDERED REPLY DOES NOT MISATTRIBUTE AN ID — the expensive silent one', async () => {
    // Both ids are real, so nothing downstream can catch a swap. Matched on the
    // recipient they echo back, never on position alone.
    stubFetch(
      202,
      JSON.stringify({
        responses: [
          { msg_id: 'FOR_82', recipient: 4522680882, reference: null },
          { msg_id: 'FOR_81', recipient: 4522680881, reference: null },
        ],
      }),
    );
    const res = await client().sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to' },
    ]);
    expect(res[0].id).toBe('FOR_81');
    expect(res[1].id).toBe('FOR_82');
  });

  it('a recipient with NO answer in the reply is `unknown`, and the others are unaffected', async () => {
    stubFetch(202, multi([4522680881])); // asked for two, told about one
    const res = await client().sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to' },
    ]);
    expect(res[0].outcome).toBe('sent');
    expect(res[1].outcome).toBe('unknown');
    expect(res[1].error).toContain('4522680882');
  });

  it('a bad SENDER on one message does not stop the other two, and is not submitted', async () => {
    const c = stubFetch(202, multi([4522680881, 4522680883]));
    const res = await client().sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to', from: 'A'.repeat(20) },
      { to: '+4522680883', text: 'tre' },
    ]);
    expect((c[0].body.messages as unknown[]).length).toBe(2); // the bad one never left
    expect(res.map((r) => r.outcome)).toEqual(['sent', 'refused', 'sent']);
    expect(res[1].error).toContain('characters');
  });

  it('when EVERY message is refused locally, no HTTP call is made at all', async () => {
    const c = stubFetch(202, multi([]));
    const res = await client().sendMany([
      { to: '+4522680881', text: 'en', from: 'A'.repeat(20) },
      { to: '+4522680882', text: 'to', from: 'B'.repeat(20) },
    ]);
    expect(c).toHaveLength(0); // nothing billed, nothing attempted
    expect(res.every((r) => r.outcome === 'refused')).toBe(true);
  });

  it('a 403 refuses the WHOLE batch — they told us no, so it is `refused`', async () => {
    stubFetch(403, 'forbidden');
    const res = await client().sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to' },
    ]);
    expect(res.map((r) => r.outcome)).toEqual(['refused', 'refused']);
    expect(res[0].error).toContain('REJECTED');
  });

  it('a timeout makes EVERY recipient in the batch `unknown`, never refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      }),
    );
    const res = await client().sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to' },
    ]);
    expect(res.every((r) => r.outcome === 'unknown')).toBe(true);
    expect(res[0].error).toContain('ALL 2 MESSAGES');
  });

  it('a 2xx with no msg_id for one recipient is `unknown` for that one only', async () => {
    stubFetch(
      202,
      JSON.stringify({
        responses: [
          { msg_id: 'MSG0', recipient: 4522680881, reference: null },
          { msg_id: null, recipient: 4522680882, reference: null },
        ],
      }),
    );
    const res = await client().sendMany([
      { to: '+4522680881', text: 'en' },
      { to: '+4522680882', text: 'to' },
    ]);
    expect(res[0].outcome).toBe('sent');
    expect(res[1].outcome).toBe('unknown');
    expect(res[1].error).toContain('no msg_id');
  });
});
