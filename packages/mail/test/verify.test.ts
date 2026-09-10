// F005.9 — the sending domain readiness check.
//
// THE FIXTURES ARE REAL. Every DNS answer below was measured with
// `dig @8.8.8.8` on 2026-08-22, the day Christian could not log in to
// moovyy.com. They are pinned rather than invented because the bug was not
// hypothetical and the check has to catch THAT, not a tidy version of it.
//
// The finding those measurements produced is itself asserted here: TWO fleet
// sending domains, both half-configured, in exactly opposite ways.
//
//     send.broberg.ai     DKIM ok   SPF MISSING   MX MISSING
//     send.webhouse.dk    SPF ok    MX ok         DKIM MISSING (NXDOMAIN)
//
// Neither is complete. Nobody knew. It was found by accident while looking at
// something else — which is the argument for the check existing at all.
import { describe, it, expect } from 'vitest';
import { verifySendingDomain, type DnsResolver, type ProviderLayout } from '../src/verify';

/** A DNS error as node:dns raises it — the CODE is what carries the meaning. */
function dnsError(code: string): Error & { code: string } {
  return Object.assign(new Error(`queryTxt ${code}`), { code });
}

/** Build a resolver from a map of name -> answer | error. Anything unmapped is NXDOMAIN. */
function fakeResolver(txt: Record<string, string[][] | Error>, mx: Record<string, Array<{ exchange: string; priority: number }> | Error>): DnsResolver {
  return {
    async resolveTxt(name) {
      const hit = txt[name] ?? dnsError('ENOTFOUND');
      if (hit instanceof Error) throw hit;
      return hit;
    },
    async resolveMx(name) {
      const hit = mx[name] ?? dnsError('ENOTFOUND');
      if (hit instanceof Error) throw hit;
      return hit;
    },
  };
}

const DKIM_KEY = 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC2N+xxh9VMQvjHOVPshk55qLdZtOq4s40CoM8sBwbgmtm74OuOBi0hYlCr5';

/** send.broberg.ai as measured 2026-08-22: DKIM present, TXT and MX both NOERROR-but-empty (ENODATA). */
const brobergAi = fakeResolver(
  {
    'send.broberg.ai': dnsError('ENODATA'),
    'resend._domainkey.send.broberg.ai': [[DKIM_KEY]],
  },
  { 'send.broberg.ai': dnsError('ENODATA') },
);

/** send.webhouse.dk as measured 2026-08-22: SPF + MX present, DKIM name does not exist (NXDOMAIN). */
const webhouseDk = fakeResolver(
  {
    'send.webhouse.dk': [['v=spf1 include:amazonses.com ~all']],
    'resend._domainkey.send.webhouse.dk': dnsError('ENOTFOUND'),
  },
  { 'send.webhouse.dk': [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }] },
);

describe('the measured case — 2026-08-22, the day the login mail vanished', () => {
  it('send.broberg.ai: DKIM present, SPF and MX absent — NOT ready', async () => {
    const r = await verifySendingDomain('send.broberg.ai', { resolver: brobergAi, region: 'eu-west-1' });
    expect(r.ok).toBe(false);
    expect(r.dkim).toBe('ok');
    expect(r.spf).toBe('missing');
    expect(r.mx).toBe('missing');
    expect(r.unknown).toEqual([]);
  });

  it('DKIM-ONLY IS NOT "CONFIGURED" — the exact state that produced this card', async () => {
    const r = await verifySendingDomain('send.broberg.ai', { resolver: brobergAi });
    // Calling this domain fine because DKIM answers IS the bug. mailer.mode said
    // 'live' and was telling the truth; this must still say no.
    expect(r.ok).toBe(false);
    expect(r.dkim).toBe('ok');
  });

  it('send.webhouse.dk: SPF and MX present, DKIM absent — ALSO not ready', async () => {
    const r = await verifySendingDomain('send.webhouse.dk', { resolver: webhouseDk });
    expect(r.ok).toBe(false);
    expect(r.spf).toBe('ok');
    expect(r.mx).toBe('ok');
    expect(r.dkim).toBe('missing');
  });

  it('THE FINDING: the two fleet domains are exact complements — neither is a template', async () => {
    const a = await verifySendingDomain('send.broberg.ai', { resolver: brobergAi });
    const b = await verifySendingDomain('send.webhouse.dk', { resolver: webhouseDk });
    // Whatever one has, the other lacks. This was discovered by accident, and
    // it is pinned so a later "just copy the working one" cannot be written.
    expect([a.spf, a.dkim, a.mx]).toEqual(['missing', 'ok', 'missing']);
    expect([b.spf, b.dkim, b.mx]).toEqual(['ok', 'missing', 'ok']);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
  });

  it('a domain with all three is ok — the positive control', async () => {
    const complete = fakeResolver(
      {
        'send.done.example': [['v=spf1 include:amazonses.com ~all']],
        'resend._domainkey.send.done.example': [[DKIM_KEY]],
      },
      { 'send.done.example': [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }] },
    );
    const r = await verifySendingDomain('send.done.example', { resolver: complete });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.summary).toContain('all present');
  });
});

describe('THREE STATES, NEVER TWO — a lookup that failed is not a record that is absent', () => {
  // This is the block moovyy's own draft would have failed. Their
  // `catch { return [] }` made a resolver timeout indistinguishable from
  // NXDOMAIN, so a network hiccup would raise a confident false alarm about a
  // domain that is perfectly fine.
  const failing = fakeResolver(
    {
      'send.x.example': dnsError('ETIMEOUT'),
      'resend._domainkey.send.x.example': dnsError('ESERVFAIL'),
    },
    { 'send.x.example': dnsError('ECONNREFUSED') },
  );

  it('a failed lookup reports unknown — NOT missing', async () => {
    const r = await verifySendingDomain('send.x.example', { resolver: failing });
    expect(r.spf).toBe('unknown');
    expect(r.dkim).toBe('unknown');
    expect(r.mx).toBe('unknown');
    expect(r.missing).toEqual([]); // nothing was proven absent
    expect(r.unknown).toEqual(['SPF', 'DKIM', 'MX']);
  });

  it('an unknown never counts as ok — we did not verify it, so we do not claim it', async () => {
    const r = await verifySendingDomain('send.x.example', { resolver: failing });
    expect(r.ok).toBe(false);
  });

  it('the summary says a failed lookup is NOT absence, in words', async () => {
    const r = await verifySendingDomain('send.x.example', { resolver: failing });
    // A reader who sees "could not check" must not go edit DNS.
    expect(r.summary).toContain('NOT the same as absent');
  });

  it.each([
    ['ENOTFOUND', 'missing'],
    ['ENODATA', 'missing'],
    ['ETIMEOUT', 'unknown'],
    ['ESERVFAIL', 'unknown'],
    ['EREFUSED', 'unknown'],
    [undefined, 'unknown'],
  ])('error code %s resolves to %s', async (code, expected) => {
    const err = code === undefined ? new Error('no code at all') : dnsError(code as string);
    const resolver = fakeResolver({ 'd.example': err, 'resend._domainkey.d.example': [[DKIM_KEY]] }, { 'd.example': [{ exchange: 'm', priority: 1 }] });
    const r = await verifySendingDomain('d.example', { resolver });
    expect(r.spf).toBe(expected);
  });
});

describe('never throws, never blocks', () => {
  it('a resolver that rejects with a non-Error still yields a report', async () => {
    const hostile: DnsResolver = {
      async resolveTxt() { throw 'a string, not an Error'; },
      async resolveMx() { throw null; },
    };
    const r = await verifySendingDomain('send.y.example', { resolver: hostile });
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(['SPF', 'DKIM', 'MX']);
  });
});

describe('incompleteness is not failure — the wording a consumer will act on', () => {
  it('never claims mail WILL fail, because we cannot know that', async () => {
    // send.webhouse.dk has no DKIM and still passes DMARC: _dmarc.webhouse.dk
    // defaults to relaxed alignment, so SPF alone carries it. It is downweighted
    // by Google, not rejected. Shouting "mail will not arrive" about that domain
    // is wrong — and an over-harsh check is one people switch off.
    const r = await verifySendingDomain('send.webhouse.dk', { resolver: webhouseDk });
    expect(r.summary).toContain('INCOMPLETE');
    expect(r.summary).toContain('not necessarily blocked');
    expect(r.summary).not.toContain('NOT ready');
  });
});

describe('the report names the FIX, not just the fault', () => {
  it('a missing SPF carries the exact record to add', async () => {
    const r = await verifySendingDomain('send.broberg.ai', { resolver: brobergAi });
    expect(r.missing.find((m) => m.startsWith('SPF'))).toContain('v=spf1 include:amazonses.com ~all');
  });

  it('a missing MX with a known region names the exact target', async () => {
    const r = await verifySendingDomain('send.broberg.ai', { resolver: brobergAi, region: 'eu-west-1' });
    expect(r.missing.find((m) => m.startsWith('MX'))).toContain('feedback-smtp.eu-west-1.amazonses.com');
  });

  it('a missing MX WITHOUT a region says so rather than guessing one', async () => {
    // A confidently wrong region is worse than an admitted gap: it produces a
    // DNS record that looks right and silently routes bounces nowhere.
    const r = await verifySendingDomain('send.broberg.ai', { resolver: brobergAi });
    const mx = r.missing.find((m) => m.startsWith('MX'))!;
    expect(mx).toContain('<region>');
    expect(mx).toContain('cannot be guessed');
  });

  it('says WHY a missing MX matters — bounces, not delivery', async () => {
    // "MX missing on a send-only domain" reads as harmless and is not.
    const r = await verifySendingDomain('send.broberg.ai', { resolver: brobergAi });
    expect(r.missing.find((m) => m.startsWith('MX'))).toContain('bounces cannot come back');
  });
});

describe('the DKIM selector is provider-specific, and says so', () => {
  it('a custom selector is the name actually queried', async () => {
    const asked: string[] = [];
    const spy: DnsResolver = {
      async resolveTxt(name) { asked.push(name); throw dnsError('ENOTFOUND'); },
      async resolveMx() { throw dnsError('ENOTFOUND'); },
    };
    await verifySendingDomain('send.z.example', { resolver: spy, dkimSelector: 'mailgun' });
    expect(asked).toContain('mailgun._domainkey.send.z.example');
    expect(asked).not.toContain('resend._domainkey.send.z.example');
  });

  it('the default selector is resend', async () => {
    const asked: string[] = [];
    const spy: DnsResolver = {
      async resolveTxt(name) { asked.push(name); throw dnsError('ENOTFOUND'); },
      async resolveMx() { throw dnsError('ENOTFOUND'); },
    };
    await verifySendingDomain('send.z.example', { resolver: spy });
    expect(asked).toContain('resend._domainkey.send.z.example');
  });

  it('a missing DKIM tells a non-Resend consumer why it might be a false alarm', async () => {
    const r = await verifySendingDomain('send.webhouse.dk', { resolver: webhouseDk });
    expect(r.missing.find((m) => m.startsWith('DKIM'))).toContain('dkimSelector');
  });
});

describe('a TXT record is not an SPF record', () => {
  it('TXT present without v=spf1 still reports SPF missing', async () => {
    // send.broberg.ai's parent has a google-site-verification TXT. Treating
    // "has TXT" as "has SPF" would pass a domain with no SPF at all.
    const resolver = fakeResolver(
      {
        'send.w.example': [['google-site-verification=abc123']],
        'resend._domainkey.send.w.example': [[DKIM_KEY]],
      },
      { 'send.w.example': [{ exchange: 'm', priority: 1 }] },
    );
    const r = await verifySendingDomain('send.w.example', { resolver });
    expect(r.spf).toBe('missing');
  });

  it('a multi-chunk TXT is joined before matching — long records are split by DNS', async () => {
    const resolver = fakeResolver(
      {
        'send.v.example': [['v=spf1 include:ama', 'zonses.com ~all']],
        'resend._domainkey.send.v.example': [[DKIM_KEY]],
      },
      { 'send.v.example': [{ exchange: 'm', priority: 1 }] },
    );
    const r = await verifySendingDomain('send.v.example', { resolver });
    expect(r.spf).toBe('ok');
  });

  it('an empty DKIM record is missing, not ok', async () => {
    const resolver = fakeResolver(
      {
        'send.u.example': [['v=spf1 include:amazonses.com ~all']],
        'resend._domainkey.send.u.example': [['']],
      },
      { 'send.u.example': [{ exchange: 'm', priority: 1 }] },
    );
    const r = await verifySendingDomain('send.u.example', { resolver });
    expect(r.dkim).toBe('missing');
  });

  it('an empty MX array is missing, not ok', async () => {
    const resolver = fakeResolver(
      {
        'send.t.example': [['v=spf1 include:amazonses.com ~all']],
        'resend._domainkey.send.t.example': [[DKIM_KEY]],
      },
      { 'send.t.example': [] },
    );
    const r = await verifySendingDomain('send.t.example', { resolver });
    expect(r.mx).toBe('missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F005.10 — MAIL_FROM is an ADDRESS, not a domain.
//
// Filed by moovyy the hour they adopted 0.6.0. But MEASURED, their description
// of the symptom was wrong, and the truth is sharper:
//
//   "Moovyy <noreply@send.broberg.ai>"  → EBADNAME  → all three 'unknown'
//   ""                                  → ENODATA   → all three 'MISSING'
//
// They reported the display-name form as claiming everything was missing. It
// does not — the three-state design already absorbed that, because EBADNAME is
// not an absence code. The genuine confident-false-alarm is the EMPTY STRING,
// which resolves as ENODATA and produces "add TXT on ''" instructions for a
// domain that does not exist. That is the case pinned hardest below.
import { senderDomain } from '../src/verify';

describe('F005.10 — senderDomain reads the three forms MAIL_FROM actually holds', () => {
  it.each([
    ['send.broberg.ai', 'send.broberg.ai'],
    ['noreply@send.broberg.ai', 'send.broberg.ai'],
    ['Moovyy <noreply@send.broberg.ai>', 'send.broberg.ai'],
    ['  Moovyy  <noreply@Send.Broberg.AI>  ', 'send.broberg.ai'],
  ])('%s → %s', (input, expected) => {
    expect(senderDomain(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['Moovyy <>', 'display name with no address'],
    ['moovyy', 'a bare word, no dot'],
    ['https://send.broberg.ai/x', 'a URL'],
    ['noreply@', 'address with no domain'],
    ['a b.com', 'a space inside'],
    ['-bad.com', 'leading hyphen label'],
  ])('REFUSES %o (%s) rather than guessing', (input) => {
    // Inventing a plausible domain here regenerates the exact defect this fixes.
    expect(() => senderDomain(input)).toThrow();
  });
});

describe('F005.10 — the check accepts all three forms and never normalises silently', () => {
  const resolver = fakeResolver(
    {
      'send.broberg.ai': dnsError('ENODATA'),
      'resend._domainkey.send.broberg.ai': [[DKIM_KEY]],
    },
    { 'send.broberg.ai': dnsError('ENODATA') },
  );

  it('all three inputs produce an IDENTICAL report — they cannot drift apart', async () => {
    const [a, b, c] = await Promise.all([
      verifySendingDomain('send.broberg.ai', { resolver }),
      verifySendingDomain('noreply@send.broberg.ai', { resolver }),
      verifySendingDomain('Moovyy <noreply@send.broberg.ai>', { resolver }),
    ]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('report.domain carries what was ACTUALLY looked up, not what was passed', async () => {
    const r = await verifySendingDomain('Moovyy <noreply@send.broberg.ai>', { resolver });
    // Normalising without saying so would be this same bug in a different coat.
    expect(r.domain).toBe('send.broberg.ai');
  });

  it('NEGATIVE CONTROL: genuinely missing records are still reported after the change', async () => {
    const r = await verifySendingDomain('Moovyy <noreply@send.broberg.ai>', { resolver, region: 'eu-west-1' });
    expect(r.ok).toBe(false);
    expect(r.spf).toBe('missing');
    expect(r.mx).toBe('missing');
    expect(r.dkim).toBe('ok');
    expect(r.missing).toHaveLength(2);
  });
});

describe('F005.10 — unreadable input claims NOTHING, and still does not throw', () => {
  it('THE REAL FALSE ALARM: an empty string no longer reports records as missing', async () => {
    // Measured against 0.6.0: '' resolves as ENODATA, so every record came back
    // 'missing' with fix instructions for a domain named "". That is the
    // confident false alarm, and it is the one this case exists to kill.
    const r = await verifySendingDomain('');
    expect(r.missing).toEqual([]);
    expect(r.spf).toBe('unknown');
    expect(r.summary).toContain('not a domain');
    expect(r.summary).toContain('NOTHING was checked');
  });

  it('never throws on unreadable input — a boot check that crashes the boot is worse', async () => {
    await expect(verifySendingDomain('https://send.broberg.ai/x')).resolves.toMatchObject({ ok: false });
  });

  it('echoes the raw input back so the reader can see what they passed', async () => {
    const r = await verifySendingDomain('moovyy');
    expect(r.domain).toBe('moovyy');
  });
});

// ── F005.15 — one level beside, and presence where it meant value ────────────
//
// THE FIXTURES ARE REAL AGAIN. Every answer below was measured with
// `dig @8.8.8.8` on 2026-09-08, the day helpdesk reported that a Resend-VERIFIED
// domain had been called broken by this check for three months.
//
// Why it survived: F005.9 was built and measured against send.broberg.ai and
// send.webhouse.dk — domains that ARE already the `send.` subdomain, so the
// lookup landed in the right place by construction of the fixture rather than
// by correctness of the code. The convenient fixture was accidentally safe.

/** support.fdsundhed.dk, 2026-09-08: apex empty, everything on send.<domain>. */
const fdsundhed = fakeResolver(
  {
    'support.fdsundhed.dk': dnsError('ENODATA'),
    'send.support.fdsundhed.dk': [['v=spf1 include:amazonses.com ~all']],
    'resend._domainkey.support.fdsundhed.dk': [[DKIM_KEY]],
  },
  {
    'support.fdsundhed.dk': dnsError('ENODATA'),
    'send.support.fdsundhed.dk': [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }],
  },
);

describe('defect 1 — the records were looked for one level beside where they are', () => {
  it('support.fdsundhed.dk reports ok — the shipped version called it permanently broken', async () => {
    const r = await verifySendingDomain('support@support.fdsundhed.dk', { resolver: fdsundhed });
    expect(r.ok).toBe(true);
    expect([r.spf, r.dkim, r.mx]).toEqual(['ok', 'ok', 'ok']);
  });

  it('says WHICH hostname carried each record', async () => {
    const r = await verifySendingDomain('support@support.fdsundhed.dk', { resolver: fdsundhed });
    // Without this, "spf: ok" is a claim a reader who disagrees cannot re-run —
    // the same unfalsifiability F005.10 fixed for the normalised domain.
    expect(r.foundAt.spf).toBe('send.support.fdsundhed.dk');
    expect(r.foundAt.mx).toBe('send.support.fdsundhed.dk');
    expect(r.foundAt.dkim).toBe('resend._domainkey.support.fdsundhed.dk');
    expect(r.summary).toContain('send.support.fdsundhed.dk');
  });

  it('still finds records that live on the domain itself (both shapes exist in the wild)', async () => {
    const r = await verifySendingDomain('x@send.webhouse.dk', { resolver: webhouseDk });
    expect(r.spf).toBe('ok');
    expect(r.foundAt.spf).toBe('send.webhouse.dk');
  });
});

describe('defect 2 — presence was accepted where the value was the question', () => {
  /** A domain whose MX is Google Workspace: real MX records, no SES bounces. */
  const googleMx = fakeResolver(
    {
      'send.g.example': dnsError('ENOTFOUND'),
      'g.example': [['v=spf1 include:amazonses.com ~all']],
      'resend._domainkey.g.example': [[DKIM_KEY]],
    },
    {
      'send.g.example': dnsError('ENOTFOUND'),
      'g.example': [
        { exchange: 'alt3.aspmx.l.google.com', priority: 10 },
        { exchange: 'aspmx.l.google.com', priority: 1 },
      ],
    },
  );

  it('THE FALSE GREEN: a Google MX does not carry SES bounces, so it is not ok', async () => {
    const r = await verifySendingDomain('noreply@g.example', { resolver: googleMx });
    expect(r.mx).not.toBe('ok');
    expect(r.ok).toBe(false);
  });

  it('and says so as the thing it costs, not as an absence', async () => {
    const r = await verifySendingDomain('noreply@g.example', { resolver: googleMx, region: 'eu-west-1' });
    const mxLine = r.missing.find((m) => m.startsWith('MX'));
    expect(mxLine).toContain('none of them carry');
    expect(mxLine).toContain('never be reported back');
  });

  /** A real SPF record under which every SES send fails. */
  const wrongSpf = fakeResolver(
    {
      'send.s.example': dnsError('ENOTFOUND'),
      's.example': [['v=spf1 include:_spf.google.com ~all']],
      'resend._domainkey.s.example': [[DKIM_KEY]],
    },
    {
      'send.s.example': dnsError('ENOTFOUND'),
      's.example': [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }],
    },
  );

  it('an SPF record that does not authorise the provider is not ok', async () => {
    const r = await verifySendingDomain('x@s.example', { resolver: wrongSpf });
    expect(r.spf).not.toBe('ok');
  });

  it('tells the reader to EDIT the record — a second SPF record is itself an error', async () => {
    const r = await verifySendingDomain('x@s.example', { resolver: wrongSpf });
    const spfLine = r.missing.find((m) => m.startsWith('SPF'));
    expect(spfLine).toContain('does not authorise');
    expect(spfLine).toContain('do not add a second one');
  });
});

describe('the layout is named, never a hardcoded prefix', () => {
  const postmark: ProviderLayout = {
    name: 'postmark',
    spfHosts: (d) => [`pm-bounces.${d}`],
    mxHosts: (d) => [`pm-bounces.${d}`],
    dkimHosts: (d) => [`20260908._domainkey.${d}`],
    spfMechanisms: ['include:spf.mtasv.net'],
    mxSuffixes: ['pmtasv.net'],
  };

  const pmDomain = fakeResolver(
    { 'pm-bounces.p.example': [['v=spf1 include:spf.mtasv.net ~all']], '20260908._domainkey.p.example': [[DKIM_KEY]] },
    { 'pm-bounces.p.example': [{ exchange: 'return.pmtasv.net', priority: 10 }] },
  );

  it('a consumer on another provider can express its own shape', async () => {
    const r = await verifySendingDomain('x@p.example', { resolver: pmDomain, layout: postmark });
    expect(r.ok).toBe(true);
    expect(r.foundAt.spf).toBe('pm-bounces.p.example');
  });

  it('the Resend default does NOT clear a Postmark domain — the layout is doing real work', async () => {
    const r = await verifySendingDomain('x@p.example', { resolver: pmDomain });
    expect(r.ok).toBe(false);
  });

  it('names the provider in the remedy, so a wrong layout is visible', async () => {
    const bare = fakeResolver({ 'send.n.example': [['v=spf1 include:_spf.google.com ~all']] }, {});
    const r = await verifySendingDomain('x@n.example', { resolver: bare, layout: postmark });
    expect(r.missing.find((m) => m.startsWith('SPF'))).toContain('spf.mtasv.net');
  });
});

describe('three states survive the extra hostnames', () => {
  // The fix multiplies the names visited, so there are more ways for one lookup
  // to fail — and a failure must never decay into "the record is absent".
  const firstCandidateTimesOut = fakeResolver(
    {
      'send.t.example': dnsError('ETIMEOUT'),
      't.example': dnsError('ENOTFOUND'),
      'resend._domainkey.t.example': [[DKIM_KEY]],
    },
    { 'send.t.example': dnsError('ESERVFAIL'), 't.example': dnsError('ENOTFOUND') },
  );

  it('a failure on ANY candidate keeps the record unknown, never missing', async () => {
    const r = await verifySendingDomain('x@t.example', { resolver: firstCandidateTimesOut });
    expect(r.spf).toBe('unknown');
    expect(r.mx).toBe('unknown');
    expect(r.missing).toEqual([]);
    expect(r.unknown).toEqual(['SPF', 'MX']);
  });

  it('an unknown never counts as ok', async () => {
    const r = await verifySendingDomain('x@t.example', { resolver: firstCandidateTimesOut });
    expect(r.ok).toBe(false);
  });

  it('a record found on a LATER candidate is still ok — one dead name is not a verdict', async () => {
    const secondCarriesIt = fakeResolver(
      {
        'send.u.example': dnsError('ETIMEOUT'),
        'u.example': [['v=spf1 include:amazonses.com ~all']],
        'resend._domainkey.u.example': [[DKIM_KEY]],
      },
      { 'send.u.example': dnsError('ENOTFOUND'), 'u.example': [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }] },
    );
    const r = await verifySendingDomain('x@u.example', { resolver: secondCarriesIt });
    expect(r.spf).toBe('ok');
    expect(r.foundAt.spf).toBe('u.example');
  });
});
