// F067.5 — a send that failed must be distinguishable from a send that had
// nothing to do.
//
// Filed by torrent-search-api, who asked whether this package had a trap of the
// MAIL_LIVE family rather than waiting to be bitten by one. Measured against
// 0.3.1's dist:
//
//   0 subscribers        -> {"sent":0,"dead":[]}
//   1 failing subscriber -> {"sent":0,"dead":[]}
//
// Byte-identical, for two situations that could not be more different. The
// statuses that vanish are the ones you most need: 401/403 means the VAPID keys
// are wrong, so EVERY push fails forever while reporting exactly what a quiet
// day reports. And a new PWA legitimately starts at zero subscribers, so sent:0
// reads as normal during precisely the window when the wiring is most likely to
// be wrong.
//
// THE ERRORS HERE ARE web-push's OWN `WebPushError`, pulled through
// vi.importActual — not an object shaped the way I imagine web-push shapes one.
// That distinction is the whole point of the test: the classifier reads
// `err.statusCode`, and only the real class proves that is the field. Confirmed
// in the dependency's source too (web-push/src/web-push-error.js):
//     function WebPushError(message, statusCode, headers, body, endpoint)
//
// The transport case (no status at all) lives in send-transport.test.ts, which
// mocks NOTHING — a mocked module cannot reach a socket, and "the push service
// is unreachable" is the commonest failure and the one most worth proving for
// real.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The queue the mocked sender consumes, one entry per call, in subscription
// order. The implementation is given at vi.fn() CREATION rather than through a
// later mockImplementation() — with a mocked module the latter makes vitest
// report the caught error as a test failure even when the code handles it
// correctly.
const { sendNotification } = vi.hoisted(() => ({
  sendNotification: vi.fn(() => {
    const q = (globalThis as Record<string, unknown>).__wpQueue as unknown[] | undefined;
    const next = q?.length ? q.shift() : null;
    if (next) throw next;
  }),
}));

vi.mock('web-push', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('web-push');
  const real = (actual.default ?? actual) as Record<string, unknown>;
  return { ...actual, default: { ...real, sendNotification } };
});

import webpushPkg from 'web-push';
import { createPushSender, generateVapidKeys } from '../src/index.js';

const { WebPushError } = webpushPkg as unknown as {
  WebPushError: new (m: string, s: number, h: unknown, b: string, e: string) => Error;
};

const sender = createPushSender({ ...generateVapidKeys(), subject: 'mailto:cb@webhouse.dk' });
const sub = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } });
const MSG = { title: 't', body: 'b' };

/** Queue web-push's REAL error type for the next n calls. */
function queue(...outcomes: (number | null)[]) {
  (globalThis as Record<string, unknown>).__wpQueue = outcomes.map((code) =>
    code === null
      ? null
      : new WebPushError(`Received unexpected response code`, code, {}, '', 'https://push.example/x'),
  );
}

beforeEach(() => queue());

describe('a failure is visible at all', () => {
  it('does NOT look identical to having no subscribers', async () => {
    // The whole card in one assertion.
    const quiet = await sender.send([], MSG);
    queue(500);
    const broken = await sender.send([sub('a')], MSG);
    expect(broken).not.toEqual(quiet);
  });

  it('carries what you need to act on, not just a count', async () => {
    // failed.length tells you something broke; it does not tell you what to do.
    queue(503);
    const r = await sender.send([sub('abc')], MSG);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.endpoint).toBe('https://push.example/abc');
    expect(r.failed[0]!.statusCode).toBe(503);
    expect(r.failed[0]!.reason).toBeTruthy();
  });

});

describe('the caller can branch without parsing a message string', () => {
  it('401/403 are a configuration fault, not a blip', async () => {
    // Wrong VAPID keys: not transient, not partial. Every push fails forever,
    // and retrying is exactly the wrong response.
    for (const code of [401, 403]) {
      queue(code);
      const r = await sender.send([sub('x')], MSG);
      expect(r.failed[0]!.kind, `status ${code}`).toBe('auth');
    }
  });

  it('400/413 are a payload fault — a different fix from a wrong key', async () => {
    for (const code of [400, 413]) {
      queue(code);
      const r = await sender.send([sub('x')], MSG);
      expect(r.failed[0]!.kind, `status ${code}`).toBe('payload');
    }
  });

  it('429 and 5xx are transient — retry, do not alarm', async () => {
    for (const code of [429, 500, 502, 503]) {
      queue(code);
      const r = await sender.send([sub('x')], MSG);
      expect(r.failed[0]!.kind, `status ${code}`).toBe('transient');
    }
  });
});

describe('nothing that worked before behaves differently', () => {
  it('a successful send still increments sent, and only sent', async () => {
    const r = await sender.send([sub('a'), sub('b')], MSG);
    expect(r).toEqual({ sent: 2, dead: [], failed: [] });
  });

  it('404/410 still land in dead — and NOT in failed', async () => {
    // A gone endpoint is not a fault to investigate, it is a row to delete.
    // Routing it into `failed` would drown the real faults in ordinary churn.
    for (const code of [404, 410]) {
      queue(code);
      const r = await sender.send([sub('gone')], MSG);
      expect(r.dead, `status ${code}`).toEqual(['https://push.example/gone']);
      expect(r.failed, `status ${code}`).toEqual([]);
    }
  });

  it('NEGATIVE CONTROL: an empty send reports no failure', async () => {
    // Without this, "always append a failure" would satisfy every test above —
    // and a phantom failure on every quiet day is noise that stops being read.
    expect(await sender.send([], MSG)).toEqual({ sent: 0, dead: [], failed: [] });
  });

  it('a mixed batch splits three ways', async () => {
    queue(null, 410, 401);
    const r = await sender.send([sub('ok'), sub('gone'), sub('bad')], MSG);
    expect(r.sent).toBe(1);
    expect(r.dead).toEqual(['https://push.example/gone']);
    expect(r.failed.map((f) => f.endpoint)).toEqual(['https://push.example/bad']);
  });
});

describe('the never-throws contract is sealed, not merely preserved', () => {
  it('send() RESOLVES when every subscription fails', async () => {
    // send() is documented as safe to `void` from inside a request handler, and
    // consumers rely on it. Making a failure visible must not make it fatal.
    queue(401);
    await expect(sender.send([sub('x')], MSG)).resolves.toBeDefined();
  });

  it('sendSilent() reports failures the same way', async () => {
    // The silent path fans out through the same function; if it did not, a badge
    // update could fail invisibly while the visible path reported correctly.
    queue(403);
    const r = await sender.sendSilent([sub('x')], { badge: 3 });
    expect(r.failed[0]!.kind).toBe('auth');
  });
});

describe('the boot readback — know before the first notification', () => {
  // Asked for by torrent-search-api: they wanted to gate at startup rather than
  // discover a broken config on the first push. Same reason @broberg/mail grew
  // `mode`, and the same shape of answer.
  const good = generateVapidKeys();

  it('reports ready for a valid config', () => {
    const s = createPushSender({ ...good, subject: 'mailto:cb@webhouse.dk' });
    expect(s.status).toBe('ready');
    expect(s.statusReason).toBeNull();
  });

  it('distinguishes NOT CONFIGURED from CONFIGURED WRONG', () => {
    // Two states, not one boolean: 'no-keys' is what a deliberately dark-shipped
    // environment looks like, 'invalid-keys' is always a bug. Collapsing them
    // would make a misconfiguration indistinguishable from a feature you have
    // simply not switched on.
    expect(createPushSender({ subject: '', publicKey: '', privateKey: '' }).status).toBe('no-keys');
    expect(
      createPushSender({ subject: 'mailto:cb@webhouse.dk', publicKey: 'abc', privateKey: 'def' }).status,
    ).toBe('invalid-keys');
  });

  it('a subject with no URL scheme is caught too', () => {
    // web-push's own rule, not one of ours — a bare address is rejected.
    const s = createPushSender({ ...good, subject: 'cb@webhouse.dk' });
    expect(s.status).toBe('invalid-keys');
    expect(s.statusReason).toContain('subject');
  });

  it('a broken config fails as auth, NOT as a transient blip', async () => {
    // The defect this test exists for, measured before the fix: missing keys
    // came back kind:'transient' with reason "No subject set in
    // vapidDetails.subject." — telling the caller to RETRY the one thing that
    // retrying can never fix.
    const s = createPushSender({ subject: '', publicKey: '', privateKey: '' });
    const r = await s.send([sub('a'), sub('b')], MSG);
    expect(r.sent).toBe(0);
    expect(r.dead).toEqual([]);
    expect(r.failed.map((f) => f.kind)).toEqual(['auth', 'auth']);
    expect(r.failed[0]!.statusCode).toBeNull();
    expect(r.failed[0]!.reason).toBeTruthy();
  });

  it('…and it does not touch the network to find that out', async () => {
    // Every subscription would fail identically, so attempting N requests only
    // spends time to learn what was knowable at construction.
    const s = createPushSender({ subject: '', publicKey: '', privateKey: '' });
    const before = sendNotification.mock.calls.length;
    await s.send([sub('a'), sub('b'), sub('c')], MSG);
    expect(sendNotification.mock.calls.length).toBe(before);
  });

  it('NEGATIVE CONTROL: a ready sender still sends', async () => {
    // Without this, short-circuiting EVERY send would satisfy the tests above.
    const s = createPushSender({ ...good, subject: 'mailto:cb@webhouse.dk' });
    const r = await s.send([sub('a')], MSG);
    expect(r.sent).toBe(1);
    expect(r.failed).toEqual([]);
  });
});
