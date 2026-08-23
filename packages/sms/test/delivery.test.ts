// F076.5 — delivery status.
//
// The fixtures marked .live.json are REAL responses captured from the real
// accounts on 2026-08-23, for messages actually delivered to a real handset.
// An invented fixture only proves the parser agrees with my imagination.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseGatewayApiWebhook,
  parseInMobileReports,
  parseSmsDkLog,
  parseSmsDkDlr,
  verifyGatewayApiSignature,
  fetchInMobileReports,
  fetchSmsDkLog,
} from '../src/index';

const live = (n: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8'));

afterEach(() => vi.unstubAllGlobals());

describe('REAL captured responses — messages that actually reached a handset', () => {
  it('inMobile: the live report for message e5436b35 reads as delivered AND charged', () => {
    const [r] = parseInMobileReports(live('inmobile-report.live.json'));
    expect(r).toMatchObject({
      provider: 'inmobile',
      id: 'e5436b35-2ca5-48e9-b52f-4b9c0abe457f',
      state: 'delivered',
      raw: 'Delivered',
      recipient: '4522680880',
      charged: true,
      segments: 1,
    });
    expect(r.at).toBe('2026-08-23T10:42:59.000Z'); // their doneTime, not sendTime
  });

  it('sms.dk: the live log for batch 6851ec5b reads as delivered, with the Danish timestamp parsed', () => {
    const [r] = parseSmsDkLog(live('smsdk-log.live.json'));
    expect(r).toMatchObject({
      provider: 'smsdk',
      id: '6851ec5b-55bd-b9da-f344-f42d6836c7ee',
      state: 'delivered',
      raw: 'Received',
      recipient: '4522680880',
      charged: true,
      segments: 1,
    });
    // "23.08.2026 12.33.57" — Danish order, and DOTS in the time. new Date()
    // returns Invalid Date for it, so a naive parser would emit nothing or throw.
    expect(r.at).toBe('2026-08-23T12:33:57.000Z');
  });
});

describe('AN UNRECOGNISED STATUS IS `unknown` — never delivered, never failed', () => {
  // GatewayAPI publishes the RCS values and not the full SMS set, so meeting a
  // status we have never seen is the COMMON case. Rounding it to the nearest one
  // we know is how a message nobody received gets recorded as arrived.
  it.each(['SOMETHING_NEW', 'ACCEPTED_BY_OPERATOR', '', 'delivered '])(
    'gatewayapi status %o -> unknown, with the raw value kept',
    (status) => {
      const [r] = parseGatewayApiWebhook({
        event_type: 'message.status.sms',
        event: { msg_id: 'm1', status },
      });
      expect(r.state).toBe('unknown');
      expect(r.state).not.toBe('delivered');
      expect(r.raw).toBe(status);
    },
  );

  it.each([
    ['gatewayapi', 'DELIVERED', 'delivered'],
    ['gatewayapi', 'ENROUTE', 'pending'],
    ['gatewayapi', 'EXPIRED', 'expired'],
    ['gatewayapi', 'UNDELIVERABLE', 'failed'],
  ])('%s %s -> %s', (_p, status, expected) => {
    const [r] = parseGatewayApiWebhook({ event_type: 'message.status.sms', event: { msg_id: 'm1', status } });
    expect(r.state).toBe(expected);
  });

  it('inMobile 0 is UNKNOWN but sms.dk 0 is PENDING — the two gateways mean different things', () => {
    // inMobile's MessageStateCode 0 is literally named "Unknown".
    // sms.dk's dlrStatus 0 is "No status yet". Collapsing them would throw away
    // a distinction the gateways went to the trouble of making.
    const [im] = parseInMobileReports({ reports: [{ messageId: 'a', deliveryInfo: { stateCode: 0 } }] });
    const [sd] = parseSmsDkLog({ result: { data: [{ batchId: 'b', dlrStatus: 0 }] } });
    expect(im.state).toBe('unknown');
    expect(sd.state).toBe('pending');
    expect(im.state).not.toBe(sd.state);
  });

  it.each([
    [1, 'delivered'],
    [-1, 'failed'],
    [-2, 'failed'],
    [99, 'unknown'],
  ])('inMobile stateCode %i -> %s', (code, expected) => {
    const [r] = parseInMobileReports({ reports: [{ messageId: 'a', deliveryInfo: { stateCode: code } }] });
    expect(r.state).toBe(expected);
  });

  it.each([
    [1, 'delivered'],
    [2, 'failed'],
    [4, 'expired'],
    [8, 'pending'],
    [16, 'unknown'],
  ])('sms.dk dlrStatus %i -> %s', (code, expected) => {
    const [r] = parseSmsDkLog({ result: { data: [{ batchId: 'b', dlrStatus: code }] } });
    expect(r.state).toBe(expected);
  });
});

describe('a webhook handler must not throw — a non-2xx earns a 24-hour retry storm', () => {
  it.each([null, undefined, 'a string', 42, {}, { event_type: 'x' }, [], [null]])(
    'parseGatewayApiWebhook(%o) returns an array without throwing',
    (input) => {
      expect(Array.isArray(parseGatewayApiWebhook(input))).toBe(true);
    },
  );

  it('ignores events that are not SMS statuses rather than inventing a report', () => {
    expect(parseGatewayApiWebhook({ event_type: 'message.status.rcs', event: { msg_id: 'm', status: 'READ' } })).toEqual([]);
    expect(parseGatewayApiWebhook({ event_type: 'user-message.text.sms', event: { msg_id: 'm' } })).toEqual([]);
  });

  it('skips an event with no message id — a report we cannot correlate is not a report', () => {
    expect(parseGatewayApiWebhook({ event_type: 'message.status.sms', event: { status: 'DELIVERED' } })).toEqual([]);
  });

  it.each([null, undefined, {}, { reports: 'nope' }, 'x'])('parseInMobileReports(%o) is safe', (i) => {
    expect(Array.isArray(parseInMobileReports(i))).toBe(true);
  });

  it.each([null, undefined, {}, { result: {} }, 'x'])('parseSmsDkLog(%o) is safe', (i) => {
    expect(Array.isArray(parseSmsDkLog(i))).toBe(true);
  });
});

describe('an unparseable timestamp is OMITTED, not guessed', () => {
  it.each(['not a date', '', '99.99.9999 99.99.99', 'yesterday'])('timeSent %o leaves `at` absent', (t) => {
    const [r] = parseSmsDkLog({ result: { data: [{ batchId: 'b', dlrStatus: 1, timeSent: t }] } });
    expect(r.at).toBeUndefined();
    expect(r.state).toBe('delivered'); // the status still parses; only the time is missing
  });

  it('an ISO timestamp is normalised', () => {
    const [r] = parseInMobileReports({
      reports: [{ messageId: 'a', deliveryInfo: { stateCode: 1, doneTime: '2026-08-23T10:42:59Z' } }],
    });
    expect(r.at).toBe('2026-08-23T10:42:59.000Z');
  });
});

describe('webhook signature verification', () => {
  const secret = 'a-webhook-secret';
  const body = JSON.stringify({ event_type: 'message.status.sms', event: { msg_id: 'm1', status: 'DELIVERED' } });

  async function sign(text: string, key: string) {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', k, enc.encode(text));
    return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('accepts a correct signature, with and without the v1= prefix', async () => {
    const hex = await sign(body, secret);
    expect(await verifyGatewayApiSignature(body, `v1=${hex}`, secret)).toBe(true);
    expect(await verifyGatewayApiSignature(body, hex, secret)).toBe(true);
  });

  it('REJECTS a tampered body — one character changed', async () => {
    const hex = await sign(body, secret);
    const tampered = body.replace('DELIVERED', 'DELIVEREE');
    expect(tampered).not.toBe(body);
    expect(await verifyGatewayApiSignature(tampered, `v1=${hex}`, secret)).toBe(false);
  });

  it('REJECTS the wrong secret', async () => {
    const hex = await sign(body, secret);
    expect(await verifyGatewayApiSignature(body, `v1=${hex}`, 'the-wrong-secret')).toBe(false);
  });

  it.each([
    ['a missing header', null],
    ['an empty header', ''],
    ['a non-hex signature', 'v1=not-hex-at-all'],
    ['a truncated signature', 'v1=abc123'],
  ])('REJECTS %s', async (_label, header) => {
    expect(await verifyGatewayApiSignature(body, header as any, secret)).toBe(false);
  });

  it('REJECTS an empty secret rather than treating it as "no verification needed"', async () => {
    // An unconfigured secret must never make verification pass. Note crypto.subtle
    // cannot even sign with an empty key, so a real signature for it does not
    // exist — any signature at all must still be refused.
    const hex = await sign(body, secret);
    expect(await verifyGatewayApiSignature(body, `v1=${hex}`, '')).toBe(false);
    expect(await verifyGatewayApiSignature(body, `v1=${hex}`, undefined as any)).toBe(false);
  });

  it('is case-insensitive about the hex, since encoders differ', async () => {
    const hex = await sign(body, secret);
    expect(await verifyGatewayApiSignature(body, `v1=${hex.toUpperCase()}`, secret)).toBe(true);
  });
});

describe('sms.dk GET callback — an unrecognised query must not read as delivered', () => {
  it('parses a plausible callback', () => {
    const r = parseSmsDkDlr(new URLSearchParams({ batchId: 'b1', dlrStatus: '1', receiver: '4522680880' }));
    expect(r).toMatchObject({ provider: 'smsdk', id: 'b1', state: 'delivered', recipient: '4522680880' });
  });

  it('returns NULL when there is no id — a callback we cannot correlate is not a report', () => {
    expect(parseSmsDkDlr(new URLSearchParams({ dlrStatus: '1' }))).toBeNull();
    expect(parseSmsDkDlr({})).toBeNull();
  });

  it('an unknown status code is unknown, not delivered', () => {
    const r = parseSmsDkDlr({ batchId: 'b1', dlrStatus: '77' });
    expect(r?.state).toBe('unknown');
  });
});

describe('fetchers', () => {
  it('inMobile: Basic auth, the limit in the query, and the limit range enforced', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: any, i: any) => {
      calls.push({ url: String(u), init: i });
      return new Response(JSON.stringify(live('inmobile-report.live.json')), { status: 200 });
    }));
    const r = await fetchInMobileReports({ apiKey: 'k', limit: 50 });
    expect(calls[0].url).toBe('https://api.inmobile.com/v4/sms/outgoing/reports?limit=50');
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${btoa('api:k')}`);
    expect(r[0].state).toBe('delivered');
    await expect(fetchInMobileReports({ apiKey: 'k', limit: 251 })).rejects.toThrow(/1\.\.250/);
    await expect(fetchInMobileReports({ apiKey: 'k', limit: 0 })).rejects.toThrow(/1\.\.250/);
  });

  it('sms.dk: POSTs to listlog with a Bearer token, and accepts a batchId filter', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: any, i: any) => {
      calls.push({ url: String(u), init: i });
      return new Response(JSON.stringify(live('smsdk-log.live.json')), { status: 200 });
    }));
    const r = await fetchSmsDkLog({ apiKey: 'k', batchId: 'b1' });
    expect(calls[0].url).toBe('https://api.sms.dk/v1/sms/listlog');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ batchId: 'b1' });
    expect(r[0].id).toBe('6851ec5b-55bd-b9da-f344-f42d6836c7ee');
  });

  it('a non-2xx is an error, not an empty report list', async () => {
    // Returning [] here would read as "no delivery reports" — indistinguishable
    // from a working poll that found nothing.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(fetchInMobileReports({ apiKey: 'k' })).rejects.toThrow(/500/);
    await expect(fetchSmsDkLog({ apiKey: 'k' })).rejects.toThrow(/500/);
  });
});
