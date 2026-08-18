// F067.5, the half that cannot be mocked.
//
// A transport failure — DNS, TLS, offline, connection refused — carries NO HTTP
// status at all, and it is the commonest way a push actually fails. If only
// status-bearing errors were captured, `failed` would be empty in exactly the
// situation where the push service is unreachable, which is the silence this
// story exists to remove.
//
// So this file mocks NOTHING: a real web-push send to a closed port. It is the
// companion to send-failures.test.ts, which mocks the transport in order to
// choose a status code.
import { describe, it, expect } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { createPushSender, generateVapidKeys } from '../src/index.js';

describe('a real send to an unreachable host', () => {
  const sender = createPushSender({ ...generateVapidKeys(), subject: 'mailto:cb@webhouse.dk' });

  // REAL subscription keys, and the reason is worth stating: web-push validates
  // the p256dh length BEFORE opening a socket, so a placeholder key fails during
  // encryption and never reaches the network at all. That error has no status
  // code either, so the assertions below would have passed while testing
  // something entirely different from what this file claims to test.
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const unreachable = {
    endpoint: 'https://127.0.0.1:1/nope',
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };

  it('is reported, with no status code and as transient', async () => {
    const r = await sender.send([unreachable], { title: 't', body: 'b' });
    expect(r.sent).toBe(0);
    expect(r.dead).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.statusCode).toBeNull();
    expect(r.failed[0]!.kind).toBe('transient');
    // Assert it is genuinely a CONNECTION failure, not an encryption one that
    // happens to look the same from the outside.
    expect(r.failed[0]!.reason).toMatch(/ECONNREFUSED|connect|socket/i);
  });

  it('and it does not throw', async () => {
    await expect(sender.send([unreachable], { title: 't', body: 'b' })).resolves.toBeDefined();
  });

  it('BEFORE-AND-AFTER: this is what 0.3.1 could not tell apart', async () => {
    // The measurement from the card, now an assertion. On 0.3.1 both sides of
    // this were {"sent":0,"dead":[]} and deeply equal.
    const quiet = await sender.send([], { title: 't', body: 'b' });
    const broken = await sender.send([unreachable], { title: 't', body: 'b' });
    expect(quiet).toEqual({ sent: 0, dead: [], failed: [] });
    expect(broken).not.toEqual(quiet);
  });
});
