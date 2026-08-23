// F077.1 — the consent register and the category gate.
//
// One sentence carries this whole file, and it is a test rather than a comment
// because getting it wrong locks people out of their own accounts:
//
//   A TRANSACTIONAL MESSAGE IS NEVER BLOCKED BY A MARKETING OPT-OUT.
//
// Everything that claims a send was blocked proves it by counting calls to the
// PROVIDER. And every "it was blocked" test is paired with a negative control,
// because a gate that blocks everything satisfies half these assertions
// perfectly and is worse than no gate at all.
import { describe, it, expect } from 'vitest';
import {
  createSms,
  createConsentRegistry,
  MemorySmsConsentStore,
  type ConsentRegistry,
  type SmsProvider,
} from '../src/index';

const NUMBER = '+4522680880';

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

/** A client with a real consent register behind it. */
function harness(register = true) {
  const store = new MemorySmsConsentStore();
  const consent: ConsentRegistry | undefined = register ? createConsentRegistry({ store }) : undefined;
  const { provider, sent } = spyProvider();
  const sms = createSms({
    provider,
    from: 'Moovyy',
    live: true,
    duplicates: false, // out of scope here; F076.9 has its own suite
    ...(consent ? { consent } : {}),
  });
  return { sms, sent, store, consent: consent as ConsentRegistry };
}

describe('AC#1 — A TRANSACTIONAL SEND IS NEVER BLOCKED', () => {
  it('goes out to someone who explicitly OPTED OUT', async () => {
    // The one that matters. An opt-out is from marketing; a one-time code is not
    // marketing, and blocking it locks someone out of their own account.
    const { sms, sent, consent } = harness();
    await consent.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev' });
    await consent.optOut(NUMBER, { source: 'link' });

    const res = await sms.send({ to: NUMBER, text: 'Din kode er 1234', category: 'transactional' });

    expect(sent).toHaveLength(1);
    expect(res.outcome).toBe('sent');
    expect(res.skippedReason).toBeUndefined();
  });

  it('goes out to someone with NO consent record at all', async () => {
    const { sms, sent } = harness();
    const res = await sms.send({ to: NUMBER, text: 'Din kode er 1234', category: 'transactional' });
    expect(sent).toHaveLength(1);
    expect(res.outcome).toBe('sent');
  });
});

describe('AC#2 + AC#3 — a marketing send is gated, with TWO reasons', () => {
  it('no consent record → never reaches the gateway, reason "no-consent"', async () => {
    const { sms, sent } = harness();
    const res = await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(0); // nothing was billed
    expect(res.skippedReason).toBe('no-consent');
    expect(res.outcome).toBe('skipped');
  });

  it('opted out → never reaches the gateway, reason "opted-out"', async () => {
    const { sms, sent, consent } = harness();
    await consent.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev' });
    await consent.optOut(NUMBER);
    const res = await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(0);
    expect(res.skippedReason).toBe('opted-out');
  });

  it('THE TWO REASONS ARE DIFFERENT VALUES — one means a failed import, the other a decision', async () => {
    const a = harness();
    const b = harness();
    await b.consent.record({ phone: NUMBER, basis: 'x' });
    await b.consent.optOut(NUMBER);

    const never = await a.sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    const withdrew = await b.sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });

    expect(never.skippedReason).not.toBe(withdrew.skippedReason);
    expect(never.skippedReason).toBe('no-consent');
    expect(withdrew.skippedReason).toBe('opted-out');
  });
});

describe('AC#4 — THE NEGATIVE CONTROL: a consenting number DOES receive marketing', () => {
  it('otherwise "no marketing was sent" is satisfied by a gate that blocks everything', async () => {
    const { sms, sent, consent } = harness();
    await consent.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev på webshoppen' });
    const res = await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(1);
    expect(res.outcome).toBe('sent');
  });

  it('a number is matched however it is written — 22680880 and +4522680880 are one person', async () => {
    const { sms, sent, consent } = harness();
    await consent.record({ phone: '22 68 08 80', basis: 'Tilmeldt i butikken' });
    await sms.send({ to: '+4522680880', text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(1);
  });

  it('and the opt-out matches the same way — a spaced number still stops the marketing', async () => {
    // If normalisation applied to one path and not the other, someone would opt
    // out and keep receiving.
    const { sms, sent, consent } = harness();
    await consent.record({ phone: NUMBER, basis: 'x' });
    await consent.optOut('22 68 08 80');
    await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(0);
  });
});

describe('AC#5 — `category` is required when the gate is on, and optional when it is off', () => {
  it('gate ON + no category → REFUSED, and the message names the fix', async () => {
    const { sms, sent } = harness();
    const res = await sms.send({ to: NUMBER, text: 'Hej' });
    expect(sent).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('refused');
    expect(res.error).toContain('category');
    expect(res.error).toContain('transactional');
    expect(res.error).toContain('marketing');
  });

  it('the refusal explains WHY there is no default — both defaults are dangerous', async () => {
    const { sms } = harness();
    const res = await sms.send({ to: NUMBER, text: 'Hej' });
    expect(res.error).toContain('no default');
    // The discriminating half: it must not read as a consent problem, which
    // would send the reader to the register instead of to their call-site.
    expect(res.error).not.toContain('opted out');
  });

  it('gate OFF → no category needed, nothing is blocked', async () => {
    const { sms, sent } = harness(false);
    const res = await sms.send({ to: NUMBER, text: 'Tilbud!' });
    expect(sent).toHaveLength(1);
    expect(res.outcome).toBe('sent');
  });

  it('gate OFF → even an explicit marketing send to an unknown number goes out', async () => {
    // Ship-dark: wiring nothing changes nothing.
    const { sms, sent } = harness(false);
    await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(1);
  });
});

describe('AC#6 — recording consent is guarded', () => {
  const reg = () => createConsentRegistry({ store: new MemorySmsConsentStore() });

  it.each([['', 'empty'], ['   ', 'whitespace']])('REFUSES a basis that is %o (%s)', async (basis) => {
    await expect(reg().record({ phone: NUMBER, basis })).rejects.toThrow(/basis/i);
  });

  it('the refusal says what a basis IS, so it can be supplied', async () => {
    await expect(reg().record({ phone: NUMBER, basis: '' })).rejects.toThrow(/read aloud/i);
  });

  it('a real basis is accepted and stored verbatim', async () => {
    const r = reg();
    const rec = await r.record({ phone: NUMBER, basis: '  Tilmeldt nyhedsbrev på webshoppen  ' });
    expect(rec.basis).toBe('Tilmeldt nyhedsbrev på webshoppen');
    expect((await r.get(NUMBER))?.basis).toBe('Tilmeldt nyhedsbrev på webshoppen');
  });

  it('A RE-RUN SIGNUP IMPORT CANNOT SILENTLY UN-WITHDRAW SOMEONE', async () => {
    // The bulk accident this guard exists for: no error, no signal, everyone who
    // ever opted out quietly back on the list.
    const r = reg();
    await r.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev' });
    await r.optOut(NUMBER);

    await expect(r.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev' })).rejects.toThrow(/WITHDREW/);
    expect(await r.check(NUMBER)).toBe('withdrawn');
  });

  it('but a GENUINE re-consent is possible, explicitly', async () => {
    const r = reg();
    await r.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev' });
    await r.optOut(NUMBER, { at: '2026-08-01T10:00:00.000Z' });
    await r.record({ phone: NUMBER, basis: 'Tilmeldte sig igen i butikken', overrideWithdrawal: true });

    expect(await r.check(NUMBER)).toBe('consented');
    // And the withdrawal is carried forward, not erased.
    expect((await r.get(NUMBER))?.previousWithdrawnAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('the evidence fields round-trip — this is what art. 7(1) asks you to produce', async () => {
    const r = reg();
    await r.record({
      phone: NUMBER,
      basis: 'Afkrydset ved bestilling',
      textVersion: 'samtykke-v2',
      source: 'checkout',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
      at: '2026-08-20T09:00:00.000Z',
    });
    const rec = await r.get(NUMBER);
    expect(rec).toMatchObject({
      phone: NUMBER,
      basis: 'Afkrydset ved bestilling',
      textVersion: 'samtykke-v2',
      source: 'checkout',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
      consentedAt: '2026-08-20T09:00:00.000Z',
    });
  });
});

describe('AC#7 — an opt-out NEVER refuses, and never deletes the row', () => {
  const reg = () => createConsentRegistry({ store: new MemorySmsConsentStore() });

  it('takes no basis — withdrawal must be at least as easy as consent (art. 7(3))', async () => {
    const r = reg();
    await r.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev' });
    await expect(r.optOut(NUMBER)).resolves.toBeTruthy();
    expect(await r.check(NUMBER)).toBe('withdrawn');
  });

  it('works on a number that NEVER consented — "leave me alone" has to stick', async () => {
    const r = reg();
    await expect(r.optOut(NUMBER)).resolves.toBeTruthy();
    expect(await r.check(NUMBER)).toBe('withdrawn');
  });

  it('is idempotent, and THE EARLIEST withdrawal date stands', async () => {
    // From the moment they first asked, they were opted out. A second opt-out
    // must not push the date forward and lose the evidence that you were told
    // weeks ago.
    const r = reg();
    await r.optOut(NUMBER, { at: '2026-08-01T10:00:00.000Z' });
    await r.optOut(NUMBER, { at: '2026-08-05T10:00:00.000Z' });
    expect((await r.get(NUMBER))?.withdrawnAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('…and a back-filled EARLIER date corrects the record downwards', async () => {
    // The other half, and the reason the rule is "earliest" rather than "first
    // call wins": discovering they actually asked in July must be recordable.
    const r = reg();
    await r.optOut(NUMBER, { at: '2026-08-01T10:00:00.000Z' });
    await r.optOut(NUMBER, { at: '2026-07-02T10:00:00.000Z', source: 'fandt mailen fra juli' });
    expect((await r.get(NUMBER))?.withdrawnAt).toBe('2026-07-02T10:00:00.000Z');
  });

  it('DOES NOT DELETE THE ROW — both dates are readable afterwards', async () => {
    const r = reg();
    await r.record({ phone: NUMBER, basis: 'Tilmeldt nyhedsbrev', at: '2026-07-01T10:00:00.000Z' });
    await r.optOut(NUMBER, { source: 'afmeldingslink', at: '2026-08-01T10:00:00.000Z' });

    const rec = await r.get(NUMBER);
    expect(rec).toMatchObject({
      consentedAt: '2026-07-01T10:00:00.000Z',
      basis: 'Tilmeldt nyhedsbrev',
      withdrawnAt: '2026-08-01T10:00:00.000Z',
      withdrawalSource: 'afmeldingslink',
    });
  });
});

describe('AC#8 — consentMode is bound to BEHAVIOUR, not to the config it came from', () => {
  it('a wired register reads "enforced" AND actually blocks', async () => {
    const { sms, sent } = harness();
    expect(sms.consentMode).toBe('enforced');
    await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(0);
  });

  it('no register reads "off" AND actually sends', async () => {
    const { sms, sent } = harness(false);
    expect(sms.consentMode).toBe('off');
    await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(1);
  });

  it('a register built WITHOUT a store is "off" — it cannot enforce what it cannot read', async () => {
    const consent = createConsentRegistry({});
    expect(consent.mode).toBe('off');
    const { provider, sent } = spyProvider();
    const sms = createSms({ provider, from: 'Moovyy', live: true, duplicates: false, consent });
    expect(sms.consentMode).toBe('off');
    await sms.send({ to: NUMBER, text: 'Tilbud!', category: 'marketing' });
    expect(sent).toHaveLength(1);
  });

  it('and such a register REFUSES to record, rather than dropping the consent on the floor', async () => {
    const consent = createConsentRegistry({});
    await expect(consent.record({ phone: NUMBER, basis: 'x' })).rejects.toThrow(/no store/i);
    await expect(consent.optOut(NUMBER)).rejects.toThrow(/no store/i);
  });
});

describe('the register itself', () => {
  it('check() answers none / consented / withdrawn, and they are distinct', async () => {
    const r = createConsentRegistry({ store: new MemorySmsConsentStore() });
    expect(await r.check(NUMBER)).toBe('none');
    await r.record({ phone: NUMBER, basis: 'x' });
    expect(await r.check(NUMBER)).toBe('consented');
    await r.optOut(NUMBER);
    expect(await r.check(NUMBER)).toBe('withdrawn');
  });

  it('an unparseable number throws in BOTH directions — that is not refusing an opt-out', async () => {
    const r = createConsentRegistry({ store: new MemorySmsConsentStore() });
    await expect(r.record({ phone: '123', basis: 'x' })).rejects.toThrow();
    await expect(r.optOut('123')).rejects.toThrow();
  });

  it('an async store works — every call is awaited', async () => {
    const map = new Map<string, import('../src/consent').ConsentRecord>();
    const r = createConsentRegistry({
      store: {
        async get(p) {
          await Promise.resolve();
          return map.get(p) ?? null;
        },
        async put(rec) {
          await Promise.resolve();
          map.set(rec.phone, rec);
        },
      },
    });
    await r.record({ phone: NUMBER, basis: 'x' });
    expect(await r.check(NUMBER)).toBe('consented');
  });

  it('the store holds ONE row per person, not one per call', async () => {
    const store = new MemorySmsConsentStore();
    const r = createConsentRegistry({ store });
    await r.record({ phone: NUMBER, basis: 'x' });
    await r.optOut(NUMBER);
    expect(store.all()).toHaveLength(1);
  });
});
