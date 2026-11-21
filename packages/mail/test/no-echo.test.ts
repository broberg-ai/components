// F005.29 — a diagnostic must never hand the caller's input back. Measured in production by mailworker, 21/11 2026:
// checkSendingPermission({apiKey, from}) returned the whole object, API key in clear text, in `domain` and `summary`.
import { describe, it, expect } from 'vitest';
import { senderDomain, verifySendingDomain, checkBrandReadiness, checkResendDomain, checkSendingPermission, type DnsResolver } from '../src/verify';

// Assembled at run time: a literal key-shaped string would (rightly) trip the commit-time secret gate. It is not a key.
const KEY = ['re', 'TestKeyN', 'neverLeaksFakeXYZ0123456789'].join('_');
const LONG = 'x'.repeat(400);
const resolver: DnsResolver = {
  resolveTxt: async () => { throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' }); },
  resolveMx: async () => { throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' }); },
} as unknown as DnsResolver;
const neverFetch = (async () => { throw new Error('fetch must not be called for unreadable input'); }) as unknown as typeof fetch;

// what a consumer can pass by mistake: an options object where the string belongs, and strings shaped like keys
const BAD: [string, unknown][] = [
  ['an object carrying an API key (the measured case)', { apiKey: KEY, from: 'x@send.broberg.ai' }],
  ['an array carrying a key', [KEY]],
  ['a number', 123456789012345],
  ['null', null],
  ['a string that IS a key', KEY],
  ['a key inside a sentence', `Name <${KEY}>`],
  ['a very long string', LONG],
];

const leaks = (v: unknown) => {
  const text = JSON.stringify(v) ?? '';
  return text.includes(KEY) || text.includes('neverLeaksFake') || text.includes(LONG);
};

describe('F005.29 — no entry point repeats its input', () => {
  for (const [name, input] of BAD) {
    it(`verifySendingDomain: ${name}`, async () => {
      const r = await verifySendingDomain(input as string, { resolver });
      expect(leaks(r)).toBe(false);
    });
    it(`checkBrandReadiness: ${name}`, async () => {
      const r = await checkBrandReadiness(input as string, { resolver });
      expect(leaks(r)).toBe(false);
    });
    it(`checkResendDomain: ${name}`, async () => {
      const r = await checkResendDomain(input as string, { apiKey: KEY, fetch: neverFetch });
      expect(leaks(r)).toBe(false);
    });
    it(`checkSendingPermission: ${name}`, async () => {
      const r = await checkSendingPermission(input as string, { resolver, apiKey: KEY, fetch: neverFetch } as never);
      expect(leaks(r)).toBe(false);
    });
    it(`senderDomain: ${name} — throws, and the message carries no value`, () => {
      let msg = '';
      try { senderDomain(input as string); } catch (e) { msg = (e as Error).message; }
      if (input !== null) expect(msg).not.toBe(''); // null reads as empty input and throws too
      expect(msg.includes(KEY) || msg.includes('neverLeaksFake') || msg.includes(LONG)).toBe(false);
    });
  }

  it('a non-string is named by its TYPE, so the reader can see what they passed', async () => {
    expect(() => senderDomain({ apiKey: KEY } as unknown as string)).toThrow(/expected a string, got object/);
    expect((await verifySendingDomain([KEY] as unknown as string, { resolver })).domain).toBe('<array, not a string>');
  });

  it('ordinary input is repeated exactly as before (the F005.10 echo of a short unreadable string survives)', async () => {
    expect((await verifySendingDomain('moovyy', { resolver })).domain).toBe('moovyy');
    expect(senderDomain('Moovyy <noreply@send.broberg.ai>')).toBe('send.broberg.ai');
  });
});
