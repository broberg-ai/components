// F077 — consent and opt-out for marketing SMS.
//
// READ THIS FIRST, BECAUSE THE CODE WILL OTHERWISE IMPLY OTHERWISE:
// THIS DOES NOT MAKE ANYONE COMPLIANT. It makes the mechanics correct, refuses
// the sends that are obviously wrong, and keeps evidence that can be produced
// later. Whether a given consent is VALID, whether the existing-customer
// exception applies, whether the wording is adequate — all of that stays with
// whoever sends. `consentMode: 'enforced'` is a statement about wiring, not a
// legal opinion.
//
// THE ONE DECISION THAT MUST NOT BE GUESSED, and the reason this file exists in
// the shape it does:
//
//   A TRANSACTIONAL MESSAGE IS NEVER BLOCKED BY A MARKETING OPT-OUT.
//
// A one-time code, an appointment change, a delivery notice — none of those are
// marketing. Blocking them locks people out of their own accounts, which is a
// worse outcome than the problem being solved.
//
// Which forces the next decision: with the gate on, every send must DECLARE its
// category. There is no safe default. Defaulting to transactional lets a
// marketing blast bypass the gate silently; defaulting to marketing blocks
// one-time codes. Both are wrong in a dangerous direction, so a send with the
// gate on and no category is REFUSED — loudly, in development, at each of the
// call-sites that needs a human decision.
//
// WHY THIS DOES NOT REUSE SmsEventStore (F076.7): that one carries a TTL and
// defaults to 48 hours. A consent record must NEVER expire — you may have to
// produce it years later. Reusing it would put a TTL-shaped hole in a legal
// record.

import { normalisePhone } from './index';

/** What a message IS. Not a hint — the gate branches on it. */
export type SmsCategory = 'transactional' | 'marketing';

/**
 * A consent record. Deliberately not a boolean.
 *
 * GDPR art. 7(1) requires you to DEMONSTRATE consent, and a yes/no flag cannot:
 * in a year nobody can say where the yes came from. So the record carries the
 * things you would actually have to produce.
 */
export interface ConsentRecord {
  /** Normalised E.164, so one person is one key. */
  phone: string;
  consentedAt: string;
  /**
   * REQUIRED — the sentence you could read aloud if someone asked.
   * "Tilmeldt nyhedsbrev på sanneandersen.dk" · "Mundtligt ved konsultation 12/8".
   *
   * A record without one is refused: better no row than a row nobody can account
   * for. (xrt81 F077.1 learned this the same way.)
   */
  basis: string;
  /**
   * WHICH wording they agreed to. Version the document, not a field inside it —
   * bumping a field overwrites the very text earlier consents point at
   * (sanneandersen F052).
   */
  textVersion?: string;
  source?: string;
  /** Optional web-signup evidence. */
  ip?: string;
  userAgent?: string;
  /** Set on opt-out. THE ROW IS NEVER DELETED. */
  withdrawnAt?: string;
  withdrawalSource?: string;
  /**
   * Carried forward when someone re-consents after withdrawing, so the
   * withdrawal is not silently erased by the new record.
   *
   * A consumer who needs the FULL history should make their store append-only —
   * this interface allows it, since `get` need only return the latest row.
   */
  previousWithdrawnAt?: string;
}

/**
 * The consent store. NOTE WHAT IS MISSING: there is no `ttlMs` anywhere in this
 * interface, and that is the point.
 */
export interface SmsConsentStore {
  get(phone: string): Promise<ConsentRecord | null> | ConsentRecord | null;
  put(record: ConsentRecord): Promise<void> | void;
}

/**
 * In-memory consent store. Fine for tests and for a single-process app that
 * re-seeds on boot — and useless as a legal record, because it dies with the
 * process. `consentMode` cannot tell you that; your deployment can.
 */
export class MemorySmsConsentStore implements SmsConsentStore {
  private readonly map = new Map<string, ConsentRecord>();

  get(phone: string): ConsentRecord | null {
    return this.map.get(phone) ?? null;
  }

  put(record: ConsentRecord): void {
    this.map.set(record.phone, record);
  }

  /** Every record held, for a test or a dump. */
  all(): ConsentRecord[] {
    return [...this.map.values()];
  }
}

/**
 * What is actually wired — three values, because there are three.
 *
 *   'off'        no register. Nothing is gated, no category needed.
 *   'body-only'  a register with an `optOutText` but NO store: marketing bodies
 *                are checked for a way out, but consent itself is NOT, because
 *                there is nothing to check it against.
 *   'enforced'   a store is wired. Consent is checked.
 *
 * The middle value exists so nobody reads "enforced" over a register that cannot
 * read a single consent record.
 */
export type ConsentMode = 'enforced' | 'body-only' | 'off';

/** What the register knows about one number. */
export type ConsentState = 'consented' | 'withdrawn' | 'none';

export interface ConsentRegistryConfig {
  /** Your store. Without one the register is `off` and blocks nothing. */
  store?: SmsConsentStore;
  /** Default country for normalising numbers. Matches createSms(). */
  defaultCountry?: string;
  /**
   * The way out that must appear in EVERY marketing message.
   *
   * `"Afmeld: sms.broberg.dk/a/x7k2"` — a link, a short code instruction,
   * whatever you actually offer. Markedsføringsloven wants a clear and free way
   * out in every marketing message, and for the existing-customer exception
   * (§10 stk. 2) it is one of the conditions rather than a courtesy.
   *
   * When set, a marketing send whose body does NOT contain this string is
   * refused. IT IS NEVER APPENDED — see `optOutText` on the registry below.
   */
  optOutText?: string;
}

export interface RecordConsentInput {
  phone: string;
  /** REQUIRED. A blank one is refused. */
  basis: string;
  textVersion?: string;
  source?: string;
  ip?: string;
  userAgent?: string;
  /** ISO timestamp; defaults to now. Pass it when back-filling a historic consent. */
  at?: string;
  /**
   * Allow re-consent for a number that WITHDREW.
   *
   * Off by default on purpose: without it, re-running a signup import silently
   * un-withdraws everyone who ever opted out. That is a bulk accident with no
   * error message, and it is the reason this flag exists.
   */
  overrideWithdrawal?: boolean;
}

export interface ConsentRegistry {
  readonly mode: ConsentMode;
  /**
   * The opt-out instruction every marketing body must contain, if configured.
   *
   * NEVER APPENDED AUTOMATICALLY. SMS is billed per segment, and quietly adding
   * characters can flip a one-segment message into two — the exact surprise
   * `estimate()` exists to prevent, and it would arrive as a bill rather than as
   * an error. So the send is refused and the sender decides where it goes and
   * what it costs.
   */
  readonly optOutText?: string;
  /** Record a consent. Throws on a blank basis, or on a withdrawn number without overrideWithdrawal. */
  record(input: RecordConsentInput): Promise<ConsentRecord>;
  /**
   * Record an opt-out. REQUIRES NOTHING AND NEVER REFUSES.
   *
   * Withdrawal must be at least as easy as consent (GDPR art. 7(3)), so this
   * takes no basis, works on a number that never consented, and is idempotent.
   * A guard that can reject an opt-out is the one bug in this file nobody would
   * forgive.
   */
  optOut(phone: string, opts?: { source?: string; at?: string }): Promise<ConsentRecord>;
  /** May we send MARKETING to this number? */
  check(phone: string): Promise<ConsentState>;
  /** The record itself, for producing evidence. */
  get(phone: string): Promise<ConsentRecord | null>;
}

const nowIso = (): string => new Date().toISOString();

/**
 * The consent register.
 *
 * ```ts
 * const consent = createConsentRegistry({ store: myStore });
 * const sms = createSms({ provider, from: "Moovyy", live: true, consent });
 *
 * await consent.record({ phone: "+4522680880", basis: "Tilmeldt nyhedsbrev på webshoppen" });
 * await sms.send({ to: "+4522680880", text: "…", category: "marketing" });
 * ```
 */
export function createConsentRegistry(config: ConsentRegistryConfig = {}): ConsentRegistry {
  const { store, defaultCountry = '45', optOutText } = config;
  const mode: ConsentMode = store ? 'enforced' : optOutText ? 'body-only' : 'off';

  // A number we cannot normalise is a programming error, not a policy decision —
  // so it throws in BOTH directions, including on the opt-out path. That is not
  // "refusing an opt-out": it is saying the argument is not a phone number.
  const key = (phone: string): string => normalisePhone(phone, defaultCountry);

  return {
    mode,
    ...(optOutText ? { optOutText } : {}),

    async record(input) {
      if (!input.basis || !input.basis.trim()) {
        throw new Error(
          'consent.record: `basis` is required — the sentence you could read aloud if someone asked ' +
            'where this consent came from ("Tilmeldt nyhedsbrev på…", "Mundtligt ved konsultation 12/8"). ' +
            'GDPR art. 7(1) asks you to DEMONSTRATE consent, and a row nobody can account for cannot. ' +
            'Better no row than an undocumented one.',
        );
      }
      const phone = key(input.phone);
      if (!store) {
        throw new Error(
          'consent.record: no store configured, so there is nowhere to put this. Pass `store` to ' +
            'createConsentRegistry() — a consent you cannot read back later is not evidence.',
        );
      }

      const existing = await store.get(phone);
      if (existing?.withdrawnAt && !input.overrideWithdrawal) {
        throw new Error(
          `consent.record: ${phone} WITHDREW consent on ${existing.withdrawnAt} and this call would ` +
            'silently reinstate it. If this is a genuine new consent, pass overrideWithdrawal:true. ' +
            'The guard exists because re-running a signup import otherwise un-withdraws everyone who ' +
            'ever opted out, with no error to notice.',
        );
      }

      const record: ConsentRecord = {
        phone,
        consentedAt: input.at ?? nowIso(),
        basis: input.basis.trim(),
        ...(input.textVersion ? { textVersion: input.textVersion } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.ip ? { ip: input.ip } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        // The withdrawal is carried forward rather than erased.
        ...(existing?.withdrawnAt ? { previousWithdrawnAt: existing.withdrawnAt } : {}),
      };
      await store.put(record);
      return record;
    },

    async optOut(phone, opts = {}) {
      const normalised = key(phone);
      if (!store) {
        throw new Error(
          'consent.optOut: no store configured, so this opt-out would be lost. Pass `store` to ' +
            'createConsentRegistry() before offering anyone a way out.',
        );
      }
      const existing = await store.get(normalised);

      // THE EARLIEST WITHDRAWAL WINS, not the latest and not the first call.
      // From the moment they first asked, they were opted out — so a second
      // opt-out must not push the date forward and lose the evidence that you
      // were told weeks ago, and a back-filled EARLIER date must be able to
      // correct the record downwards.
      const incoming = opts.at ?? nowIso();
      const withdrawnAt =
        existing?.withdrawnAt && existing.withdrawnAt < incoming ? existing.withdrawnAt : incoming;

      const record: ConsentRecord = {
        // A number that never consented can still opt out — people say "leave me
        // alone" before you have a row for them, and that has to stick.
        ...(existing ?? { phone: normalised, consentedAt: '', basis: '' }),
        phone: normalised,
        withdrawnAt,
        ...(opts.source ? { withdrawalSource: opts.source } : {}),
      };
      await store.put(record);
      return record;
    },

    async check(phone) {
      if (!store) return 'none';
      const record = await store.get(key(phone));
      if (!record) return 'none';
      if (record.withdrawnAt) return 'withdrawn';
      return record.consentedAt ? 'consented' : 'none';
    },

    async get(phone) {
      if (!store) return null;
      return (await store.get(key(phone))) ?? null;
    },
  };
}

/**
 * Is this whole message someone asking to be left alone?
 *
 * Ships even though this package has no inbound SMS. Christian asked the right
 * question — «Men kræver det ikke at alle de 3 API'er er sat op til at kunne
 * modtage fra brugeren også?» — and for a STOP reply the answer is yes: two-way
 * needs a keyword on a short code or a virtual number, per gateway, at a price
 * none of them publish. That is F077.3, and it is his decision.
 *
 * This function is pure and costs nothing, so it ships now: the day inbound
 * exists, every repo in the fleet already agrees on what counts as an opt-out.
 *
 * DANISH AND ENGLISH, because a Danish recipient writes AFMELD and an English one
 * writes STOP, and recognising only one of them silently ignores half the people
 * asking to be left alone.
 *
 * AND IT MATCHES THE WHOLE MESSAGE, NOT A SUBSTRING. "Kan I stoppe leveringen
 * fredag?" is a question, not an opt-out — unsubscribing them would be a bug
 * they never find out about until they wonder why nothing arrives.
 */
const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stop all',
  'stopall',
  'stop marketing',
  'unsubscribe',
  'afmeld',
  'afmelding',
  'frameld',
  'framelding',
]);

export function parseOptOutKeyword(text: string): boolean {
  const normalised = (text ?? '')
    .trim()
    .toLowerCase()
    // Trailing punctuation only — "STOP." and "Stop!" are opt-outs. Stripping
    // anything more would start turning sentences into keywords.
    .replace(/^[\s.,!?:;'"]+|[\s.,!?:;'"]+$/g, '')
    .replace(/\s+/g, ' ');
  return OPT_OUT_KEYWORDS.has(normalised);
}

/** The keywords recognised, exported so a consumer can show them to a recipient. */
export const OPT_OUT_WORDS: readonly string[] = [...OPT_OUT_KEYWORDS];
