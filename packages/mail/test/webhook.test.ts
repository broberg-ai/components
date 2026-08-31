import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOLERANCE_SECONDS,
  handleMailWebhook,
  parseMailEvent,
  verifyWebhook,
} from '../src/webhook';

/**
 * F005.7 — a send response cannot tell you the mail arrived.
 *
 * Filed by xrt81 after a real incident: 14 club mails, no errors, and twenty
 * minutes in which nobody could answer whether they had landed. `delivered`,
 * `bounced` and `complained` only ever appear on the webhook stream.
 *
 * VERIFICATION IS THE LOAD-BEARING PART, so it is tested hardest. An unverified
 * endpoint is an open write-surface where anyone can assert that anything was
 * delivered — worse than no delivery data at all, because it looks like
 * evidence. Every rejection path below therefore has its own test: a guard that
 * only passes is a guard nobody has seen refuse.
 */

const SECRET = `whsec_${Buffer.from('en-hemmelig-noegle-til-test').toString('base64')}`;

function signed(body: string, opts: { id?: string; at?: number; secret?: string } = {}) {
  const id = opts.id ?? 'msg_test';
  const at = String(opts.at ?? Math.floor(Date.now() / 1000));
  const raw = (opts.secret ?? SECRET).replace(/^whsec_/, '');
  const sig = createHmac('sha256', Buffer.from(raw, 'base64'))
    .update(`${id}.${at}.${body}`)
    .digest('base64');
  return { 'svix-id': id, 'svix-timestamp': at, 'svix-signature': `v1,${sig}` };
}

const DELIVERED = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-08-11T12:00:00.000Z',
  data: { email_id: 're_abc123', to: ['medlem@klub.dk'], from: 'klub@xrt81.com', subject: 'Kampprogram' },
});

/**
 * SVIX'S OWN PUBLISHED TEST VECTOR — the only assertion in this file that can
 * tell us we agree with SVIX rather than merely with ourselves.
 *
 * Filed by cardmem (#24352) after they built the same verifier locally: "a
 * verifier tested only against signatures it generated itself proves that it
 * agrees with itself. That is exactly what a WRONG implementation also does."
 *
 * MEASURED, because the obvious version of that claim is too strong. Changing
 * our hash from sha256 to sha512 turns EIGHT tests red including the
 * self-generated ones — they hard-code the algorithm themselves, so they catch
 * drift between test and source perfectly well.
 *
 * What they cannot catch is a SHARED misreading of Svix's spec — a mistake
 * copied into both, which is the likely one, since the test was written by
 * reading the source. Proven: change the signed message separator from "." to
 * ":" in BOTH src and this file, exactly as a mirroring test would have been
 * written, and 25 tests stay green while this one goes red. It is the only
 * assertion here that consults an authority outside our own repo.
 *
 * Source: svix/svix-webhooks, javascript/src/webhook.test.ts, "sign function
 * works". Cited so the next reader can re-check the numbers instead of trusting
 * us — a pinned WRONG vector would only prove we agree with someone's typo.
 *
 * The timestamp is from 2021, so the freshness window is lifted explicitly.
 * That is the option working as designed, not a workaround: this case tests the
 * SIGNATURE, and replay protection has its own assertion below.
 */
const SVIX_VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
} as const;

describe('Svix published vector — do we agree with Svix, or only with ourselves?', () => {
  const headers = {
    'svix-id': SVIX_VECTOR.id,
    'svix-timestamp': SVIX_VECTOR.timestamp,
    'svix-signature': SVIX_VECTOR.signature,
  };
  const forever = { toleranceSeconds: Number.MAX_SAFE_INTEGER };

  it('accepts the signature Svix publishes as correct', () => {
    expect(verifyWebhook(SVIX_VECTOR.body, headers, SVIX_VECTOR.secret, forever)).toEqual({
      ok: true,
    });
  });

  it('rejects it under a different secret — so the pass above is not vacuous', () => {
    const other = 'whsec_' + Buffer.from('en-anden-noegle').toString('base64');
    expect(verifyWebhook(SVIX_VECTOR.body, headers, other, forever)).toEqual({
      ok: false,
      reason: 'no_signature_match',
    });
  });

  it('rejects a re-serialised body — the raw bytes are the message', () => {
    // JSON.parse + stringify drops the space after the colon: same data, different
    // bytes, different signature. This failure looks exactly like a wrong secret,
    // so it gets an assertion rather than a comment.
    const reserialised = JSON.stringify(JSON.parse(SVIX_VECTOR.body));
    expect(reserialised).not.toBe(SVIX_VECTOR.body);
    expect(verifyWebhook(reserialised, headers, SVIX_VECTOR.secret, forever)).toEqual({
      ok: false,
      reason: 'no_signature_match',
    });
  });

  it('still enforces the freshness window on the vector by default', () => {
    // Negative control for lifting the tolerance above, so the three tests
    // cannot be read as evidence that replay protection was switched off.
    expect(verifyWebhook(SVIX_VECTOR.body, headers, SVIX_VECTOR.secret)).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });
});

describe('verifyWebhook — every rejection has been seen to fire', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyWebhook(DELIVERED, signed(DELIVERED), SECRET)).toEqual({ ok: true });
  });

  it('NO SECRET is a refusal, never a pass-through', () => {
    // The failure that would matter most: a missing secret must not fall through
    // to "accept everything". That is a guard reporting success because it never
    // ran, which is the whole class this package's owner spent the day chasing.
    expect(verifyWebhook(DELIVERED, signed(DELIVERED), undefined)).toEqual({
      ok: false,
      reason: 'no_secret',
    });
    expect(verifyWebhook(DELIVERED, signed(DELIVERED), '')).toEqual({ ok: false, reason: 'no_secret' });
  });

  it('a forged body with a valid-looking signature is rejected', () => {
    const headers = signed(DELIVERED);
    const forged = DELIVERED.replace('re_abc123', 're_forged');
    expect(verifyWebhook(forged, headers, SECRET)).toEqual({ ok: false, reason: 'no_signature_match' });
  });

  it('a signature made with a DIFFERENT secret is rejected', () => {
    const other = `whsec_${Buffer.from('en-anden-noegle').toString('base64')}`;
    expect(verifyWebhook(DELIVERED, signed(DELIVERED, { secret: other }), SECRET)).toEqual({
      ok: false,
      reason: 'no_signature_match',
    });
  });

  it('an old timestamp is rejected — a captured request cannot be replayed', () => {
    const stale = Math.floor(Date.now() / 1000) - DEFAULT_TOLERANCE_SECONDS - 1;
    expect(verifyWebhook(DELIVERED, signed(DELIVERED, { at: stale }), SECRET)).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('a FUTURE timestamp is rejected too, not just an old one', () => {
    const ahead = Math.floor(Date.now() / 1000) + DEFAULT_TOLERANCE_SECONDS + 1;
    expect(verifyWebhook(DELIVERED, signed(DELIVERED, { at: ahead }), SECRET)).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('missing headers are named as such rather than read as a bad signature', () => {
    const full = signed(DELIVERED);
    for (const drop of ['svix-id', 'svix-timestamp', 'svix-signature']) {
      const partial = { ...full, [drop]: undefined };
      expect(verifyWebhook(DELIVERED, partial, SECRET)).toEqual({ ok: false, reason: 'missing_headers' });
    }
  });

  it('a non-numeric timestamp is its own reason, not a silent tolerance failure', () => {
    expect(
      verifyWebhook(DELIVERED, { ...signed(DELIVERED), 'svix-timestamp': 'i-går' }, SECRET),
    ).toEqual({ ok: false, reason: 'timestamp_not_a_number' });
  });

  it('a rotated secret works: several signatures in the header, any one may match', () => {
    // The provider sends space-separated entries so both keys are live during a
    // rotation. Rejecting the second entry would break every rotation.
    const good = signed(DELIVERED)['svix-signature'];
    const headers = { ...signed(DELIVERED), 'svix-signature': `v1,AAAA ${good}` };
    expect(verifyWebhook(DELIVERED, headers, SECRET)).toEqual({ ok: true });
  });

  it('a signature of a different LENGTH is rejected rather than throwing', () => {
    // timingSafeEqual throws on mismatched lengths; a throw here would surface as
    // a 500 and read as our bug rather than as a rejected request.
    const headers = { ...signed(DELIVERED), 'svix-signature': 'v1,c2hvcnQ=' };
    expect(() => verifyWebhook(DELIVERED, headers, SECRET)).not.toThrow();
    expect(verifyWebhook(DELIVERED, headers, SECRET).ok).toBe(false);
  });

  it('reads headers from a Headers object as well as a plain bag', () => {
    const h = new Headers(signed(DELIVERED) as Record<string, string>);
    expect(verifyWebhook(DELIVERED, h, SECRET)).toEqual({ ok: true });
  });

  it('header lookup is case-insensitive, as frameworks deliver them', () => {
    const s = signed(DELIVERED);
    const upper = { 'Svix-Id': s['svix-id'], 'Svix-Timestamp': s['svix-timestamp'], 'Svix-Signature': s['svix-signature'] };
    expect(verifyWebhook(DELIVERED, upper, SECRET)).toEqual({ ok: true });
  });
});

describe('parseMailEvent', () => {
  it('parses a delivery into the fields you act on', () => {
    expect(parseMailEvent(DELIVERED)).toMatchObject({
      type: 'delivered',
      providerId: 're_abc123',
      to: ['medlem@klub.dk'],
      subject: 'Kampprogram',
      at: '2026-08-11T12:00:00.000Z',
    });
  });

  it('carries the bounce classification — the field that decides what to DO', () => {
    // A hard bounce means fix the address; a soft one means wait. Collapsing
    // them would leave the consumer exactly where they started.
    const bounced = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 're_x', to: ['væk@nowhere.dk'], bounce: { type: 'Permanent' } },
    });
    expect(parseMailEvent(bounced)).toMatchObject({ type: 'bounced', bounceType: 'Permanent' });
  });

  it('an unknown event type returns null rather than being reshaped into a known one', () => {
    const future = JSON.stringify({ type: 'email.something_new', data: { email_id: 're_x' } });
    expect(parseMailEvent(future)).toBeNull();
  });

  it('a malformed body returns null instead of throwing', () => {
    expect(parseMailEvent('ikke json')).toBeNull();
    expect(parseMailEvent('null')).toBeNull();
    expect(parseMailEvent('[]')).toBeNull();
  });

  it('keeps the whole payload on `raw` so nothing is lost to our shape', () => {
    expect(parseMailEvent(DELIVERED)!.raw).toMatchObject({ type: 'email.delivered' });
  });
});

describe('handleMailWebhook', () => {
  it('401s an unverified request and never calls onEvent', async () => {
    const onEvent = vi.fn();
    const res = await handleMailWebhook(DELIVERED, signed(DELIVERED), { secret: undefined, onEvent });
    expect(res.status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('202s and delivers the event when verified', async () => {
    const onEvent = vi.fn();
    const res = await handleMailWebhook(DELIVERED, signed(DELIVERED), { secret: SECRET, onEvent });
    expect(res.status).toBe(202);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'delivered' }));
  });

  it('202s an unknown type — a verified request we chose not to act on is not theirs to retry', async () => {
    const body = JSON.stringify({ type: 'email.something_new', data: {} });
    const onEvent = vi.fn();
    const onIgnored = vi.fn();
    const res = await handleMailWebhook(body, signed(body), { secret: SECRET, onEvent, onIgnored });
    expect(res.status).toBe(202);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onIgnored).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unknown_type' }));
  });

  it('a rejection reaches onIgnored with its reason, so failures are not invisible', async () => {
    const onIgnored = vi.fn();
    await handleMailWebhook(DELIVERED, signed(DELIVERED), { secret: undefined, onEvent: vi.fn(), onIgnored });
    expect(onIgnored).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_secret' }));
  });

  it('awaits an async onEvent before replying', async () => {
    // Otherwise a 202 means "we received it", not "we recorded it", and the
    // provider stops retrying on the strength of a promise nobody kept.
    let done = false;
    await handleMailWebhook(DELIVERED, signed(DELIVERED), {
      secret: SECRET,
      onEvent: async () => {
        await new Promise((r) => setTimeout(r, 10));
        done = true;
      },
    });
    expect(done).toBe(true);
  });
});
