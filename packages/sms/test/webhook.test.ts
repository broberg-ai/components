// F076.8 — the assembled webhook route.
//
// Three ways the assembly goes wrong, two of them silent, and every one of them
// has a test that can fail:
//
//   1. Verification on a re-serialised body instead of the raw bytes.
//   2. Awaiting the caller's work before answering 2xx — which turns one event
//      into a 24-hour retry storm, because GatewayAPI retries until it gets one.
//   3. A throw becoming a non-2xx, which earns the same storm.
//
// The load-bearing assertion for #2 is ORDERING, not timing: a test that merely
// measured elapsed milliseconds would pass on a fast machine and flake on a slow
// one. So the tests record the sequence of events and assert the response was
// recorded before the handler finished.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSmsWebhook, smsWebhookHono, type DeliveryReport } from '../src/index';

const SECRET = 'whsec_test';

const GATEWAYAPI_BODY = JSON.stringify({
  event_type: 'message.status.sms',
  event: { msg_id: 'X1', status: 'DELIVERED', status_at: '2026-08-23T12:00:00Z', recipient: 4522680880 },
});

const INMOBILE_BODY = JSON.stringify({
  reports: [{ messageId: 'im-1', deliveryInfo: { stateCode: 1, stateDescription: 'Delivered' } }],
});

/** Sign a body the way GatewayAPI does: HMAC-SHA-256 hex, sent as `Signature`. */
async function sign(body: string, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const post = (body: string, headers: Record<string, string> = {}, url = 'https://app.test/sms/status') =>
  new Request(url, { method: 'POST', body, headers });

afterEach(() => vi.restoreAllMocks());

/** Wait for the fire-and-forget work to settle without asserting on timing. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('AC#1 — one line at the call-site, and the consumer never touches the bytes', () => {
  it('verifies on the RAW body and delivers the parsed reports', async () => {
    const seen: DeliveryReport[][] = [];
    const handler = createSmsWebhook({ secret: SECRET, onReports: (r) => void seen.push(r) });

    const res = await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    await settle();

    expect(res.status).toBe(204);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toMatchObject({ provider: 'gatewayapi', id: 'X1', state: 'delivered' });
  });

  it('A RE-SERIALISED BODY WOULD NOT VERIFY — which is why the handler owns the read', async () => {
    // The whole point of #1, made visible: the same OBJECT, re-stringified with
    // a different key order, signs to something else. A consumer who parsed
    // first and re-serialised would chase this and end up disabling the check.
    const reordered = JSON.stringify({
      event: { status_at: '2026-08-23T12:00:00Z', recipient: 4522680880, status: 'DELIVERED', msg_id: 'X1' },
      event_type: 'message.status.sms',
    });
    expect(reordered).not.toBe(GATEWAYAPI_BODY);
    expect(await sign(reordered)).not.toBe(await sign(GATEWAYAPI_BODY));
  });

  it('handles inMobile’s POST shape', async () => {
    const seen: DeliveryReport[][] = [];
    const handler = createSmsWebhook({ onReports: (r) => void seen.push(r) });
    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});

    const res = await handler(post(INMOBILE_BODY));
    await settle();

    expect(res.status).toBe(204);
    expect(seen[0][0]).toMatchObject({ provider: 'inmobile', id: 'im-1', state: 'delivered' });
  });

  it('handles sms.dk’s GET-with-query shape', async () => {
    const seen: Array<[DeliveryReport[], string]> = [];
    const handler = createSmsWebhook({ onReports: (r, p) => void seen.push([r, p]) });

    const res = await handler(
      new Request('https://app.test/sms/status?batchId=b-1&dlrStatus=1&receiver=4522680880', { method: 'GET' }),
    );
    await settle();

    expect(res.status).toBe(204);
    expect(seen[0][1]).toBe('smsdk');
    expect(seen[0][0][0]).toMatchObject({ provider: 'smsdk', id: 'b-1', state: 'delivered' });
  });

  it('the provider is told to the handler, so one route can serve all three', async () => {
    const providers: string[] = [];
    const handler = createSmsWebhook({ secret: SECRET, onReports: (_r, p) => void providers.push(p) });
    await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    await handler(post(INMOBILE_BODY));
    await handler(new Request('https://app.test/s?batchId=b&dlrStatus=1', { method: 'GET' }));
    await settle();
    expect(providers).toEqual(['gatewayapi', 'inmobile', 'smsdk']);
  });
});

describe('AC#2 — the 2xx goes out BEFORE the caller’s work, or one event becomes a retry storm', () => {
  it('ORDERING, not timing: the response is recorded before the handler finishes', async () => {
    const order: string[] = [];
    let finish: (() => void) | undefined;
    const blocked = new Promise<void>((r) => {
      finish = r;
    });

    const handler = createSmsWebhook({
      secret: SECRET,
      async onReports() {
        order.push('handler-started');
        await blocked;
        order.push('handler-finished');
      },
    });

    const res = await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    order.push(`responded-${res.status}`);

    // The handler is still parked here — the response has already been returned.
    expect(order).toEqual(['handler-started', 'responded-204']);

    finish?.();
    await blocked;
    await settle();
    expect(order).toEqual(['handler-started', 'responded-204', 'handler-finished']);
  });

  it('waitUntil receives the work, so a serverless runtime does not freeze it mid-flight', async () => {
    const handed: Array<Promise<unknown>> = [];
    let done = false;
    const handler = createSmsWebhook({
      secret: SECRET,
      waitUntil: (p) => void handed.push(p),
      async onReports() {
        await Promise.resolve();
        done = true;
      },
    });

    await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(done).toBe(true);
  });

  it('THE HONO ADAPTER WIRES THE RUNTIME’S waitUntil — an adapter that took it and ignored it would look wired', async () => {
    const handed: Array<Promise<unknown>> = [];
    const route = smsWebhookHono({ secret: SECRET, onReports: () => {} });

    const res = await route({
      req: { raw: post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }) },
      executionCtx: { waitUntil: (p) => void handed.push(p) },
    });

    expect(res.status).toBe(204);
    expect(handed).toHaveLength(1);
  });

  it('an explicit waitUntil in the options beats the runtime’s', async () => {
    const mine: Array<Promise<unknown>> = [];
    const runtime: Array<Promise<unknown>> = [];
    const route = smsWebhookHono({ secret: SECRET, onReports: () => {}, waitUntil: (p) => void mine.push(p) });
    await route({
      req: { raw: post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }) },
      executionCtx: { waitUntil: (p) => void runtime.push(p) },
    });
    expect(mine).toHaveLength(1);
    expect(runtime).toHaveLength(0);
  });

  it('the Hono adapter works with no executionCtx at all — a long-lived Node server', async () => {
    const seen: DeliveryReport[][] = [];
    const route = smsWebhookHono({ secret: SECRET, onReports: (r) => void seen.push(r) });
    const res = await route({ req: { raw: post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }) } });
    await settle();
    expect(res.status).toBe(204);
    expect(seen).toHaveLength(1);
  });
});

describe('AC#3 — a bad signature is refused, and the payload is NEVER parsed', () => {
  it('onReports is not called at all — not merely a wrong status code', async () => {
    let called = 0;
    const handler = createSmsWebhook({ secret: SECRET, onReports: () => void (called += 1) });

    const res = await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY, 'the-wrong-secret') }));
    await settle();

    expect(res.status).toBe(401);
    expect(called).toBe(0); // the discriminating half
  });

  it('a MISSING signature is refused too, not treated as "nothing to check"', async () => {
    let called = 0;
    const handler = createSmsWebhook({ secret: SECRET, onReports: () => void (called += 1) });
    const res = await handler(post(GATEWAYAPI_BODY));
    await settle();
    expect(res.status).toBe(401);
    expect(called).toBe(0);
  });

  it('a TAMPERED body with a valid signature for the ORIGINAL is refused', async () => {
    // The attack the signature exists for: someone replays a real signature over
    // a body that says the message failed.
    let called = 0;
    const tampered = GATEWAYAPI_BODY.replace('DELIVERED', 'UNDELIVERABLE');
    const handler = createSmsWebhook({ secret: SECRET, onReports: () => void (called += 1) });
    const res = await handler(post(tampered, { Signature: await sign(GATEWAYAPI_BODY) }));
    await settle();
    expect(res.status).toBe(401);
    expect(called).toBe(0);
  });

  it('with NO secret configured it is accepted, and says so out loud', async () => {
    // A decision, not a silence. The warning is the only thing standing between
    // "we chose not to verify" and "we forgot to".
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    let called = 0;
    const handler = createSmsWebhook({ onReports: () => void (called += 1) });
    const res = await handler(post(GATEWAYAPI_BODY));
    await settle();
    expect(res.status).toBe(204);
    expect(called).toBe(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('WITHOUT verifying');
  });
});

describe('the shared token — the only defence sms.dk and inMobile have', () => {
  it('a wrong token is refused before anything is read', async () => {
    let called = 0;
    const handler = createSmsWebhook({ sharedToken: 'tok', onReports: () => void (called += 1) });
    const res = await handler(new Request('https://app.test/s?token=nope&batchId=b&dlrStatus=1', { method: 'GET' }));
    await settle();
    expect(res.status).toBe(401);
    expect(called).toBe(0);
  });

  it('a MISSING token is refused — the check is not skippable by omission', async () => {
    let called = 0;
    const handler = createSmsWebhook({ sharedToken: 'tok', onReports: () => void (called += 1) });
    const res = await handler(new Request('https://app.test/s?batchId=b&dlrStatus=1', { method: 'GET' }));
    await settle();
    expect(res.status).toBe(401);
    expect(called).toBe(0);
  });

  it.each([
    ['a query parameter', 'https://app.test/s?token=tok&batchId=b&dlrStatus=1', {}],
    ['the X-Sms-Token header', 'https://app.test/s?batchId=b&dlrStatus=1', { 'X-Sms-Token': 'tok' }],
  ])('the right token in %s is accepted', async (_label, url, headers) => {
    let called = 0;
    const handler = createSmsWebhook({ sharedToken: 'tok', onReports: () => void (called += 1) });
    const res = await handler(new Request(url, { method: 'GET', headers }));
    await settle();
    expect(res.status).toBe(204);
    expect(called).toBe(1);
  });

  it('with no sharedToken configured, nothing is required — ship-dark', async () => {
    let called = 0;
    const handler = createSmsWebhook({ onReports: () => void (called += 1) });
    const res = await handler(new Request('https://app.test/s?batchId=b&dlrStatus=1', { method: 'GET' }));
    await settle();
    expect(res.status).toBe(204);
    expect(called).toBe(1);
  });
});

describe('AC#4 — a throw must NOT become a non-2xx', () => {
  it('the caller’s handler throwing still leaves a 2xx already sent', async () => {
    const errors: unknown[] = [];
    const handler = createSmsWebhook({
      secret: SECRET,
      onError: (e) => void errors.push(e),
      onReports() {
        throw new Error('the database is down');
      },
    });

    const res = await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    await settle();

    expect(res.status).toBe(204);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('database is down');
  });

  it('an ASYNC rejection is surfaced the same way, not left unhandled', async () => {
    const errors: unknown[] = [];
    const handler = createSmsWebhook({
      secret: SECRET,
      onError: (e) => void errors.push(e),
      async onReports() {
        await Promise.resolve();
        throw new Error('late failure');
      },
    });
    const res = await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    await settle();
    expect(res.status).toBe(204);
    expect(errors).toHaveLength(1);
  });

  it('without onError it warns rather than swallowing — the response has already gone', async () => {
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    const handler = createSmsWebhook({
      secret: SECRET,
      onReports() {
        throw new Error('boom');
      },
    });
    await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    await settle();
    expect(warn.mock.calls.flat().join(' ')).toContain('threw after the 2xx');
  });

  it.each([
    ['a body that is not JSON', 'not json at all'],
    ['an empty body', ''],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
  ])('%s is a 2xx, not a retry-storm invitation', async (_label, body) => {
    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    const handler = createSmsWebhook({ onReports: () => {} });
    const res = await handler(post(body));
    await settle();
    expect(res.status).toBe(204);
  });

  it('an unparseable sms.dk callback yields an EMPTY list, not a broken report', async () => {
    const seen: DeliveryReport[][] = [];
    const handler = createSmsWebhook({ onReports: (r) => void seen.push(r) });
    // No id in the query — parseSmsDkDlr returns null rather than half a report.
    const res = await handler(new Request('https://app.test/s?dlrStatus=1', { method: 'GET' }));
    await settle();
    expect(res.status).toBe(204);
    expect(seen[0]).toEqual([]);
  });
});

describe('AC#6 — no hard dependency', () => {
  it('the core takes a plain Request and returns a plain Response', async () => {
    const handler = createSmsWebhook({ secret: SECRET, onReports: () => {} });
    const res = await handler(post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }));
    expect(res).toBeInstanceOf(Response);
  });

  it('the Hono adapter takes the context STRUCTURALLY — hono is never imported', async () => {
    // The whole adapter surface, satisfied by an object literal. If it needed
    // hono's real Context this would not compile.
    const route = smsWebhookHono({ secret: SECRET, onReports: () => {} });
    const res = await route({ req: { raw: post(GATEWAYAPI_BODY, { Signature: await sign(GATEWAYAPI_BODY) }) } });
    expect(res.status).toBe(204);
  });
});
