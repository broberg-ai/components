// F076.1 — the core, proven before any real gateway is wired.
//
// The tests that matter here are about MONEY, not about strings. A message is
// billed per segment, and the segment count is not a property of how long the
// text looks — it is a property of which characters are in it.
import { describe, it, expect, vi } from 'vitest';
import { estimate, normalisePhone, createSms, type SmsProvider } from '../src/index';

/** A provider that records what it was asked to send. */
function fakeProvider(overrides: Partial<SmsProvider> = {}) {
  const sent: Array<{ to: string; text: string; from: string }> = [];
  const provider: SmsProvider = {
    name: 'fake',
    async send(m) {
      sent.push(m);
      return { id: 'msg_1' };
    },
    ...overrides,
  };
  return { provider, sent };
}

const g = (n: number) => 'a'.repeat(n);

describe('estimate — what a message actually costs', () => {
  it.each([
    [1, 1],
    [159, 1],
    [160, 1],
    [161, 2], // 160 is the single-message limit; past it, parts are 153
    [306, 2], // 2 × 153
    [307, 3],
  ])('%i GSM-7 characters → %i segment(s)', (chars, segments) => {
    const r = estimate(g(chars));
    expect(r.encoding).toBe('gsm-7');
    expect(r.segments).toBe(segments);
  });

  it('MULTIPART IS 153, NOT 160 — a concatenated message spends 7 bytes per part on its header', () => {
    // If this used 160 for multipart, 320 chars would read as 2 segments.
    // It is 3. Under-counting here under-reports every invoice.
    expect(estimate(g(320)).segments).toBe(3);
    expect(estimate(g(306)).segments).toBe(2);
  });

  it('Danish æøåÆØÅ stay GSM-7 — they are in the basic alphabet', () => {
    // This is what makes the trap below so easy to miss: Danish text looks
    // completely safe, because it IS.
    const r = estimate('Blåbærgrød på Ærø — æøå ÆØÅ'.replace('—', '-'));
    expect(r.encoding).toBe('gsm-7');
  });

  it.each(['€', '[', ']', '{', '}', '\\', '^', '~', '|'])(
    'the GSM-7 EXTENSION character %s costs TWO septets, not one',
    (ch) => {
      expect(estimate(ch).units).toBe(2);
      expect(estimate(ch).encoding).toBe('gsm-7');
    },
  );

  it('80 extension characters is 2 segments, not 1', () => {
    // 80 × 2 = 160 septets… which is exactly the single-message limit.
    expect(estimate('€'.repeat(80)).units).toBe(160);
    expect(estimate('€'.repeat(80)).segments).toBe(1);
    // …and one more tips it over.
    expect(estimate('€'.repeat(81)).segments).toBe(2);
  });

  it('an emoji flips the WHOLE message to UCS-2 at 70 per part', () => {
    const r = estimate(`Hej ${'\u{1F600}'}`);
    expect(r.encoding).toBe('ucs-2');
    expect(r.units).toBe(6); // 'Hej ' = 4, emoji = 2 UTF-16 units
    expect(r.segments).toBe(1);
    expect(estimate('a'.repeat(70) + '\u{1F600}').segments).toBe(2);
  });
});

describe('THE MONEY CASE — one character, three times the price', () => {
  // The pair is the test. Either message alone proves nothing; the DIFFERENCE
  // between them is the entire finding, so they are measured side by side.
  const straight = `Hej Christian din kode er 1234. Den udloeber om 10 minutter. Hvis du ikke selv har bedt om den, saa ignorer denne besked og kontakt os paa 12345678 straks.`;

  it('is 155 characters — the fixture is what it claims to be', () => {
    expect(straight).toHaveLength(155);
  });

  it('pure GSM-7: 1 segment', () => {
    const r = estimate(straight);
    expect(r.encoding).toBe('gsm-7');
    expect(r.segments).toBe(1);
  });

  it("ONE curly apostrophe instead of a straight one: 3 segments — triple price, no error, and it still arrives", () => {
    const curly = straight.replace('din kode', 'din’ kode');
    const r = estimate(curly);
    expect(r.encoding).toBe('ucs-2');
    expect(r.segments).toBe(3);
    // The warning has to name the character, or the reader cannot act on it.
    expect(r.warning).toContain('not in GSM-7');
    expect(r.warning).toContain('’');
  });

  it('a single-segment GSM-7 message carries NO warning — the alarm must stay quiet when nothing is wrong', () => {
    // An estimator that warns about everything is one nobody reads.
    expect(estimate(straight).warning).toBeUndefined();
    expect(estimate('Hej').warning).toBeUndefined();
  });
});

describe('normalisePhone — refusing matters more than accepting', () => {
  it.each([
    ['+4512345678', '+4512345678'],
    ['4512345678', '+4512345678'],
    ['12345678', '+4512345678'],
    ['12 34 56 78', '+4512345678'],
    ['(+45) 12-34-56-78', '+4512345678'],
    ['004512345678', '+4512345678'],
    ['  +45 12 34 56 78  ', '+4512345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['1234567', 'seven digits — a truncated number'],
    ['123456789', 'nine digits — neither national nor international'],
    ['abcdefgh', 'letters'],
    ['+45 12 34 56 7X', 'a stray letter'],
    ['+1', 'far too short for E.164'],
  ])('REFUSES %o (%s) rather than guessing', (input) => {
    // A guessed number is accepted by the gateway, billed, and never delivered.
    // Nothing in the chain reports it, so the refusal has to happen here.
    expect(() => normalisePhone(input)).toThrow();
  });

  it('honours a different default country', () => {
    expect(normalisePhone('12345678', '46')).toBe('+4612345678');
  });
});

describe('mode — assert at boot what the client actually resolved to', () => {
  const { provider } = fakeProvider();

  it.each([
    [{ provider, from: 'X', live: true }, 'live'],
    [{ provider, from: 'X', live: false }, 'allowlist-only'],
    [{ provider, from: 'X' }, 'allowlist-only'],
    [{ provider, from: 'X', disabled: true }, 'disabled'],
    [{ from: 'X' }, 'no-key'],
  ] as const)('%o → %s', (config, expected) => {
    expect(createSms({ ...config }).mode).toBe(expected);
  });

  it('PRECEDENCE: disabled beats live — the kill-switch wins, because that is what send() does', () => {
    expect(createSms({ provider, from: 'X', live: true, disabled: true }).mode).toBe('disabled');
  });

  it('THE FALSE GREEN: no provider but live:true reports no-key, NOT live', () => {
    // This is the case that would let a consumer write `if (!sms.live) throw`
    // and have it PASS over a client that cannot send at all.
    const c = createSms({ from: 'X', live: true });
    expect(c.mode).toBe('no-key');
    expect(c.mode).not.toBe('live');
  });
});

describe('mode AGREES WITH BEHAVIOUR — bound to the outcome, not to the config it came from', () => {
  // A readback derived from the same expression it describes is a tautology
  // that stays green if send() changes underneath it. So: actually send.
  it.each([
    [{ live: true }, true],
    [{ live: false }, false],
    [{ disabled: true }, false],
  ] as const)('%o → provider called: %s', async (extra, shouldSend) => {
    const { provider, sent } = fakeProvider();
    const sms = createSms({ provider, from: 'X', ...extra });
    const res = await sms.send({ to: '+4512345678', text: 'Hej' });
    expect(sent.length > 0).toBe(shouldSend);
    expect(res.skipped ?? false).toBe(!shouldSend);
  });

  it('NEGATIVE CONTROL: an allowlisted number still gets through in allowlist-only', async () => {
    // Without this, "allowlist-only means nothing is sent" would satisfy the
    // table above and misdescribe the mode entirely.
    const { provider, sent } = fakeProvider();
    const sms = createSms({ provider, from: 'X', live: false, allowlist: ['12345678'] });
    const res = await sms.send({ to: '+4512345678', text: 'Hej' });
    expect(sent).toHaveLength(1);
    expect(res.skipped).toBeUndefined();
    expect(res.id).toBe('msg_1');
  });

  it('the allowlist is normalised, so 12345678 and +4512345678 are the same person', async () => {
    const { provider, sent } = fakeProvider();
    const sms = createSms({ provider, from: 'X', allowlist: ['+45 12 34 56 78'] });
    await sms.send({ to: '12345678', text: 'Hej' });
    expect(sent).toHaveLength(1);
  });

  it('an unparseable allowlist entry is dropped, never silently widening the gate', async () => {
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    const { provider, sent } = fakeProvider();
    const sms = createSms({ provider, from: 'X', allowlist: ['not-a-number'] });
    await sms.send({ to: '+4512345678', text: 'Hej' });
    expect(sent).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('send never throws', () => {
  it('a provider that rejects becomes { ok:false, error }', async () => {
    const { provider } = fakeProvider({
      async send() {
        throw new Error('gateway 502');
      },
    });
    const res = await createSms({ provider, from: 'X', live: true }).send({ to: '+4512345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('502');
  });

  it('a provider that rejects with a non-Error still yields a result', async () => {
    const { provider } = fakeProvider({
      async send() {
        throw 'a string, not an Error';
      },
    });
    const res = await createSms({ provider, from: 'X', live: true }).send({ to: '+4512345678', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('a string');
  });

  it('a bad number fails BEFORE the provider is called — nothing is billed', async () => {
    const { provider, sent } = fakeProvider();
    const res = await createSms({ provider, from: 'X', live: true }).send({ to: '123', text: 'Hej' });
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('the cost is reported even when the send is skipped — you can see what dark mode would have spent', async () => {
    const { provider } = fakeProvider();
    const res = await createSms({ provider, from: 'X', live: false }).send({ to: '+4512345678', text: 'a'.repeat(200) });
    expect(res.skipped).toBe(true);
    expect(res.estimate?.segments).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F076.13 — the second argument is a DIALLING CODE, not a country.
//
// Reported by fd-sundhed against the published 0.11.0. The parameter was named
// `defaultCountry`, nothing validated it, and 'DK' went straight into the
// string: normalisePhone('22680880', 'DK') returned '+DK22680880' and did not
// throw. That is the exact number this function exists to refuse — produced by
// the function itself, and a gateway accepts it, bills it, and never delivers.
// ---------------------------------------------------------------------------
describe('F076.13 — the dialling code is validated', () => {
  it.each(['DK', 'dk', 'da-DK', '', '45x', '4500', '+', 'DKK'])(
    'refuses %j as a dialling code',
    (cc) => {
      expect(() => normalisePhone('22680880', cc)).toThrow(/not a dialling code/);
    },
  );

  it('accepts a leading plus rather than doubling it', () => {
    // '+45' used to yield '++4522680880'. Unambiguous, so refusing it would have
    // left a second way to hold this wrong.
    expect(normalisePhone('22680880', '+45')).toBe('+4522680880');
  });

  it('names the value that was passed, so the caller can see their own mistake', () => {
    expect(() => normalisePhone('22680880', 'DK')).toThrow(/"DK"/);
  });

  it('is unchanged where it was already right', () => {
    // The fix must not narrow the function by accident.
    expect(normalisePhone('22680880')).toBe('+4522680880');
    expect(normalisePhone('22680880', '45')).toBe('+4522680880');
    expect(normalisePhone('12 34 56 78')).toBe('+4512345678');
    expect(normalisePhone('+4522680880')).toBe('+4522680880');
    expect(normalisePhone('4522680880')).toBe('+4522680880');
    expect(() => normalisePhone('1234567')).toThrow();
  });

  it('the parameter is positional, so an existing caller is untouched', () => {
    expect(normalisePhone('22680880', '45')).toBe('+4522680880');
  });

  it('NEVER returns a string that is not a plus followed by digits', () => {
    // The postcondition, deliberately separate from the input guard above.
    // The guard proves what we anticipated; this proves the PROPERTY, and it
    // still holds for an input shape neither the reporter nor we thought of.
    // fd-sundhed's own local test is this one, and it is the reason they were
    // covered before we shipped anything.
    const inputs = ['22680880', '12 34 56 78', '+4522680880', '4522680880', '0045 22 68 08 80'];
    for (const input of inputs) {
      expect(normalisePhone(input)).toMatch(/^\+\d+$/);
    }
  });
});
