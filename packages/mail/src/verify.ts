// @broberg/mail/verify — is the domain we send FROM actually able to deliver?
//
// A DIFFERENT QUESTION FROM `mailer.mode`, and the distinction is the whole
// reason this file exists. `mode` (v0.5.0) answers "given how this mailer was
// CONFIGURED, will it deliver?" On 2026-08-22 it answered `live` for moovyy —
// and that was CORRECT. The mailer was live. It really did send. Resend really
// did accept it. Christian still could not log in to moovyy.com, because the
// SENDING DOMAIN was half-configured:
//
//     send.broberg.ai     DKIM ok   SPF MISSING   MX MISSING
//     send.webhouse.dk    DKIM ok   SPF ok        MX 10 feedback-smtp.eu-west-1.amazonses.com
//
// Same Resend account. One domain finished, one stopped after DKIM. So `live`
// was a green that was TRUE and still insufficient — not a lie, an answer to a
// question nobody had thought to ask a second one alongside.
//
// AND THERE IS NO WAY AROUND IT AFTERWARDS. moovyy tried to borrow the working
// domain and measured a 403: "This API key is not authorized to send emails
// from send.webhouse.dk". Correct security, but it means a repo enrolled on a
// half-configured domain is LOCKED to waiting for DNS. The cost of missing this
// is not a slow fix, it is a blocked one — which is why it belongs at boot.
//
// THREE STATES, NEVER TWO. A DNS lookup can say "present", "absent", or "I
// could not ask". Collapsing the last two turns a resolver hiccup into a
// confident false alarm about a domain that is perfectly fine — and a false
// alarm at boot is how a check gets switched off, which is how it stops being a
// check at all. moovyy wrote this exact bug while proposing the feature:
//
//     try { return await fn(name); } catch { return []; }   // NXDOMAIN == timeout
//
// Their own three-way verdict function was correct and was fed a lie one layer
// below it. That is this week's failure form once more: the right SHAPE of
// answer carrying the wrong content.
//
// Node-only, like ./webhook (node:crypto). The core entrypoint keeps zero
// dependencies and stays importable on edge/workers, where node:dns does not
// exist — so this is a subpath a consumer calls, never something the core does
// on its own.
import { resolveTxt, resolveMx } from 'node:dns/promises';

/** What we learned about one record. `unknown` means the lookup failed — NOT that the record is absent. */
export type RecordState = 'ok' | 'missing' | 'unknown';

export interface DomainReadiness {
  /** True only when every record is `ok`. An `unknown` never counts as ok — we did not verify it. */
  ok: boolean;
  domain: string;
  spf: RecordState;
  dkim: RecordState;
  mx: RecordState;
  /**
   * The DMARC policy at `_dmarc.<domain>`, or at the organisational domain it
   * falls back to. `ok` requires an actual `v=DMARC1` policy — a TXT that merely
   * EXISTS at the name is not one.
   */
  dmarc: RecordState;
  /** Records proven absent, each WITH the fix — so the reader can act without a second round-trip. */
  missing: string[];
  /** Records we could not check. Distinct from missing on purpose; do not alarm on these. */
  unknown: string[];
  /**
   * WHICH hostname carried each record that came back `ok`.
   *
   * F005.15 — the check now reads several names per record, so `spf: 'ok'` on
   * its own is an unfalsifiable claim: a reader who disagrees has nothing to
   * re-run. This is the same fix `domain` already got in F005.10.
   */
  foundAt: { spf?: string; dkim?: string; mx?: string; dmarc?: string };
  /** One line safe to log at boot. */
  summary: string;
}

/** The two lookups this needs. Injectable so all three states can be driven in a test. */
export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveMx(hostname: string): Promise<Array<{ exchange: string; priority: number }>>;
}

export interface VerifyDomainOptions {
  /**
   * DKIM selector. PROVIDER-SPECIFIC — `resend` is right for Resend and for the
   * whole fleet today, but a consumer on another provider would otherwise be
   * told "DKIM missing" about a domain that is perfectly fine. That is another
   * false alarm, and another reason to switch the check off, so it is a named
   * option rather than an unstated assumption baked into the lookup.
   */
  dkimSelector?: string;
  /**
   * AWS SES region backing the account, used only to write the exact MX fix.
   * Omitted on purpose when unknown: the record is `feedback-smtp.<region>.amazonses.com`
   * and guessing the region would produce a confidently wrong instruction.
   */
  region?: string;
  /**
   * WHERE the provider keeps the records, and WHAT counts as authorising it.
   *
   * F005.15 — helpdesk's `support.fdsundhed.dk` is Resend-verified and this
   * check called it broken for three months, because Resend puts SPF and MX on
   * `send.<domain>` and we looked at the apex. A hardcoded `send.` prefix would
   * be the same mistake pointed elsewhere — Postmark and SES place records
   * differently — so the layout is a named option, exactly like `dkimSelector`.
   */
  layout?: ProviderLayout;
  /** Override the resolver (tests). Defaults to node:dns/promises. */
  resolver?: DnsResolver;
}

/**
 * One provider's DNS shape: where each record lives, and what value proves the
 * provider is actually authorised.
 *
 * The host lists are ORDERED CANDIDATES, not a single answer, because both
 * shapes exist in the wild for the same provider: a domain registered with
 * Resend as `fdsundhed.dk` gets its SPF on `send.fdsundhed.dk`, while one
 * registered as `send.broberg.ai` gets it on `send.broberg.ai` itself.
 * Guessing which flavour a caller is on is how the original defect happened.
 */
export interface ProviderLayout {
  /** Named in reports, so a wrong layout is visible rather than inferred. */
  name: string;
  spfHosts(domain: string): string[];
  mxHosts(domain: string): string[];
  dkimHosts(domain: string, selector: string): string[];
  /** SPF mechanisms that authorise this provider, e.g. `include:amazonses.com`. */
  spfMechanisms: string[];
  /** MX exchange suffixes that carry this provider's bounces. */
  mxSuffixes: string[];
}

/** Resend (SES-backed) — the fleet's provider, and the default. */
export const RESEND_LAYOUT: ProviderLayout = {
  name: 'resend',
  spfHosts: (d) => [`send.${d}`, d],
  mxHosts: (d) => [`send.${d}`, d],
  dkimHosts: (d, selector) => [`${selector}._domainkey.${d}`],
  spfMechanisms: ['include:amazonses.com'],
  mxSuffixes: ['amazonses.com'],
};

const DEFAULT_DKIM_SELECTOR = 'resend';

/**
 * Node's dns errors distinguish "asked, no such record" from "could not ask",
 * and that distinction is the entire point of this module — so it is decided
 * on the error CODE, never on an empty result.
 *
 * ENOTFOUND / ENODATA  → the query succeeded and there is nothing there
 * anything else        → timeout, SERVFAIL, refused, no resolver: we do not know
 */
/**
 * RUNTIME-DEPENDENT, MEASURED 2026-08-22 on one machine, same OS, same inputs:
 *
 *                                    node 25.7    bun 1.3.14
 *   'Moovyy <noreply@x.dev>'         EBADNAME     ENOTFOUND
 *   ''                               ENODATA      ERR_INVALID_ARG_TYPE
 *   name exists, no record           ENODATA      ENOTFOUND
 *   name does not exist              ENOTFOUND    ENOTFOUND
 *
 * Two consequences, and the first is why senderDomain() throws:
 *
 * 1. An UNPARSED string reaching the lookup gets classified by whichever
 *    runtime happens to be running. On node a malformed name is EBADNAME →
 *    'unknown' (harmless); on bun it is ENOTFOUND → 'missing', which is a
 *    confident false alarm about a domain that is fine. So parsing BEFORE the
 *    lookup is not ergonomics — it is the only way to a deterministic answer.
 *    A consumer and this package each measured this and each stated their own
 *    runtime's result as universal. Both were right locally and wrong globally.
 *
 * 2. bun cannot distinguish NXDOMAIN from NODATA — it reports ENOTFOUND for
 *    both. Harmless here, since both mean absent and both are listed below.
 *    But do NOT build logic on that distinction: it does not survive the
 *    runtime change, and it would fail in the quiet direction.
 */
const ABSENT_CODES = new Set(['ENOTFOUND', 'ENODATA']);

async function lookup<T>(fn: () => Promise<T>): Promise<{ state: 'found'; value: T } | { state: 'absent' } | { state: 'unknown' }> {
  try {
    return { state: 'found', value: await fn() };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return ABSENT_CODES.has(code ?? '') ? { state: 'absent' } : { state: 'unknown' };
  }
}

/**
 * Where a DMARC policy for `domain` can legitimately live.
 *
 * NOT a ProviderLayout concern: DMARC's location is fixed by RFC 7489, not by
 * who sends the mail, and it is never under the `send.` subdomain. Putting it in
 * the layout is the obvious mistake right after F005.15 moved SPF and MX there.
 *
 * TWO candidates, because a receiver falls back to the ORGANISATIONAL domain:
 * `send.webhouse.dk` has no policy of its own and is covered by
 * `_dmarc.webhouse.dk`. Checking only the first name would report a domain that
 * genuinely passes DMARC as having no policy — which is F005.15's own defect
 * repeated one record over.
 *
 * THE LIMITATION, said plainly rather than discovered later: the organisational
 * domain is taken as the last two labels. That is wrong for a multi-part public
 * suffix (`foo.co.uk` → `co.uk`), where we would look one level too high. It
 * cannot produce a false `ok` in practice — nobody publishes a DMARC policy on a
 * public suffix — and `foundAt.dmarc` names the host that answered, so a reader
 * who disagrees can check rather than take our word. A full Public Suffix List
 * is the correct fix and is not worth a dependency for this.
 */
/**
 * Is this TXT record an actual DMARC policy?
 *
 * TWO THINGS THE OBVIOUS VERSION GETS WRONG, both measured by helpdesk:
 *
 * 1. The chunks must be JOINED FIRST. A TXT value over 255 bytes arrives as
 *    SEVERAL strings inside ONE record, and a policy with `rua=` and `ruf=`
 *    addresses passes 255 easily. Matching per chunk finds `v=DMARC1` in the
 *    first and reports the rest as junk — or misses it entirely. The SPF branch
 *    above already joins; this is the house pattern, not a new idea.
 *
 * 2. `startsWith`, NEVER `includes`. RFC 7489 §6.4 requires `v=DMARC1` to come
 *    FIRST in the record, so a TXT that merely MENTIONS the string mid-value is
 *    not a policy. `includes` would accept it — and accepting a non-policy is
 *    precisely the failure this whole check exists to prevent.
 *
 * The prefix match is case-insensitive: the RFC does not fix a case, and a
 * case-sensitive check would report a perfectly valid `v=dmarc1` as missing.
 */
function isDmarcPolicy(parts: string[]): boolean {
  return parts.join('').trim().toLowerCase().startsWith('v=dmarc1');
}

export function dmarcHosts(domain: string): string[] {
  const labels = domain.split('.');
  const hosts = [`_dmarc.${domain}`];
  if (labels.length > 2) hosts.push(`_dmarc.${labels.slice(-2).join('.')}`);
  return hosts;
}

/** An MX exchange may or may not carry the root dot; neither form is wrong. */
function matchesSuffix(exchange: string, suffixes: string[]): boolean {
  const host = exchange.trim().toLowerCase().replace(/\.$/, '');
  return suffixes.some((s) => {
    const suffix = s.trim().toLowerCase().replace(/^\.|\.$/g, '');
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

/**
 * Ask several hostnames for one record and merge the answers into ONE state.
 *
 * The merge is where the three-state discipline either survives the fix or
 * quietly dies: visiting more names means more ways for a lookup to fail, and
 * a failure anywhere must keep the whole record at `unknown` rather than
 * decaying into `missing`. `missing` may only be returned when EVERY candidate
 * answered and none of them carried what we need.
 *
 * `presentButUnmatched` is the third fact: the record exists here and is not
 * the one we need. It is not absence, and the remedy is a different sentence.
 */
async function probeHosts<T>(
  hosts: string[],
  ask: (host: string) => Promise<T>,
  matches: (value: T) => boolean,
  isRecordOfThisKind?: (value: T) => boolean,
): Promise<{ state: RecordState; host?: string; presentButUnmatched?: string }> {
  let sawUnknown = false;
  let presentButUnmatched: string | undefined;
  for (const host of hosts) {
    const r = await lookup(() => ask(host));
    if (r.state === 'unknown') {
      sawUnknown = true;
      continue;
    }
    if (r.state !== 'found') continue;
    if (matches(r.value)) return { state: 'ok', host };
    if (!presentButUnmatched && (isRecordOfThisKind?.(r.value) ?? false)) presentButUnmatched = host;
  }
  return sawUnknown ? { state: 'unknown' } : { state: 'missing', presentButUnmatched };
}

/**
 * Pull the domain out of whatever a consumer keeps in `MAIL_FROM`.
 *
 * F005.10 — filed by moovyy the hour they adopted 0.6.0. `MAIL_FROM` is an
 * ADDRESS, not a domain (`Moovyy <noreply@send.broberg.ai>`), and handing it
 * straight to the check sends every lookup to a name that cannot resolve.
 *
 * Three lines every consumer writes identically, whose wrong version produces
 * no error — only an alarm that looks right. That signature is why it lives
 * here rather than in each repo.
 *
 * THROWS on anything it cannot make sense of, and that is deliberate: inventing
 * a plausible domain out of `https://example.com/x` or a bare word would
 * regenerate the exact defect this exists to remove. Guessing is the bug.
 */
export function senderDomain(from: string): string {
  const trimmed = (from ?? '').trim();
  if (!trimmed) throw new Error('senderDomain: empty input — pass a domain, an address, or "Name <address>".');

  const angle = /<([^>]*)>/.exec(trimmed);
  const candidate = (angle ? angle[1] : trimmed).trim();
  const at = candidate.lastIndexOf('@');
  const domain = (at >= 0 ? candidate.slice(at + 1) : candidate).trim().toLowerCase();

  // A hostname, not "something with a dot in it": no scheme, no path, no
  // spaces, no empty labels, and at least two labels.
  const looksLikeHost = /^(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))+$/.test(domain);
  if (!looksLikeHost) {
    throw new Error(`senderDomain: cannot read a domain from ${JSON.stringify(from)} — pass a domain, an address, or "Name <address>".`);
  }
  return domain;
}

/**
 * Check that `domain` has the DNS records needed to actually deliver mail.
 *
 * NEVER THROWS and never blocks a send. It is a report; the consumer decides
 * what to do with it. A repo that does not call this is unaffected, and one
 * that calls it on a broken resolver still boots — every record simply comes
 * back `unknown`.
 *
 * ```ts
 * const r = await verifySendingDomain('send.broberg.ai', { region: 'eu-west-1' });
 * if (!r.ok) console.warn('[mail]', r.summary, r.missing);
 * ```
 */
export async function verifySendingDomain(
  rawFrom: string,
  options: VerifyDomainOptions = {},
): Promise<DomainReadiness> {
  const selector = options.dkimSelector ?? DEFAULT_DKIM_SELECTOR;
  const dns: DnsResolver = options.resolver ?? { resolveTxt, resolveMx };

  // F005.10 — accept a domain, an address, or "Name <address>", because that is
  // what MAIL_FROM actually holds. THE NORMALISATION IS NEVER SILENT: `domain`
  // below carries what was really looked up, so a consumer can see which name
  // was checked rather than assume it was the one they passed.
  //
  // This still never throws — a boot check that crashes the boot is worse than
  // the problem it reports — so unreadable input becomes a report that says so
  // and claims NOTHING about any record. `senderDomain` is exported separately
  // for a consumer who wants the strict version.
  let domain: string;
  try {
    domain = senderDomain(rawFrom);
  } catch {
    return {
      ok: false,
      domain: rawFrom,
      spf: 'unknown',
      dkim: 'unknown',
      mx: 'unknown',
      dmarc: 'unknown',
      missing: [],
      unknown: ['SPF', 'DKIM', 'MX', 'DMARC'],
      foundAt: {},
      summary: `${JSON.stringify(rawFrom)}: not a domain — pass a domain, an address, or "Name <address>". NOTHING was checked.`,
    };
  }

  const layout = options.layout ?? RESEND_LAYOUT;

  const [spfProbe, dkimProbe, dmarcProbe, mxProbe] = await Promise.all([
    probeHosts(
      layout.spfHosts(domain),
      (host) => dns.resolveTxt(host),
      (txt) => txt.some((parts) => {
        const record = parts.join('').trim().toLowerCase();
        // Two questions, and the shipped version only asked the first: is this
        // an SPF record, AND does it authorise the provider we send through?
        // `v=spf1 include:_spf.google.com ~all` is a perfectly real SPF record
        // under which every SES send fails.
        return record.startsWith('v=spf1')
          && layout.spfMechanisms.some((m) => record.includes(m.toLowerCase()));
      }),
      (txt) => txt.some((parts) => parts.join('').trim().toLowerCase().startsWith('v=spf1')),
    ),
    probeHosts(
      layout.dkimHosts(domain, selector),
      (host) => dns.resolveTxt(host),
      // Present-and-non-empty is all we can judge without the provider's key;
      // a malformed key is the provider's problem, an absent record is ours.
      (txt) => txt.some((parts) => parts.join('').trim().length > 0),
    ),
    probeHosts(
      dmarcHosts(domain),
      (host) => dns.resolveTxt(host),
      (txt) => txt.some((parts) => isDmarcPolicy(parts)),
      // A TXT that is not a policy is still a TXT: it means the NAME answered,
      // which is a different remedy from nothing being there at all.
      (txt) => txt.some((parts) => parts.join('').trim().length > 0),
    ),
    probeHosts(
      layout.mxHosts(domain),
      (host) => dns.resolveMx(host),
      (mx) => mx.some((r) => matchesSuffix(r.exchange, layout.mxSuffixes)),
      (mx) => mx.length > 0,
    ),
  ]);

  const missing: string[] = [];
  const unknown: string[] = [];
  const foundAt: DomainReadiness['foundAt'] = {};

  const spf = spfProbe.state;
  if (spf === 'ok') foundAt.spf = spfProbe.host;
  else if (spf === 'unknown') unknown.push('SPF');
  else {
    const where = layout.spfHosts(domain)[0];
    missing.push(
      spfProbe.presentButUnmatched
        // A record IS there and does not authorise us. Telling this reader to
        // "add SPF" would have them add a second TXT record, which is itself an
        // SPF error — so the instruction has to be to EDIT the one they have.
        ? `SPF — ${spfProbe.presentButUnmatched} has an SPF record that does not authorise ${layout.name} (needs ${layout.spfMechanisms.join(' or ')}); edit the existing record, do not add a second one`
        : `SPF — add TXT on ${where}: "v=spf1 ${layout.spfMechanisms[0]} ~all"`,
    );
  }

  // DMARC. Not a deliverability nicety: without a policy the RECEIVER has no
  // rule to fall back on, and a forged mail from the customer's own domain has
  // nothing stopping it. For a product onboarding customer domains that is a
  // security property.
  //
  // The code used to REASON about this record in a comment — that a domain with
  // SPF and no DKIM still passes DMARC — and never look it up. The comment was
  // the evidence the gap had been seen and left open.
  const dmarcState = dmarcProbe.state;
  if (dmarcState === 'ok') foundAt.dmarc = dmarcProbe.host;
  else if (dmarcState === 'unknown') unknown.push('DMARC');
  else {
    const where = dmarcHosts(domain)[0];
    // THE SUGGESTED POLICY IS `p=none`, NEVER `p=reject`, and this is our
    // sentence rather than advice we pass along. A new domain with no traffic
    // history starting at p=reject REJECTS LEGITIMATE MAIL if any one link is
    // wrong — invisible to the sender, visible to the customer's users. F005.15
    // established that a fix which does not fix costs trust; a fix that actively
    // breaks the customer's mail costs more.
    // The line names EXACTLY ONE policy value, and it is the safe one. An
    // explanation that spells out the dangerous setting is a copyable wrong
    // value sitting next to the right one — the same trap as a remedy naming an
    // app called "undefined". So the warning describes the consequence without
    // writing the string.
    const fix = `add TXT on ${where}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}" — start in report-only mode; a stricter policy on a domain with no traffic history silently rejects legitimate mail`;
    missing.push(
      dmarcProbe.presentButUnmatched
        ? `DMARC — ${dmarcProbe.presentButUnmatched} answers with a TXT record, but it is not a DMARC policy (it must START with v=DMARC1); ${fix}`
        : `DMARC — no policy, so a forged mail from this domain has nothing stopping it; ${fix}`,
    );
  }

  const dkimState = dkimProbe.state;
  if (dkimState === 'ok') foundAt.dkim = dkimProbe.host;
  else if (dkimState === 'unknown') unknown.push('DKIM');
  else missing.push(`DKIM — no record at ${layout.dkimHosts(domain, selector)[0]} (selector is provider-specific; pass dkimSelector if you are not on Resend)`);

  // MX. Its absence does not stop delivery — it stops BOUNCES coming back, so
  // you never learn that a send failed. Said plainly, because "MX missing" on a
  // send-only domain reads as harmless and is not.
  //
  // F005.15 — and PRESENCE is not the question either. The shipped version
  // accepted any MX at all, so a domain whose MX is Google Workspace was told
  // its SES bounces would come back. It cleared the one property it exists to
  // report.
  const mxState = mxProbe.state;
  if (mxState === 'ok') foundAt.mx = mxProbe.host;
  else if (mxState === 'unknown') unknown.push('MX');
  else {
    const target = options.region
      ? `feedback-smtp.${options.region}.amazonses.com`
      : 'feedback-smtp.<region>.amazonses.com (pass `region` — it cannot be guessed)';
    const where = layout.mxHosts(domain)[0];
    missing.push(
      mxProbe.presentButUnmatched
        ? `MX — ${mxProbe.presentButUnmatched} has MX records, but none of them carry ${layout.name} bounces; a send that fails will never be reported back. Add MX on ${where}: 10 ${target}`
        : `MX — bounces cannot come back; add MX on ${where}: 10 ${target}`,
    );
  }

  const ok = missing.length === 0 && unknown.length === 0;
  // WORDING IS LOAD-BEARING. An incomplete domain is not necessarily a broken
  // one: send.webhouse.dk has SPF but no DKIM and still PASSES DMARC, because
  // _dmarc.webhouse.dk defaults to relaxed alignment and SPF alone carries it.
  // It is downweighted by Google, not rejected. A check that shouts "mail will
  // not arrive" about that domain is wrong — and an over-harsh check is one
  // people switch off, which is how it stops being a check at all. So: report
  // INCOMPLETENESS and what it costs, never a delivery failure we cannot know.
  const where = [
    foundAt.spf && `SPF at ${foundAt.spf}`,
    foundAt.dkim && `DKIM at ${foundAt.dkim}`,
    foundAt.dmarc && `DMARC at ${foundAt.dmarc}`,
    foundAt.mx && `MX at ${foundAt.mx}`,
  ].filter(Boolean).join(', ');
  const summary = ok
    ? `${domain}: SPF, DKIM, MX and DMARC all present — ${where}.`
    : [
        `${domain}: INCOMPLETE — deliverability is degraded (spam-folder risk), not necessarily blocked.`,
        missing.length ? `missing ${missing.length} record(s).` : '',
        // Never phrased as a fault. An unchecked record is not a broken one.
        unknown.length ? `could not check: ${unknown.join(', ')} (DNS lookup failed — this is NOT the same as absent).` : '',
        where ? `found ${where}.` : '',
      ]
        .filter(Boolean)
        .join(' ');

  return { ok, domain, spf, dkim: dkimState, mx: mxState, dmarc: dmarcState, missing, unknown, foundAt, summary };
}
