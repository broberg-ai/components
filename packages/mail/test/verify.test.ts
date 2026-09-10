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
import { verifySendingDomain, dmarcHosts, type DnsResolver, type ProviderLayout } from '../src/verify';

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
    // F005.17 — measured 2026-09-10. send.broberg.ai has NO policy of its own;
    // the organisational domain carries it, and a receiver falls back there.
    '_dmarc.send.broberg.ai': dnsError('ENOTFOUND'),
    '_dmarc.broberg.ai': [['v=DMARC1; p=quarantine; rua=mailto:buddy+dmarc@broberg.ai; adkim=r; aspf=r; pct=100']],
  },
  { 'send.broberg.ai': dnsError('ENODATA') },
);

/** send.webhouse.dk as measured 2026-08-22: SPF + MX present, DKIM name does not exist (NXDOMAIN). */
const webhouseDk = fakeResolver(
  {
    'send.webhouse.dk': [['v=spf1 include:amazonses.com ~all']],
    'resend._domainkey.send.webhouse.dk': dnsError('ENOTFOUND'),
    // Measured 2026-09-10: same shape — the policy lives on the org domain.
    '_dmarc.send.webhouse.dk': dnsError('ENOTFOUND'),
    '_dmarc.webhouse.dk': [['v=DMARC1; p=quarantine; rua=mailto:buddy+dmarc@broberg.ai;']],
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

  it('a domain with all four is ok — the positive control', async () => {
    const complete = fakeResolver(
      {
        'send.done.example': [['v=spf1 include:amazonses.com ~all']],
        'resend._domainkey.send.done.example': [[DKIM_KEY]],
        '_dmarc.send.done.example': [['v=DMARC1; p=none;']],
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
      // F005.17 — the DMARC lookup is subject to the same discipline: a
      // resolver that could not answer must not become "there is no policy".
      '_dmarc.send.x.example': dnsError('ESERVFAIL'),
      '_dmarc.x.example': dnsError('ETIMEOUT'),
    },
    { 'send.x.example': dnsError('ECONNREFUSED') },
  );

  it('a failed lookup reports unknown — NOT missing', async () => {
    const r = await verifySendingDomain('send.x.example', { resolver: failing });
    expect(r.spf).toBe('unknown');
    expect(r.dkim).toBe('unknown');
    expect(r.mx).toBe('unknown');
    expect(r.dmarc).toBe('unknown');
    expect(r.missing).toEqual([]); // nothing was proven absent
    expect(r.unknown.slice().sort()).toEqual(['DKIM', 'DMARC', 'MX', 'SPF']);
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
    expect(r.unknown.slice().sort()).toEqual(['DKIM', 'DMARC', 'MX', 'SPF']);
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
    // F005.17 added a fourth record, and this fixture's domain has no DMARC
    // policy at either candidate — so three are now genuinely absent. The count
    // moved because the CHECK got wider, not because the domain got worse.
    expect(r.dmarc).toBe('missing');
    expect(r.missing).toHaveLength(3);
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
    // Measured 2026-09-10: this one has its OWN policy, and the org domain has
    // none — the opposite arrangement from send.broberg.ai, in the same fleet.
    '_dmarc.support.fdsundhed.dk': [['v=DMARC1; p=none;']],
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
    {
      'pm-bounces.p.example': [['v=spf1 include:spf.mtasv.net ~all']],
      '20260908._domainkey.p.example': [[DKIM_KEY]],
      // DMARC is NOT a layout concern — the policy lives at _dmarc.<domain>
      // whoever sends the mail, so a Postmark domain carries it in the same
      // place a Resend one does.
      '_dmarc.p.example': [['v=DMARC1; p=none;']],
    },
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
      '_dmarc.t.example': [['v=DMARC1; p=none;']],
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

// ── F005.17 — a TXT at the name is not a policy ──────────────────────────────
//
// Filed by helpdesk (#27208). The check reasoned about DMARC in a COMMENT at
// verify.ts and never looked it up — the comment was the evidence the gap had
// been seen and left open. Without a policy the RECEIVER has no rule to fall
// back on, so a forged mail from the customer's own domain has nothing stopping
// it. For a product onboarding customer domains that is a security property,
// not a deliverability nicety.
//
// helpdesk had to write ~90 lines on top of this package to do it themselves.
// That is the drift the shared package exists to prevent, and they filed it.

/** A DMARC policy over 255 bytes — DNS splits it into several strings in ONE record. */
const LONG_POLICY = [
  'v=DMARC1; p=quarantine; rua=mailto:dmarc-aggregate-reports@example.com,mailto:dmarc-aggregate-secondary@example.com,',
  'mailto:dmarc-aggregate-tertiary@example.com; ruf=mailto:dmarc-forensic-reports@example.com,mailto:dmarc-forensic-2@example.com; ',
  'fo=1; adkim=r; aspf=r; pct=100; rf=afrf; ri=86400; sp=quarantine;',
];

describe('F005.17 — DMARC is judged as a POLICY, not as a name that answered', () => {
  const withDmarc = (txt: string[][] | Error) =>
    fakeResolver(
      {
        'send.q.example': [['v=spf1 include:amazonses.com ~all']],
        'resend._domainkey.q.example': [[DKIM_KEY]],
        '_dmarc.q.example': txt,
      },
      { 'send.q.example': [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }] },
    );

  // helpdesk's three cases go in as a SET, and their point is why: the first
  // one does not measure what it claims unless the other two stand beside it.
  // Alone, an implementation that always answered `missing` would pass it.
  it("helpdesk's case 1 — a TXT that is NOT a policy yields missing, not ok", async () => {
    const r = await verifySendingDomain('x@q.example', {
      resolver: withDmarc([['google-site-verification=abc123def456ghi789jkl012mno345pqr678']]),
    });
    expect(r.dmarc).toBe('missing');
    expect(r.ok).toBe(false);
  });

  it("helpdesk's case 2 — a real policy yields ok", async () => {
    const r = await verifySendingDomain('x@q.example', { resolver: withDmarc([['v=DMARC1; p=none;']]) });
    expect(r.dmarc).toBe('ok');
    expect(r.ok).toBe(true);
  });

  it("helpdesk's case 3 — the prefix match is CASE-INSENSITIVE", async () => {
    // The RFC fixes no case, so a case-sensitive check would report a valid
    // policy as missing — a false alarm about a domain that is fine.
    for (const value of ['v=DMARC1; p=none;', 'v=dmarc1; p=none;', 'V=DmArC1; p=none;']) {
      const r = await verifySendingDomain('x@q.example', { resolver: withDmarc([[value]]) });
      expect(r.dmarc, value).toBe('ok');
    }
  });

  it('ANCHORED: a TXT that CONTAINS v=DMARC1 but does not START with it is not a policy', async () => {
    // RFC 7489 §6.4 requires the version tag first. `includes` would accept
    // this, and accepting a non-policy is the whole failure this check prevents.
    const r = await verifySendingDomain('x@q.example', {
      resolver: withDmarc([['note=our policy is v=DMARC1; p=reject elsewhere']]),
    });
    expect(r.dmarc).toBe('missing');
  });

  it('MULTI-CHUNK: a policy over 255 bytes is accepted, not truncated or choked on', async () => {
    // WHAT THIS PROVES AND WHAT IT DOES NOT, because helpdesk measured the
    // difference an hour after it shipped and they were right.
    //
    // It proves a real >255-byte policy is accepted. It does NOT prove the join
    // is doing the work: `v=DMARC1` is the first tag in every valid policy, so
    // an implementation reading only parts[0] passes this test identically.
    // Measured: joined -> true, parts[0] -> true, last chunk -> false.
    //
    // The join is correct and currently UNFALSIFIABLE. It becomes load-bearing
    // the day anything reads the policy body (p=, sp=, pct=), where a value can
    // straddle a chunk boundary. Saying so is cheaper than a mutation that
    // reddens on a version nobody would write.
    expect(LONG_POLICY.join('').length).toBeGreaterThan(255);
    expect(LONG_POLICY[0]!.length).toBeLessThan(256);
    const r = await verifySendingDomain('x@q.example', { resolver: withDmarc([LONG_POLICY]) });
    expect(r.dmarc).toBe('ok');
  });

  it('the remedy proposes p=none, NEVER p=reject', async () => {
    // A new domain with no traffic history starting at p=reject rejects
    // legitimate mail if any one link is wrong — invisible to the sender,
    // visible to the customer's users. Our `missing` array carries the fix, so
    // this is our sentence to get right, not advice we pass along.
    const r = await verifySendingDomain('x@q.example', { resolver: withDmarc(dnsError('ENOTFOUND')) });
    const line = r.missing.find((m) => m.startsWith('DMARC'))!;
    expect(line).toContain('p=none');
    expect(line).not.toContain('p=reject');
    expect(line).toContain('_dmarc.q.example');
  });

  it('says what is AT STAKE, not merely that a record is absent', async () => {
    const r = await verifySendingDomain('x@q.example', { resolver: withDmarc(dnsError('ENOTFOUND')) });
    expect(r.missing.find((m) => m.startsWith('DMARC'))).toContain('forged mail');
  });

  it('a TXT that exists but is not a policy gets a DIFFERENT remedy from nothing at all', async () => {
    const r = await verifySendingDomain('x@q.example', { resolver: withDmarc([['google-site-verification=xyz']]) });
    // "add a record" is the wrong instruction for someone who already has one
    // at that name: they must EDIT it, or they end up with two TXT values.
    expect(r.missing.find((m) => m.startsWith('DMARC'))).toContain('not a DMARC policy');
  });

  it('THREE STATES: a resolver that could not answer is unknown, never missing', async () => {
    for (const code of ['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED']) {
      const r = await verifySendingDomain('x@q.example', { resolver: withDmarc(dnsError(code)) });
      expect(r.dmarc, code).toBe('unknown');
      expect(r.missing.some((m) => m.startsWith('DMARC')), code).toBe(false);
    }
  });

  it('…and ENOTFOUND / ENODATA are missing, because those ARE answers', async () => {
    for (const code of ['ENOTFOUND', 'ENODATA']) {
      const r = await verifySendingDomain('x@q.example', { resolver: withDmarc(dnsError(code)) });
      expect(r.dmarc, code).toBe('missing');
    }
  });
});

describe('F005.17 — the policy lives at _dmarc, NEVER under the send subdomain', () => {
  it('the lookup is _dmarc.<domain>, not _dmarc.send.<domain> or send._dmarc', async () => {
    // The obvious mistake right after F005.15 moved SPF and MX to send.<domain>
    // is to move this one with them. It is fixed by RFC 7489, not by the
    // provider, so it must not follow.
    expect(dmarcHosts('support.fdsundhed.dk')[0]).toBe('_dmarc.support.fdsundhed.dk');
    expect(dmarcHosts('support.fdsundhed.dk').join(' ')).not.toContain('send.');
  });

  it('falls back to the ORGANISATIONAL domain, which is how a receiver resolves it', async () => {
    // MEASURED 2026-09-10, and this is why the fallback is not optional:
    //   _dmarc.send.broberg.ai   → nothing
    //   _dmarc.broberg.ai        → v=DMARC1; p=quarantine; …
    // Checking only the first name reports a domain that genuinely PASSES DMARC
    // as having no policy — F005.15's own defect, one record over.
    const r = await verifySendingDomain('x@send.broberg.ai', { resolver: brobergAi });
    expect(r.dmarc).toBe('ok');
    expect(r.foundAt.dmarc).toBe('_dmarc.broberg.ai');
  });

  it('…and prefers the domain’s OWN policy when it has one', async () => {
    // The opposite arrangement, in the same fleet, also measured 2026-09-10:
    // support.fdsundhed.dk carries its own and the org domain carries none.
    const r = await verifySendingDomain('support@support.fdsundhed.dk', { resolver: fdsundhed });
    expect(r.dmarc).toBe('ok');
    expect(r.foundAt.dmarc).toBe('_dmarc.support.fdsundhed.dk');
  });

  it('a two-label domain has exactly ONE candidate — there is nothing above it', async () => {
    expect(dmarcHosts('broberg.ai')).toEqual(['_dmarc.broberg.ai']);
  });
});
