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
  /** Records proven absent, each WITH the fix — so the reader can act without a second round-trip. */
  missing: string[];
  /** Records we could not check. Distinct from missing on purpose; do not alarm on these. */
  unknown: string[];
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
  /** Override the resolver (tests). Defaults to node:dns/promises. */
  resolver?: DnsResolver;
}

const DEFAULT_DKIM_SELECTOR = 'resend';

/**
 * Node's dns errors distinguish "asked, no such record" from "could not ask",
 * and that distinction is the entire point of this module — so it is decided
 * on the error CODE, never on an empty result.
 *
 * ENOTFOUND / ENODATA  → the query succeeded and there is nothing there
 * anything else        → timeout, SERVFAIL, refused, no resolver: we do not know
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
  domain: string,
  options: VerifyDomainOptions = {},
): Promise<DomainReadiness> {
  const selector = options.dkimSelector ?? DEFAULT_DKIM_SELECTOR;
  const dns: DnsResolver = options.resolver ?? { resolveTxt, resolveMx };

  const [txt, dkim, mx] = await Promise.all([
    lookup(() => dns.resolveTxt(domain)),
    lookup(() => dns.resolveTxt(`${selector}._domainkey.${domain}`)),
    lookup(() => dns.resolveMx(domain)),
  ]);

  const missing: string[] = [];
  const unknown: string[] = [];

  // SPF — a TXT record may exist without an SPF record in it, so the presence of
  // TXT is not the question; the presence of a v=spf1 string is.
  let spf: RecordState;
  if (txt.state === 'unknown') {
    spf = 'unknown';
    unknown.push('SPF');
  } else if (txt.state === 'found' && txt.value.some((parts) => parts.join('').trim().toLowerCase().startsWith('v=spf1'))) {
    spf = 'ok';
  } else {
    spf = 'missing';
    missing.push('SPF — add TXT on ' + domain + ': "v=spf1 include:amazonses.com ~all"');
  }

  // DKIM. Present-and-non-empty is all we can judge without the provider's key;
  // a malformed key is the provider's problem, an absent record is ours.
  let dkimState: RecordState;
  if (dkim.state === 'unknown') {
    dkimState = 'unknown';
    unknown.push('DKIM');
  } else if (dkim.state === 'found' && dkim.value.some((parts) => parts.join('').trim().length > 0)) {
    dkimState = 'ok';
  } else {
    dkimState = 'missing';
    missing.push(`DKIM — no record at ${selector}._domainkey.${domain} (selector is provider-specific; pass dkimSelector if you are not on Resend)`);
  }

  // MX. Its absence does not stop delivery — it stops BOUNCES coming back, so
  // you never learn that a send failed. Said plainly, because "MX missing" on a
  // send-only domain reads as harmless and is not.
  let mxState: RecordState;
  if (mx.state === 'unknown') {
    mxState = 'unknown';
    unknown.push('MX');
  } else if (mx.state === 'found' && mx.value.length > 0) {
    mxState = 'ok';
  } else {
    mxState = 'missing';
    const target = options.region
      ? `feedback-smtp.${options.region}.amazonses.com`
      : 'feedback-smtp.<region>.amazonses.com (pass `region` — it cannot be guessed)';
    missing.push(`MX — bounces cannot come back; add MX on ${domain}: 10 ${target}`);
  }

  const ok = missing.length === 0 && unknown.length === 0;
  // WORDING IS LOAD-BEARING. An incomplete domain is not necessarily a broken
  // one: send.webhouse.dk has SPF but no DKIM and still PASSES DMARC, because
  // _dmarc.webhouse.dk defaults to relaxed alignment and SPF alone carries it.
  // It is downweighted by Google, not rejected. A check that shouts "mail will
  // not arrive" about that domain is wrong — and an over-harsh check is one
  // people switch off, which is how it stops being a check at all. So: report
  // INCOMPLETENESS and what it costs, never a delivery failure we cannot know.
  const summary = ok
    ? `${domain}: SPF, DKIM and MX all present.`
    : [
        `${domain}: INCOMPLETE — deliverability is degraded (spam-folder risk), not necessarily blocked.`,
        missing.length ? `missing ${missing.length} record(s).` : '',
        // Never phrased as a fault. An unchecked record is not a broken one.
        unknown.length ? `could not check: ${unknown.join(', ')} (DNS lookup failed — this is NOT the same as absent).` : '',
      ]
        .filter(Boolean)
        .join(' ');

  return { ok, domain, spf, dkim: dkimState, mx: mxState, missing, unknown, summary };
}
