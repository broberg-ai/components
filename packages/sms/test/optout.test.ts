// F077.2 — every marketing message must carry a way out.
//
// Markedsføringsloven wants a clear and FREE way out in every marketing message,
// and for the existing-customer exception (§10 stk. 2) it is one of the
// conditions rather than a courtesy. The mechanism is not specified — a link
// satisfies it — which is why none of this depends on inbound SMS.
//
// TWO THINGS ARE TESTED HERE THAT LOOK LIKE DETAILS AND ARE NOT:
//
//   1. The text is NEVER appended. SMS is billed per segment, so adding
//      characters can turn one message into two, and the sender would meet that
//      on the invoice instead of in an error.
//   2. parseOptOutKeyword does NOT over-match. "Kan I stoppe leveringen fredag?"
//      is a question. Unsubscribing them is a bug they never find out about
//      until they wonder why nothing arrives.
import { describe, it, expect } from 'vitest';
import {
  createSms,
  createConsentRegistry,
  estimate,
  parseOptOutKeyword,
  OPT_OUT_WORDS,
  MemorySmsConsentStore,
  type SmsProvider,
} from '../src/index';

const NUMBER = '+4522680880';
const WAY_OUT = 'Afmeld: sms.broberg.dk/a/x7k2';

function spyProvider() {
  const sent: Array<{ to: string; text: string; from: string }> = [];
  const provider: SmsProvider = {
    name: 'spy',
    async send(m) {
      sent.push(m);
      return { id: `msg_${sent.length}` };
    },
  };
  return { provider, sent };
}

/** A client whose register enforces the opt-out line, with consent already given. */
async function harness(optOutText: string | null = WAY_OUT) {
  const store = new MemorySmsConsentStore();
  const consent = createConsentRegistry({ store, ...(optOutText ? { optOutText } : {}) });
  await consent.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev' });
  const { provider, sent } = spyProvider();
  const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: false, consent });
  return { sms, sent, consent };
}

describe('AC#1 + AC#2 — a marketing body without a way out is refused', () => {
  it('never reaches the gateway, and the error names the exact text to include', async () => {
    const { sms, sent } = await harness();
    const res = await sms.send({ to: NUMBER, text: 'Tilbud: 20% på alt i weekenden!', category: 'marketing' });

    expect(sent).toHaveLength(0); // nothing billed
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('refused');
    expect(res.error).toContain(WAY_OUT);
  });

  it('the error says it is NOT added for you, and why', async () => {
    const { sms } = await harness();
    const res = await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(res.error).toContain('NOT added for you');
    expect(res.error).toContain('billed per');
    // The discriminating half: it must not read as a consent problem, or the
    // reader goes to the register instead of to their template.
    expect(res.error).not.toContain('opted out');
    expect(res.error).not.toContain('no-consent');
  });

  it('a MISSING WAY OUT is reported before a missing consent — the template is wrong for everyone', async () => {
    // Both problems at once. Reporting the consent first would send a developer
    // hunting for a consenting test number to discover a bug in their template,
    // which is wrong for every recipient and fixable once.
    const consent = createConsentRegistry({ store: new MemorySmsConsentStore(), optOutText: WAY_OUT });
    const { provider } = spyProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: false, consent });
    const res = await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(res.outcome).toBe('refused');
    expect(res.skippedReason).not.toBe('no-consent');
  });

  it('NEGATIVE CONTROL — a body that DOES contain it goes out', async () => {
    const { sms, sent } = await harness();
    const res = await sms.send({ to: NUMBER, text: `Tilbud: 20% i weekenden! ${WAY_OUT}`, category: 'marketing' });
    expect(sent).toHaveLength(1);
    expect(res.outcome).toBe('sent');
  });

  it('with no optOutText configured, nothing is required of the body', async () => {
    const { sms, sent } = await harness(null); // null, not undefined — a default param fires on undefined
    await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(1);
  });
});

describe('AC#3 — a TRANSACTIONAL message is never asked to carry marketing furniture', () => {
  it('a one-time code sends without an opt-out line', async () => {
    const { sms, sent } = await harness();
    const res = await sms.send({ to: NUMBER, text: 'Din kode er 1234', category: 'transactional' });
    expect(sent).toHaveLength(1);
    expect(res.outcome).toBe('sent');
  });

  it('…even for someone who opted out — both exemptions hold at once', async () => {
    const { sms, sent, consent } = await harness();
    await consent.optOut(NUMBER);
    const res = await sms.send({ to: NUMBER, text: 'Din kode er 1234', category: 'transactional' });
    expect(sent).toHaveLength(1);
    expect(res.outcome).toBe('sent');
  });
});

describe('AC#4 — THE TEXT IS NEVER APPENDED', () => {
  it('the body reaching the gateway is byte-identical to the body passed in', async () => {
    const { sms, sent } = await harness();
    const text = `Tilbud: 20% i weekenden! ${WAY_OUT}`;
    await sms.send({ to: NUMBER, text, category: 'marketing' });
    expect(sent[0].text).toBe(text);
    expect(sent[0].text).toHaveLength(text.length);
  });

  it('and the segment count is the one the caller could predict', async () => {
    // The whole reason not to append: a silent addition can flip a one-segment
    // message into two, and the sender meets it on the invoice.
    const { sms, sent } = await harness();
    const text = `Tilbud i weekenden! ${WAY_OUT}`;
    const predicted = estimate(text);
    const res = await sms.send({ to: NUMBER, text, category: 'marketing' });
    expect(res.estimate?.segments).toBe(predicted.segments);
    expect(estimate(sent[0].text).segments).toBe(predicted.segments);
  });

  it('the refused send reports the cost it WOULD have had, so the trade-off is visible', async () => {
    const { sms } = await harness();
    const res = await sms.send({ to: NUMBER, text: 'a'.repeat(200), category: 'marketing' });
    expect(res.estimate?.segments).toBe(2);
  });
});

describe('AC#5 — parseOptOutKeyword recognises Danish and English', () => {
  it.each([
    'STOP',
    'stop',
    '  Stop  ',
    'STOP.',
    'Stop!',
    'STOP ALL',
    'stopall',
    'stop   marketing',
    'AFMELD',
    'afmelding',
    'FRAMELD',
    'framelding',
    'unsubscribe',
  ])('%o is an opt-out', (text) => {
    expect(parseOptOutKeyword(text)).toBe(true);
  });

  it('Danish AND English both work — recognising one silently ignores half the people asking', () => {
    expect(parseOptOutKeyword('STOP')).toBe(true);
    expect(parseOptOutKeyword('AFMELD')).toBe(true);
  });

  it('OPT_OUT_WORDS lists what is recognised, so you can tell a recipient', () => {
    expect(OPT_OUT_WORDS).toContain('stop');
    expect(OPT_OUT_WORDS).toContain('afmeld');
    expect(OPT_OUT_WORDS.length).toBeGreaterThan(4);
  });
});

describe('AC#6 — IT DOES NOT OVER-MATCH', () => {
  it.each([
    'Kan I stoppe leveringen fredag?',
    'Stop det nu',
    'Jeg vil gerne afmelde mit abonnement fra næste måned',
    'Hvornår stopper tilbuddet?',
    'nonstop',
    'stop stop',
    'Ja tak, send mere',
    '',
    '   ',
  ])('%o is NOT an opt-out', (text) => {
    // A false positive unsubscribes someone who asked a question, and they only
    // find out when they wonder why nothing arrives.
    expect(parseOptOutKeyword(text)).toBe(false);
  });

  it('the pair is the test: "stop" alone is one, "Stop det nu" is not', () => {
    expect(parseOptOutKeyword('stop')).toBe(true);
    expect(parseOptOutKeyword('Stop det nu')).toBe(false);
  });
});

describe('consentMode says which of the three you actually have', () => {
  it('a register with optOutText but NO store is "body-only" — it cannot check consent', async () => {
    const consent = createConsentRegistry({ optOutText: WAY_OUT });
    expect(consent.mode).toBe('body-only');

    const { provider, sent } = spyProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: false, consent });
    expect(sms.consentMode).toBe('body-only');

    // The body IS checked…
    const bad = await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(bad.outcome).toBe('refused');
    expect(sent).toHaveLength(0);

    // …and consent is NOT, because there is nothing to check it against.
    const good = await sms.send({ to: NUMBER, text: `Tilbud! ${WAY_OUT}`, category: 'marketing' });
    expect(good.outcome).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('body-only still requires a category — the gate is on, just narrower', async () => {
    const consent = createConsentRegistry({ optOutText: WAY_OUT });
    const { provider } = spyProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: false, consent });
    const res = await sms.send({ to: NUMBER, text: 'Hej' });
    expect(res.outcome).toBe('refused');
    expect(res.error).toContain('category');
  });

  it('a store AND optOutText is "enforced", and BOTH checks run', async () => {
    const consent = createConsentRegistry({ store: new MemorySmsConsentStore(), optOutText: WAY_OUT });
    expect(consent.mode).toBe('enforced');
    const { provider, sent } = spyProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: false, consent });

    // A perfect body still fails without consent.
    const noConsent = await sms.send({ to: NUMBER, text: `Tilbud! ${WAY_OUT}`, category: 'marketing' });
    expect(noConsent.skippedReason).toBe('no-consent');

    await consent.record({ phone: NUMBER, basis: 'Tilmeldt' });
    const stillNoWayOut = await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(stillNoWayOut.outcome).toBe('refused');

    expect(sent).toHaveLength(0);
  });
});
